'use strict';

// register-b2b · Sprint 3 · pieza A (refuerzo)
//
// Alta de un perfil profesional desde el onboarding B2B. Es un carril
// distinto de register-free porque:
//
//   - El perfil entra con plan='b2b' (no 'base'), así el admin y los jobs
//     de mantenimiento (remind-expiry, weekly-stats) lo distinguen del
//     autónomo individual y no le aplican la lógica de upgrade.
//   - Sin expires_at: el ciclo de vida lo gestionará la suscripción de la
//     organización en pieza B. Hasta entonces, "activo perpetuo".
//   - Welcome email propio: NO upsell de 9€. Si tiene org asignada,
//     "Tu perfil dentro de {Org} ya está vivo".
//   - Exige redeemed_token (el lead viene del magic-link), valida y marca
//     el lead como redimido.
//   - Acepta organization_id opcional (puede no estar aún asignada en el
//     momento del onboarding).
//
// El endpoint reusa toda la lógica de validación de register-free
// (sanitización, slug, CP, ocupación, WhatsApp) salvo en el insert final.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { normalizeSpanishPhone } = require('./lib/phone-utils');
const { capture: captureEvent } = require('./lib/posthog-server');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isValidCp, lookupCp, normalizeCp } = require('./lib/cp-utils');
const { pickSectorLabel } = require('./lib/sector-labels');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-f0-9]{48}$/;

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function toSlug(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const B2B_WELCOME_STRINGS = {
  es: {
    subject: (n, org) => org ? `${n}, tu perfil dentro de ${org} ya está activo` : `${n}, tu perfil profesional ya está activo`,
    preheader: (org) => org ? `Bienvenido al equipo de ${org} en PerfilaPro.` : 'Tu perfil B2B está vivo.',
    title: (n) => `Bienvenido, ${n} 🚀`,
    intro: (org) => org
      ? `Tu perfil profesional ya está publicado bajo la organización <strong>${esc(org)}</strong>. Cuando alguien busque a alguien de tu equipo, encontrará tu tarjeta con la marca de la organización arriba y abajo.`
      : 'Tu perfil profesional ya está publicado. La organización a la que pertenecerás aún está pendiente de asignar — cuando el admin lo haga, tu tarjeta se actualizará automáticamente con su marca.',
    cardLinkLabel: 'Tu enlace',
    seeProfile: 'Ver mi perfil →',
    editProfile: 'Completar mi perfil',
    note: 'Puedes seguir editando servicios, foto, dirección y tagline en cualquier momento desde el enlace de abajo. Sin tarjeta, sin plazos.',
    footerNote: '🔒 El enlace de edición es personal — no compartas este email con nadie.',
  },
  ca: {
    subject: (n, org) => org ? `${n}, el teu perfil dins de ${org} ja és actiu` : `${n}, el teu perfil professional ja és actiu`,
    preheader: (org) => org ? `Benvingut a l'equip de ${org} a PerfilaPro.` : 'El teu perfil B2B ja és viu.',
    title: (n) => `Benvingut, ${n} 🚀`,
    intro: (org) => org
      ? `El teu perfil professional ja està publicat sota l'organització <strong>${esc(org)}</strong>. Quan algú busqui algú del teu equip, trobarà la teva targeta amb la marca de l'organització a dalt i a baix.`
      : 'El teu perfil professional ja està publicat. L\'organització a la qual pertanyeràs encara està pendent d\'assignar — quan l\'admin ho faci, la teva targeta s\'actualitzarà automàticament amb la seva marca.',
    cardLinkLabel: 'El teu enllaç',
    seeProfile: 'Veure el meu perfil →',
    editProfile: 'Completar el meu perfil',
    note: 'Pots seguir editant serveis, foto, adreça i tagline en qualsevol moment des de l\'enllaç de baix. Sense targeta, sense terminis.',
    footerNote: '🔒 L\'enllaç d\'edició és personal — no comparteixis aquest email amb ningú.',
  },
};

function buildB2BWelcomeEmail({ nombre, slug, siteUrl, editToken, idioma = 'es', orgName = null }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = B2B_WELCOME_STRINGS[lang];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = `${siteUrl}/${lang}/editar?slug=${slug}&token=${editToken}`;
  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro(orgName)}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">
              <tr>
                <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;padding:18px 20px;text-align:center">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${T.cardLinkLabel}</p>
                  <a href="${cardUrl}" style="font-size:16px;font-weight:700;color:${COLORS.accent};text-decoration:none;word-break:break-all">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.seeProfile}</a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">${T.editProfile}</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.note}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(orgName),
    title: T.title(firstName),
    bodyHtml,
    footerNote: T.footerNote,
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName, orgName),
    html,
  };
}

