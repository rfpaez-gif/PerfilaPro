const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function buildStatsEmail({ nombre, slug, visitsWeek, visitsMonth, siteUrl }) {
  const firstName = (nombre || '').split(' ')[0];
  const cardUrl = `${siteUrl}/c/${slug}`;

  const trend = visitsWeek >= 10
    ? { icon: '🚀', msg: '¡Gran semana! Tu tarjeta está generando mucho interés.' }
    : visitsWeek >= 3
    ? { icon: '📈', msg: 'Buena actividad. Sigue compartiendo tu tarjeta.' }
    : { icon: '💡', msg: 'Comparte tu tarjeta en grupos de WhatsApp para conseguir más visitas.' };

  return {
    subject: `${firstName}, tu tarjeta tuvo ${visitsWeek} visita${visitsWeek !== 1 ? 's' : ''} esta semana`,
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
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75)">Tu resumen semanal</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 24px;font-size:22px;font-weight:700">Hola, ${firstName} ${trend.icon}</p>

            <!-- Stats -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="width:50%;padding-right:8px">
                  <div style="background:#deeeed;border-radius:10px;padding:20px;text-align:center">
                    <div style="font-size:2.5rem;font-weight:800;color:#01696f;line-height:1">${visitsWeek}</div>
                    <div style="font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b6458;margin-top:6px">Esta semana</div>
                  </div>
                </td>
                <td style="width:50%;padding-left:8px">
                  <div style="background:#f5f2ec;border-radius:10px;padding:20px;text-align:center">
                    <div style="font-size:2.5rem;font-weight:800;color:#1e1b14;line-height:1">${visitsMonth}</div>
                    <div style="font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b6458;margin-top:6px">Últimos 30 días</div>
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;font-size:15px;color:#6b6458;line-height:1.7">${trend.msg}</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
              <tr><td align="center">
                <a href="${cardUrl}" style="display:inline-block;background:#01696f;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">
                  Ver mi tarjeta →
                </a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:#a89f90;line-height:1.6">
              Recibes este resumen cada lunes como usuario del plan Pro. ¿Dudas? Responde este email.
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

async function processWeeklyStats(db, emailClient) {
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.com';
  const now = new Date();
  const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: proCards, error } = await db
    .from('cards')
    .select('slug, nombre, email')
    .eq('plan', 'pro')
    .eq('status', 'active')
    .not('email', 'is', null);

  if (error) {
    console.error('Error consultando tarjetas Pro:', error.message);
    return 0;
  }

  let totalSent = 0;

  for (const card of proCards || []) {
    const [{ count: visitsWeek }, { count: visitsMonth }] = await Promise.all([
      db.from('visits').select('*', { count: 'exact', head: true })
        .eq('slug', card.slug).gte('visited_at', sevenDaysAgo),
      db.from('visits').select('*', { count: 'exact', head: true })
        .eq('slug', card.slug).gte('visited_at', thirtyDaysAgo),
    ]);

    const { subject, html } = buildStatsEmail({
      nombre: card.nombre,
      slug: card.slug,
      visitsWeek: visitsWeek ?? 0,
      visitsMonth: visitsMonth ?? 0,
      siteUrl,
    });

    try {
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.com>',
        to: card.email,
        subject,
        html,
      });
      console.log(`Stats semanales enviadas a ${card.email} (${card.slug})`);
      totalSent++;
    } catch (err) {
      console.error(`Error enviando stats a ${card.email}:`, err.message);
    }
  }

  return totalSent;
}

function makeHandler(db, emailClient = resend) {
  return async () => {
    console.log('weekly-stats: iniciando');
    const sent = await processWeeklyStats(db, emailClient);
    console.log(`weekly-stats: ${sent} emails enviados`);
    return { statusCode: 200, body: JSON.stringify({ sent }) };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildStatsEmail = buildStatsEmail;
