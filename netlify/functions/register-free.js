const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

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

  return {
    subject: `${firstName}, tu perfil está listo 🎉`,
    html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f2ec;font-family:'Helvetica Neue',Arial,sans-serif;color:#1e1b14">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid rgba(30,27,20,.10);overflow:hidden">

        <tr>
          <td style="background:#01696f;padding:32px 40px;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">PerfilaPro</p>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75)">Tu perfil profesional siempre a mano</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;font-size:24px;font-weight:700">¡Tu perfil ya existe, ${firstName}! 🚀</p>
            <p style="margin:0 0 12px;font-size:15px;color:#6b6458;line-height:1.7">
              Tu perfil profesional está creado. Puedes editarlo y completarlo cuando quieras desde el enlace de abajo.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b6458;line-height:1.7">
              Cuando estés listo para activarlo y que aparezca en el directorio, activa tu plan por solo 9€.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:#01696f;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">
                  Ver mi perfil →
                </a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:#fff;color:#01696f;font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid #01696f">
                  Completar mi perfil
                </a>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
              <tr>
                <td style="background:#d9e8e7;border-radius:10px 10px 0 0;padding:12px 20px;border-left:3px solid #01696f">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#01696f">Plan activo · Gratuito</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#1e1b14;font-weight:600">Sin límite de tiempo · Activa el directorio cuando quieras</p>
                </td>
              </tr>
              <tr>
                <td style="background:#ece8e2;border-radius:0 0 10px 10px;padding:12px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b6458">Tu enlace</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:#01696f;text-decoration:none">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:12px;color:#a89f90;line-height:1.6">
              🔒 El botón "Completar mi perfil" es personal — no compartas este email con nadie.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(30,27,20,.08);text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:#a89f90">PerfilaPro · Tu perfil profesional siempre a mano</p>
            <p style="margin:0;font-size:11px;color:#c4bdb2">
              <a href="${siteUrl}/terminos.html" style="color:#a89f90;text-decoration:none">Términos</a> ·
              <a href="${siteUrl}/privacidad.html" style="color:#a89f90;text-decoration:none">Privacidad</a> ·
              <a href="${siteUrl}/legal.html" style="color:#a89f90;text-decoration:none">Aviso legal</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
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

    const rawDigits = whatsapp.replace(/\D/g, '');
    const waNumber = rawDigits.startsWith('34') && rawDigits.length > 9
      ? rawDigits
      : '34' + rawDigits;

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

    const { error } = await db.from('cards').insert({
      slug,
      nombre:      cleanNombre,
      tagline,
      whatsapp:    waNumber,
      zona:        stripTags(zona).substring(0, 100),
      servicios:   serviciosParsed,
      email,
      plan:        'free',
      status:      'free',
      directory_visible: false,
      edit_token:  editToken,
      edit_token_expires_at: editTokenExpiresAt,
    });

    if (error) {
      console.error('Supabase error:', error.message);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al crear el perfil' }) };
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