function makeHandler(db, emailClient = resend) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'register-b2b', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const { nombre, whatsapp, sector, cp, email, desc, direccion, local_publico, servicios: rawServicios, idioma: rawIdioma, organization_id: rawOrgId, redeemed_token: rawRedeemedToken } = body;
    const idioma = rawIdioma === 'ca' ? 'ca' : 'es';

    if (!nombre || !whatsapp || !cp || !email) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan campos obligatorios: nombre, whatsapp, cp, email' }) };
    }

    // redeemed_token es obligatorio en el carril B2B: el alta sólo puede
    // venir desde un magic-link válido. Si falta o tiene mal formato, 400.
    const redeemedToken = (typeof rawRedeemedToken === 'string' && TOKEN_RE.test(rawRedeemedToken.toLowerCase()))
      ? rawRedeemedToken.toLowerCase()
      : null;
    if (!redeemedToken) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta el token de invitación o tiene un formato no válido' }) };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Email inválido' }) };
    }

    const cpNormalized = normalizeCp(cp);
    if (!isValidCp(cpNormalized)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Código postal inválido. Introduce 5 dígitos de un CP español (01000-52999).' }) };
    }

    const cleanNombre = stripTags(nombre).substring(0, 100);
    let slug = toSlug(cleanNombre);
    if (!slug) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Nombre inválido' }) };
    }

    const phone = normalizeSpanishPhone(whatsapp);
    if (!phone.ok) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'WhatsApp inválido. Introduce un móvil español de 9 dígitos.' }) };
    }
    const waNumber = phone.e164;

    // Verificamos el token del lead antes de tocar cards: si el lead no
    // existe o ya está redimido, abortamos sin crear una card huérfana.
    const { data: lead, error: leadErr } = await db
      .from('b2b_leads')
      .select('id, organization_id, redeemed_at')
      .eq('invite_token', redeemedToken)
      .maybeSingle();
    if (leadErr) {
      console.error('register-b2b: error consultando lead:', leadErr.message);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No se pudo validar el enlace' }) };
    }
    if (!lead) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Enlace de invitación no encontrado' }) };
    }
    if (lead.redeemed_at) {
      return { statusCode: 410, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Este enlace ya se ha usado' }) };
    }

    // organization_id puede venir explícito en el body o heredarse del
    // propio lead (si el admin lo asoció antes). El body gana, pero
    // validamos contra organizations en cualquier caso.
    const explicitOrgId = (typeof rawOrgId === 'string' && UUID_RE.test(rawOrgId)) ? rawOrgId : null;
    const candidateOrgId = explicitOrgId || lead.organization_id || null;
    let organization_id = null;
    let orgName = null;
    if (candidateOrgId) {
      const { data: org } = await db
        .from('organizations')
        .select('id, name')
        .eq('id', candidateOrgId)
        .is('deleted_at', null)
        .maybeSingle();
      if (org) {
        organization_id = org.id;
        orgName = org.name;
      }
    }

    // Slug uniqueness (incluye soft-deleted para no colisionar con la PK).
    const { data: existing } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (existing) {
      slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}`;
    }

    const editToken = crypto.randomBytes(32).toString('hex');
    const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sectorLabel = pickSectorLabel(sector, idioma);
    const cleanDesc   = desc ? stripTags(desc).substring(0, 300) : '';
    const tagline     = cleanDesc || sectorLabel;
    const serviciosParsed = Array.isArray(rawServicios)
      ? rawServicios.map(s => stripTags(s).substring(0, 100)).filter(Boolean)
      : [];

    const cpRow = await lookupCp(db, cpNormalized);
    const zonaResolved = cpRow?.municipality_name || '';
    const citySlugResolved = cpRow?.province_slug || null;

    const direccionClean = direccion ? stripTags(direccion).substring(0, 200) : null;
    const localPublicoBool = local_publico === true && !!direccionClean;

    const row = {
      slug,
      nombre:           cleanNombre,
      tagline,
      whatsapp:         waNumber,
      cp:               cpNormalized,
      zona:             zonaResolved.substring(0, 100),
      city_slug:        citySlugResolved,
      servicios:        serviciosParsed,
      email,
      // Carril B2B: plan distinto, sin expires_at. El admin y los jobs
      // ven 'b2b' como categoría aparte y no aplican upgrade ni recordatorios.
      plan:             'b2b',
      status:           'active',
      direccion:        direccionClean,
      local_publico:    localPublicoBool,
      edit_token:       editToken,
      edit_token_expires_at: editTokenExpiresAt,
      idioma,
    };
    if (organization_id) row.organization_id = organization_id;

    const { error } = await db.from('cards').insert(row);
    if (error) {
      console.error('register-b2b: error insertando card:', error.message, error.code);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al crear el perfil: ' + error.message }) };
    }

    // Marcamos el lead como redimido. Update condicional para que dos
    // posts simultáneos no se pisen (gana el primero, el segundo no
    // sobrescribe redeemed_card_slug).
    const { error: redErr } = await db
      .from('b2b_leads')
      .update({ redeemed_at: new Date().toISOString(), redeemed_card_slug: slug })
      .eq('invite_token', redeemedToken)
      .is('redeemed_at', null);
    if (redErr) console.warn('register-b2b: no se pudo marcar lead redimido (no fatal):', redErr.message);

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    if (email && emailClient) {
      const { subject, html } = buildB2BWelcomeEmail({
        nombre: cleanNombre, slug, siteUrl, editToken, idioma, orgName,
      });
      emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: email,
        subject,
        html,
      }).catch(err => console.error('register-b2b: error enviando welcome (no fatal):', err.message));
    }

    captureEvent(slug, 'signup_completed_b2b', {
      plan: 'b2b',
      organization_id: organization_id || null,
      idioma,
    }).catch(() => {});

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        card_url:  `${siteUrl}/c/${slug}`,
        edit_url:  `${siteUrl}/${idioma}/editar?slug=${slug}&token=${editToken}`,
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildB2BWelcomeEmail = buildB2BWelcomeEmail;
