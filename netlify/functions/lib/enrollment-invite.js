'use strict';

// Invitación múltiple a inscribirse (Cantera · Opción A).
//
// A diferencia de team-invite (B2B), aquí NO creamos cards: el club solo
// reparte el enlace de la campaña a una lista de familias, y cada padre
// rellena la ficha completa (fecha → categoría, consentimiento, pago) en
// /inscripcion/:token. Es LOPD-limpio: cero datos del menor hasta que el
// tutor los mete y consiente.
//
// Este lib es PURO: valida/normaliza la lista y construye el email. El
// envío (loop + Resend) y la resolución de la campaña los hace org-panel
// (acción enrollment_invite).

const { buildEmailLayout, COLORS } = require('./email-layout');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripTags(str) {
  return String(str == null ? '' : str).replace(/<[^>]*>/g, '').trim();
}

// Normaliza una fila de invitación { nombre?, email }. nombre es opcional
// (personaliza el saludo); email es obligatorio. Devuelve { row, error }.
function buildInviteRow(input) {
  const i = input || {};
  const email = String(i.email == null ? '' : i.email).toLowerCase().trim();
  if (!EMAIL_RE.test(email)) return { row: null, error: 'email inválido' };
  const nombre = stripTags(i.nombre).substring(0, 100) || null;
  return { row: { email, nombre }, error: null };
}

// Valida la lista entera. Devuelve { rows, errors } donde rows son las
// válidas (deduplicadas por email) y errors las descartadas con su motivo.
function validateInviteList(list) {
  if (!Array.isArray(list)) return { rows: [], errors: [{ email: '(lista)', error: 'no es un array' }] };
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let idx = 0; idx < list.length; idx++) {
    const { row, error } = buildInviteRow(list[idx]);
    if (error) { errors.push({ index: idx, email: (list[idx] && list[idx].email) || '(sin email)', error }); continue; }
    if (seen.has(row.email)) { errors.push({ index: idx, email: row.email, error: 'duplicado en la lista' }); continue; }
    seen.add(row.email);
    rows.push(row);
  }
  return { rows, errors };
}

const INVITE_STRINGS = {
  es: {
    preheader: (club) => `${club} te invita a inscribir a tu hijo/a`,
    title: (club) => `Inscripción abierta · ${club}`,
    intro: (club, nombre) => `${nombre ? `Hola ${nombre}, ` : ''}<strong>${club}</strong> ha abierto las inscripciones de la temporada. Para inscribir a tu hijo/a, rellena la ficha desde el siguiente enlace — tú pones los datos, das tu consentimiento y eliges cómo pagar.`,
    cta: 'Inscribir a mi hijo/a →',
    note: 'El enlace es el mismo para toda la familia. Si tienes varios hijos en el club, puedes repetir la inscripción para cada uno.',
    subject: (club) => `Inscripción abierta · ${club}`,
  },
  ca: {
    preheader: (club) => `${club} t'convida a inscriure el teu fill/a`,
    title: (club) => `Inscripció oberta · ${club}`,
    intro: (club, nombre) => `${nombre ? `Hola ${nombre}, ` : ''}<strong>${club}</strong> ha obert les inscripcions de la temporada. Per inscriure el teu fill/a, omple la fitxa des d'aquest enllaç — tu poses les dades, dones el teu consentiment i tries com pagar.`,
    cta: 'Inscriure el meu fill/a →',
    note: 'L\'enllaç és el mateix per a tota la família. Si tens diversos fills al club, pots repetir la inscripció per a cadascun.',
    subject: (club) => `Inscripció oberta · ${club}`,
  },
};

// Construye el email de invitación a inscribirse. enrollUrl = la URL
// pública de la campaña (/es|ca/inscripcion/:token).
function buildEnrollInviteEmail({ clubName, nombre, enrollUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = INVITE_STRINGS[lang];
  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro(clubName, nombre)}
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center">
                <a href="${enrollUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.cta}</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">${T.note}</p>`;
  return {
    subject: T.subject(clubName),
    html: buildEmailLayout({ preheader: T.preheader(clubName), title: T.title(clubName), bodyHtml, idioma: lang }),
  };
}

module.exports = {
  EMAIL_RE,
  buildInviteRow,
  validateInviteList,
  buildEnrollInviteEmail,
  INVITE_STRINGS,
};
