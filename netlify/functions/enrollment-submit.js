'use strict';

// POST /api/enrollment-submit   ·   Cantera · inscripción pública (capa I4)
//
// Endpoint PÚBLICO (sin auth de panel): lo usa el padre/madre desde la
// página /inscripcion/:token que el club repartió. Valida el token de una
// campaña ABIERTA, aplica honeypot + rate-limit, crea la ficha del jugador
// (lib/player-create, con el tutor como card_admin) y graba los
// consentimientos LOPDGDD (lib/consent). NO cobra aquí: devuelve el
// edit/parent link y, si el padre eligió pagar online, un flag para que el
// front lance create-enrollment-checkout con la sesión del tutor.
//
// El menor arranca public_card=false SIEMPRE; el consentimiento de imagen
// (decisión 5) habilita la visibilidad pero la activación efectiva es un
// paso posterior — la inscripción nunca expone al menor de golpe.
//
// Gateado por isCanteraActive() (410 si el carril está off).

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { validateEnrollment } = require('./lib/enrollment');
const { createPlayerCard } = require('./lib/player-create');
const { recordConsent, buildConsentEvidence, clientIp, userAgentOf } = require('./lib/consent');
const { signParentSession } = require('./lib/panel-auth');
const { uploadPlayerPhoto } = require('./lib/player-photo');
const { capture: captureEvent } = require('./lib/posthog-server');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const TOKEN_RE = /^[0-9a-f]{32}$/;

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

const SUBMIT_STRINGS = {
  es: {
    preheader: 'Inscripción recibida en PerfilaPro',
    title: (player) => `Inscripción de ${player} recibida`,
    intro: (club, player) => `Hemos recibido la inscripción de <strong>${player}</strong> en <strong>${club}</strong>. Desde tu panel puedes completar la ficha (foto, documentos), ver la cuota y gestionar los datos del menor.`,
    cta: 'Entrar a mi panel →',
    note: 'Si elegiste pagar online, encontrarás el botón de pago en tu panel.',
    subject: (player) => `Inscripción de ${player} · PerfilaPro`,
  },
  ca: {
    preheader: 'Inscripció rebuda a PerfilaPro',
    title: (player) => `Inscripció de ${player} rebuda`,
    intro: (club, player) => `Hem rebut la inscripció de <strong>${player}</strong> a <strong>${club}</strong>. Des del teu panell pots completar la fitxa (foto, documents), veure la quota i gestionar les dades del menor.`,
    cta: 'Entrar al meu panell →',
    note: 'Si vas triar pagar en línia, trobaràs el botó de pagament al teu panell.',
    subject: (player) => `Inscripció de ${player} · PerfilaPro`,
  },
};

