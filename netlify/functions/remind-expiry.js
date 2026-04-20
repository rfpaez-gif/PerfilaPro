const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const THRESHOLDS = [30, 15, 7];

function reminderField(days) {
  return `reminder_${days}_sent`;
}

function buildReminderEmail({ nombre, slug, daysLeft, expiresAt, siteUrl }) {
  const firstName = (nombre || '').split(' ')[0];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const expiraFecha = new Date(expiresAt).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const urgency = daysLeft <= 7
    ? { color: '#dc2626', label: '¡Quedan solo ' + daysLeft + ' días!' }
    : daysLeft <= 15
    ? { color: '#ca8a04', label: 'Quedan ' + daysLeft + ' días' }
    : { color: '#01696f', label: 'Quedan ' + daysLeft + ' días' };

  return {
    subject: `${firstName}, tu tarjeta PerfilaPro caduca en ${daysLeft} días`,
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
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75)">Tu perfil profesional en WhatsApp</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 16px;font-size:22px;font-weight:700">Hola, ${firstName} 👋</p>

            <div style="background:#fef9c3;border-left:3px solid ${urgency.color};border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px">
              <p style="margin:0;font-size:15px;font-weight:700;color:${urgency.color}">${urgency.label} para que caduque tu tarjeta</p>
              <p style="margin:4px 0 0;font-size:13px;color:#6b6458">Fecha de caducidad: ${expiraFecha}</p>
            </div>

            <p style="margin:0 0 12px;font-size:15px;color:#6b6458;line-height:1.7">
              Tu tarjeta sigue activa y funcionando. Pero si no la renuevas antes del ${expiraFecha}, dejará de ser pública y tus clientes no podrán encontrarte.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b6458;line-height:1.7">
              Renovar es rápido — menos de 2 minutos y tu tarjeta sigue activa sin cambiar el enlace.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
              <tr><td align="center">
                <a href="${siteUrl}/#crear" style="display:inline-block;background:#01696f;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px">
                  Renovar mi tarjeta →
                </a>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#deeeed;border-radius:8px;margin-bottom:28px">
              <tr>
                <td style="padding:16px 20px">
                  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#01696f">Tu tarjeta actual</p>
                  <a href="${cardUrl}" style="font-size:13px;color:#01696f;text-decoration:none;font-weight:700">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:#6b6458;line-height:1.6">
              ¿Tienes alguna duda? Responde este email directamente.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(30,27,20,.08);text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:#a89f90">PerfilaPro · Tu perfil profesional siempre a mano</p>
            <p style="margin:0;font-size:11px;color:#c4bdb2">
              <a href="${siteUrl}/terminos.html" style="color:#a89f90;text-decoration:none">Términos</a> ·
              <a href="${siteUrl}/privacidad.html" style="color:#a89f90;text-decoration:none">Privacidad</a>
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

async function processReminders(db, emailClient) {
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.com';
  const now = new Date();
  let totalSent = 0;

  for (const days of THRESHOLDS) {
    const windowStart = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
    const field = reminderField(days);

    const { data: cards, error } = await db
      .from('cards')
      .select('slug, nombre, email, expires_at')
      .eq('status', 'active')
      .eq(field, false)
      .gte('expires_at', windowStart.toISOString())
      .lte('expires_at', windowEnd.toISOString());

    if (error) {
      console.error(`Error consultando tarjetas para ${days} días:`, error.message);
      continue;
    }

    for (const card of cards || []) {
      if (!card.email) continue;

      const { subject, html } = buildReminderEmail({
        nombre: card.nombre,
        slug: card.slug,
        daysLeft: days,
        expiresAt: card.expires_at,
        siteUrl,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.com>',
          to: card.email,
          subject,
          html,
        });

        await db.from('cards').update({ [field]: true }).eq('slug', card.slug);
        console.log(`Recordatorio ${days}d enviado a ${card.email} (${card.slug})`);
        totalSent++;
      } catch (err) {
        console.error(`Error enviando recordatorio a ${card.email}:`, err.message);
      }
    }
  }

  return totalSent;
}

function makeHandler(db, emailClient = resend) {
  return async () => {
    console.log('remind-expiry: iniciando');
    const sent = await processReminders(db, emailClient);
    console.log(`remind-expiry: ${sent} recordatorios enviados`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildReminderEmail = buildReminderEmail;
exports.reminderField = reminderField;
