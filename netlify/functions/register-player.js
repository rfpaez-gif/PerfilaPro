'use strict';

// POST /api/register-player   ·   carril Cantera (capa 3a · alta de jugador/staff)
//
// Lo llama el admin del club desde el Studio (panel.html con JWT
// org-panel). Da de alta una card de tipo player (o club_staff), la
// asocia al club como `member_club_seasons` de la temporada vigente, y
// crea los `card_admins` (tutor legal + opcional tutor secundario).
//
// Tres caminos del fichaje (handoff doc §3):
//   1. Nuevo en plataforma          → alta limpia.
//   3. Llega de club off-platform   → alta limpia + previous_club_name (texto libre).
//   (2. Llega de OTRO club PerfilaPro → NO aquí: es el flujo transaccional
//       request/accept-transfer de la capa 3b, que opera sobre una card
//       existente. register-player siempre crea una card NUEVA.)
//
// Slug opaco `p-xxxxxxxx` (anti-doxxing de menores; NO derivado del
// nombre). public_card arranca en false: /c/:slug no renderiza al menor
// hasta que el tutor da consentimiento (capa 3c).
//
// Auth: JWT org-panel del club (mismo que el Studio B2B). El alta queda
// forzosamente scoped a session.orgId — un club no puede fichar en otro.
// Gateado por isCanteraActive() (410 si el carril está off).

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse, signParentSession } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');
const { birthYearFromDate } = require('./lib/pii-crypto');
const { createPlayerCard } = require('./lib/player-create');
const { capture: captureEvent } = require('./lib/posthog-server');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultEmail = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Roles válidos en member_club_seasons (espejo del CHECK de la 033).
const MEMBER_ROLES = ['jugador', 'entrenador', 'delegado', 'medico', 'fisio', 'preparador', 'presidente', 'directiva', 'otro'];

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

// Slug opaco: 'p-' + 8 hex. ~4.3e9 combinaciones; reintenta ante colisión.
function makePlayerSlug() {
  return 'p-' + crypto.randomBytes(4).toString('hex');
}

const INVITE_STRINGS = {
  es: {
    preheader: 'Tu club ha creado la ficha digital de tu hijo/a en PerfilaPro',
    title: (club) => `${club} ha creado una ficha para tu hijo/a`,
    intro: (club, player) => `El club <strong>${club}</strong> ha dado de alta la ficha digital de <strong>${player}</strong> en PerfilaPro. Como tutor/a, puedes gestionarla (datos, foto, estadísticas, cuota) desde tu panel.`,
    cta: 'Entrar al panel →',
    consent: 'La ficha NO es pública todavía. Antes de poder compartir el perfil del menor te pediremos tu consentimiento expreso desde el panel.',
    validity: 'El enlace es válido durante <strong>7 días</strong>.',
    subject: (player) => `Ficha digital de ${player} · PerfilaPro`,
  },
  ca: {
    preheader: 'El teu club ha creat la fitxa digital del teu fill/a a PerfilaPro',
    title: (club) => `${club} ha creat una fitxa per al teu fill/a`,
    intro: (club, player) => `El club <strong>${club}</strong> ha donat d'alta la fitxa digital de <strong>${player}</strong> a PerfilaPro. Com a tutor/a, la pots gestionar (dades, foto, estadístiques, quota) des del teu panell.`,
    cta: 'Entrar al panell →',
    consent: 'La fitxa encara NO és pública. Abans de poder compartir el perfil del menor et demanarem el teu consentiment exprés des del panell.',
    validity: 'L\'enllaç és vàlid durant <strong>7 dies</strong>.',
    subject: (player) => `Fitxa digital de ${player} · PerfilaPro`,
  },
};

