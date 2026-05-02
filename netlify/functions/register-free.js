const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { normalizeSpanishPhone } = require('./lib/phone-utils');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const SECTOR_LABELS = {
  oficios:    'Oficios y servicios del hogar',
  salud:      'Salud y bienestar',
  educacion:  'Educación y formación',
  comercial:  'Comercial y ventas',
  belleza:    'Belleza y estética',
  reforma:    'Reforma y construcción',
  hosteleria: 'Hostelería y restauración',
  tech:       'Tecnología y digital',
  legal:      'Legal y asesoría',
  jardineria: 'Jardinería y paisajismo',
  transporte: 'Transporte y mudanzas',
  fotografia: 'Fotografía y vídeo',
  eventos:    'Eventos y celebraciones',
  automocion: 'Automoción y mecánica',
  seguridad:  'Seguridad y vigilancia',
  cuidados:   'Cuidados y asistencia',
  fitness:    'Fitness y deporte',
  turismo:    'Turismo y viajes',
  comercio:   'Comercio y tiendas',
  otro:       'Otro',
};

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function toSlug(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
}

function buildWelcomeEmail({ nombre, slug, siteUrl, editToken }) {
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = `${siteUrl}/editar.html?slug=${slug}&token=${editToken}`;
  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Tu perfil profesional está creado. Puedes editarlo y completarlo cuando quieras desde el enlace de abajo.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Cuando estés listo para activarlo y que aparezca en el directorio, activa tu plan por solo 9€.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">Ver mi perfil →</a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">Completar mi perfil</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
              <tr>
                <td style="background:${COLORS.accentSoft};border-radius:10px 10px 0 0;padding:12px 20px;border-left:3px solid ${COLORS.accent}">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">Plan activo · Gratuito</p>
                  <p style="margin:4px 0 0;font-size:13px;color:${COLORS.ink};font-weight:600">Sin límite de tiempo · Activa el directorio cuando quieras</p>
                </td>
              </tr>
              <tr>
                <td style="background:${COLORS.bg};border-radius:0 0 10px 10px;padding:12px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">Tu enlace</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:${COLORS.accent};text-decoration:none">${cardUrl}</a>
                </td>
              </tr>
            </table>`;

  const html = buildEmailLayout({
    preheader: `${firstName}, tu perfil PerfilaPro ya está creado.`,
    title: `¡Tu perfil ya existe, ${firstName}! 🚀`,
    bodyHtml,
    footerNote: '🔒 El botón "Completar mi perfil" es personal — no compartas este email con nadie.',
    siteUrl,
  });

  return {
    subject: `${firstName}, tu perfil está listo 🎉`,
    html,
  };
}

function makeHandler(db, emailClient = resend) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const { nombre, whatsapp, sector, zona, email, desc, direccion, servicios: rawServicios } = body;

    if (!nombre || !whatsapp || !zona || !email) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan campos obligatorios: nombre, whatsapp, zona, email' }) };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Email inválido' }) };
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

    // Ensure slug uniqueness
    const { data: existing } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (existing) {
      slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}`;
    }

    const editToken = crypto.randomBytes(32).toString('hex');
    const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sectorLabel = SECTOR_LABELS[sector] || sector || '';
    const cleanDesc   = desc ? stripTags(desc).substring(0, 300) : '';
    const tagline     = cleanDesc || sectorLabel;
    const serviciosParsed = Array.isArray(rawServicios)
      ? rawServicios.map(s => stripTags(s).substring(0, 100)).filter(Boolean)
      : [];

    const row = {
      slug,
      nombre:      cleanNombre,
      tagline,
      whatsapp:    waNumber,
      zona:        stripTags(zona).substring(0, 100),
      servicios:   serviciosParsed,
      email,
      plan:        'base',
      status:      'active',
      edit_token:  editToken,
      edit_token_expires_at: editTokenExpiresAt,
    };

    const { error } = await db.from('cards').insert(row);

    if (error) {
      console.error('Supabase insert error:', error.message, error.code);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al crear el perfil: ' + error.message }) };
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    if (email && emailClient) {
      const { subject, html } = buildWelcomeEmail({ nombre: cleanNombre, slug, siteUrl, editToken });
      emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: email,
        subject,
        html,
      }).catch(err => console.error('Email error:', err.message));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        card_url:  `${siteUrl}/c/${slug}`,
        edit_url:  `${siteUrl}/editar.html?slug=${slug}&token=${editToken}`,
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildWelcomeEmail = buildWelcomeEmail;