function buildSubmitEmail({ clubName, playerName, panelUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = SUBMIT_STRINGS[lang];
  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro(clubName, playerName)}
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">${T.note}</p>`;
  return buildEmailLayout({ preheader: T.preheader, title: T.title(playerName), bodyHtml, idioma: lang });
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Rate-limit generoso por IP: una familia puede inscribir a varios
    // hijos seguidos, pero frena el abuso de un formulario público.
    const rl = checkRateLimit(event, { bucket: 'enrollment-submit', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }

    // Honeypot: campo oculto 'website'. Si viene relleno, devolvemos 200
    // sin crear nada (mismo patrón anti-bot que lead-b2b).
    if (body.website) return jsonResponse(200, { ok: true });

    const token = (body.token || '').trim();
    if (!TOKEN_RE.test(token)) return jsonResponse(400, { error: 'Enlace de inscripción inválido' });

    // Campaña abierta por token.
    const { data: campaign, error: cErr } = await db
      .from('enrollment_campaigns')
      .select('id, organization_id, season, status, matricula_cents, monthly_fee_cents')
      .eq('public_token', token)
      .maybeSingle();
    if (cErr) return jsonResponse(500, { error: cErr.message });
    if (!campaign || campaign.status !== 'open') {
      return jsonResponse(409, { error: 'Las inscripciones de este club están cerradas' });
    }

    // Club (debe ser sports_club activo).
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, name, kind, sport, deleted_at')
      .eq('id', campaign.organization_id)
      .maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at || org.kind !== 'sports_club') {
      return jsonResponse(409, { error: 'Club no disponible' });
    }

    // Validación del payload del padre (lib/enrollment).
    const { data, errors } = validateEnrollment(body);
    if (errors.length) {
      return jsonResponse(400, { error: 'Revisa los campos marcados', fields: errors });
    }

    // ── Crea la ficha (card player + membership + tutores) ──
    const tutors = [{
      email: data.tutor_legal.email,
      role: 'tutor_legal',
      name: data.tutor_legal.name,
      dni: data.tutor_legal.dni,
      phone: data.tutor_legal.phone,
    }];
    if (data.tutor_secundario) {
      tutors.push({ email: data.tutor_secundario.email, role: 'tutor_secundario', ...data.tutor_secundario });
    }

    const result = await createPlayerCard(db, org, {
      nombre: data.nombre,
      role: 'jugador',
      birthDate: data.birth_date,
      gender: data.gender,
      docKind: data.doc_kind,
      docNumber: data.doc_number,
      nationality: data.nationality,
      direccion: data.direccion,
      season: campaign.season,
      idioma: data.idioma,
      publicCard: false, // el menor nunca arranca público
      tutors,
    });
    if (!result.ok) {
      return jsonResponse(500, { error: 'No se pudo completar la inscripción' });
    }
    const slug = result.slug;

    // ── Consentimientos LOPDGDD (append-only) ──
    // En self-service el 1er factor es el control del email del tutor; la
    // fecha de nacimiento la teclea el propio padre, así que el evidence
    // refleja second_factor='self_service'. data_processing es obligatorio
    // (lo garantizó validateEnrollment). image_rights solo si lo marcó.
    const ip = clientIp(event);
    const ua = userAgentOf(event);
    const consents = [{ type: 'parental_initial' }, { type: 'data_processing' }];
    if (data.consent_image) consents.push({ type: 'image_rights' });
    for (const c of consents) {
      const evidence = buildConsentEvidence({
        consentType: c.type, documentVersion: 'enrollment-v1', ip, userAgent: ua,
        extra: { second_factor: 'self_service', enrollment_campaign_id: campaign.id },
      });
      const { error: consErr } = await recordConsent(db, {
        cardSlug: slug, consentType: c.type,
        grantedByEmail: data.tutor_legal.email, grantedByRole: 'tutor_legal',
        ip, userAgent: ua, evidence,
      });
      if (consErr) console.error('enrollment-submit: consent', c.type, 'falló:', consErr.message);
    }

    // ── Foto del jugador (best-effort, solo con derechos de imagen) ──
    // Se sube en el mismo acto que el consentimiento de imagen. Si falla, la
    // card queda sin foto y el padre la re-sube desde el panel (follow-up);
    // el carnet usa el placeholder mientras tanto. No bloquea la inscripción.
    if (data.consent_image && body.photo_base64) {
      try {
        const up = await uploadPlayerPhoto(db, slug, {
          base64: body.photo_base64, contentType: body.photo_content_type,
        });
        if (up.url) {
          const { error: fotoErr } = await db.from('cards').update({ foto_url: up.url }).eq('slug', slug);
          if (fotoErr) console.error('enrollment-submit: foto_url update falló:', fotoErr.message);
        } else {
          console.error('enrollment-submit: foto no subida:', up.error);
        }
      } catch (err) {
        console.error('enrollment-submit: foto excepción:', err.message);
      }
    }

    // ── Sesión parent-panel + email (best-effort) ──
    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
    const sessionToken = signParentSession({ email: data.tutor_legal.email });
    const panelUrl = `${siteUrl}/panel.html?session=${sessionToken}`;
    if (emailClient) {
      try {
        const T = SUBMIT_STRINGS[data.idioma];
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: data.tutor_legal.email,
          subject: T.subject(data.nombre),
          html: buildSubmitEmail({ clubName: org.name, playerName: data.nombre, panelUrl, idioma: data.idioma }),
        });
      } catch (err) {
        console.error('enrollment-submit: email falló:', err.message);
      }
    }

    captureEvent(slug, 'enrollment_submitted', {
      organization_id: org.id, sport: org.sport,
      payment_choice: data.payment_choice, category_id: result.category_id,
    }).catch(() => {});

    // El front decide: si payment_choice='online', usa parent_session para
    // llamar create-enrollment-checkout con card_slug + campaign_id. Si
    // 'club', el cobro lo gestiona el club fuera de línea.
    return jsonResponse(201, {
      ok: true,
      slug,
      season: result.season,
      category_id: result.category_id,
      payment_choice: data.payment_choice,
      parent_session: sessionToken,
      campaign_id: campaign.id,
      panel_url: panelUrl,
    });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
exports.buildSubmitEmail = buildSubmitEmail;
exports.SUBMIT_STRINGS = SUBMIT_STRINGS;