function buildPlayerInviteEmail({ clubName, playerName, panelUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = INVITE_STRINGS[lang];
  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro(clubName, playerName)}
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>
            <p style="margin:0 0 16px;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.consent}
            </p>
            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.validity}
            </p>`;
  return buildEmailLayout({ preheader: T.preheader, title: T.title(clubName), bodyHtml, idioma: lang });
}

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const rl = checkRateLimit(event, { bucket: 'register-player', limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    // ── Org del club (scoped al JWT) ──
    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug, name, kind, sport, deleted_at')
      .eq('id', session.orgId)
      .maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return unauthorizedResponse();
    if (org.kind !== 'sports_club') {
      return jsonResponse(403, { error: 'El alta de jugadores solo está disponible para clubes deportivos' });
    }

    // ── Validación de inputs ──
    const nombre = stripTags(body.nombre).substring(0, 100);
    if (!nombre) return jsonResponse(400, { error: 'Nombre del jugador requerido' });

    const role = body.role || 'jugador';
    if (!MEMBER_ROLES.includes(role)) return jsonResponse(400, { error: 'Rol inválido' });
    const isPlayer = role === 'jugador';

    const birthDate = (body.birth_date || '').trim();
    // La fecha de nacimiento es obligatoria para jugadores (categoría); para
    // staff es opcional.
    if (isPlayer && !DATE_RE.test(birthDate)) {
      return jsonResponse(400, { error: 'Fecha de nacimiento del jugador requerida (YYYY-MM-DD)' });
    }
    if (birthDate && !DATE_RE.test(birthDate)) {
      return jsonResponse(400, { error: 'Fecha de nacimiento inválida (YYYY-MM-DD)' });
    }
    let birthYear = null;
    if (birthDate) {
      birthYear = birthYearFromDate(birthDate);
      const thisYear = new Date().getUTCFullYear();
      if (!birthYear || birthYear < 1900 || birthYear > thisYear) {
        return jsonResponse(400, { error: 'Fecha de nacimiento fuera de rango' });
      }
    }

    const gender = body.gender;
    if (gender != null && !['M', 'F', 'X'].includes(gender)) {
      return jsonResponse(400, { error: 'Género inválido (M/F/X)' });
    }

    const tutorEmail = (body.tutor_legal_email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(tutorEmail)) {
      return jsonResponse(400, { error: 'Email del tutor legal inválido' });
    }
    const tutorSecundarioEmail = body.tutor_secundario_email
      ? (body.tutor_secundario_email || '').toLowerCase().trim()
      : null;
    if (tutorSecundarioEmail && !EMAIL_RE.test(tutorSecundarioEmail)) {
      return jsonResponse(400, { error: 'Email del tutor secundario inválido' });
    }

    const idioma = body.idioma === 'ca' ? 'ca' : 'es';

    let dorsal = null;
    if (isPlayer && body.dorsal != null && body.dorsal !== '') {
      dorsal = Number(body.dorsal);
      if (!Number.isInteger(dorsal) || dorsal < 0 || dorsal > 999) {
        return jsonResponse(400, { error: 'Dorsal inválido' });
      }
    }
    const position = body.position ? stripTags(body.position).substring(0, 40) : null;
    const teamName = body.team_name ? stripTags(body.team_name).substring(0, 80) : null;
    const previousClubName = body.previous_club_name ? stripTags(body.previous_club_name).substring(0, 120) : null;

    // ── Creación de la ficha (card + membership + tutores) ──
    // La escritura vive en lib/player-create, compartida con la
    // inscripción self-service del padre (capa I4).
    const tutors = [{ email: tutorEmail, role: 'tutor_legal' }];
    if (tutorSecundarioEmail && tutorSecundarioEmail !== tutorEmail) {
      tutors.push({ email: tutorSecundarioEmail, role: 'tutor_secundario' });
    }
    const result = await createPlayerCard(db, org, {
      nombre,
      role,
      birthDate: birthDate || null,
      gender,
      dorsal,
      position,
      teamName,
      previousClubName,
      season: body.season,
      idioma,
      publicCard: false,
      tutors,
    });
    if (!result.ok) {
      const msg = result.stage === 'card' ? 'No se pudo crear la ficha' : 'No se pudo completar el alta';
      return jsonResponse(500, { error: msg });
    }
    const { slug, card_kind: cardKind, season, category_id: categoryId } = result;

    // ── Email de invitación al tutor legal (best-effort, no bloquea) ──
    if (emailClient) {
      try {
        const token = signParentSession({ email: tutorEmail });
        const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
        const panelUrl = `${siteUrl}/panel.html?session=${token}`;
        const T = INVITE_STRINGS[idioma];
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: tutorEmail,
          subject: T.subject(nombre),
          html: buildPlayerInviteEmail({ clubName: org.name, playerName: nombre, panelUrl, idioma }),
        });
      } catch (err) {
        console.error('register-player: error enviando invite:', err.message);
      }
    }

    captureEvent(slug, 'player_registered', {
      organization_id: org.id,
      sport: org.sport,
      role,
      category_id: categoryId,
      from_off_platform: !!previousClubName,
    }).catch(() => {});

    return jsonResponse(201, {
      ok: true,
      slug,
      card_kind: cardKind,
      season,
      category_id: categoryId,
    });
  };
}

exports.handler = makeHandler(defaultDb, defaultEmail);
exports.makeHandler = makeHandler;
exports.buildPlayerInviteEmail = buildPlayerInviteEmail;
exports.INVITE_STRINGS = INVITE_STRINGS;
exports.MEMBER_ROLES = MEMBER_ROLES;
