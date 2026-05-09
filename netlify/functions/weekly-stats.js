const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const STATS_STRINGS = {
  es: {
    trendHigh:   { icon: '🚀', msg: '¡Gran semana! Tu tarjeta está generando mucho interés.' },
    trendMid:    { icon: '📈', msg: 'Buena actividad. Sigue compartiendo tu tarjeta.' },
    trendLow:    { icon: '💡', msg: 'Comparte tu tarjeta en grupos de WhatsApp para conseguir más visitas.' },
    weekLabel:   'Esta semana',
    monthLabel:  'Últimos 30 días',
    footerNote:  'Recibes este resumen cada lunes como usuario del plan Anual. ¿Dudas? Responde este email.',
    cta:         'Ver mi tarjeta →',
    preheader:   (n) => `Tuviste ${n} visita${n !== 1 ? 's' : ''} esta semana en tu tarjeta PerfilaPro.`,
    title:       (firstName, icon) => `Hola, ${firstName} ${icon}`,
    subject:     (firstName, n) => `${firstName}, tu tarjeta tuvo ${n} visita${n !== 1 ? 's' : ''} esta semana`,
  },
  ca: {
    trendHigh:   { icon: '🚀', msg: 'Gran setmana! La teva targeta està generant molt d’interès.' },
    trendMid:    { icon: '📈', msg: 'Bona activitat. Segueix compartint la teva targeta.' },
    trendLow:    { icon: '💡', msg: 'Comparteix la teva targeta a grups de WhatsApp per aconseguir més visites.' },
    weekLabel:   'Aquesta setmana',
    monthLabel:  'Últims 30 dies',
    footerNote:  'Reps aquest resum cada dilluns com a usuari del pla Anual. Tens dubtes? Respon aquest email.',
    cta:         'Veure la meva targeta →',
    preheader:   (n) => `Has tingut ${n} visita${n !== 1 ? 'es' : ''} aquesta setmana a la teva targeta PerfilaPro.`,
    title:       (firstName, icon) => `Hola, ${firstName} ${icon}`,
    subject:     (firstName, n) => `${firstName}, la teva targeta ha tingut ${n} visita${n !== 1 ? 'es' : ''} aquesta setmana`,
  },
};

function buildStatsEmail({ nombre, slug, visitsWeek, visitsMonth, siteUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = STATS_STRINGS[lang];
  const firstName = (nombre || '').split(' ')[0];
  const cardUrl = `${siteUrl}/c/${slug}`;

  const trend = visitsWeek >= 10
    ? T.trendHigh
    : visitsWeek >= 3
    ? T.trendMid
    : T.trendLow;

  const bodyHtml = `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="width:50%;padding-right:8px">
                  <div style="background:${COLORS.accentSoft};border-radius:10px;padding:20px;text-align:center">
                    <div style="font-size:2.5rem;font-weight:800;color:${COLORS.accent};line-height:1">${visitsWeek}</div>
                    <div style="font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.inkSoft};margin-top:6px">${T.weekLabel}</div>
                  </div>
                </td>
                <td style="width:50%;padding-left:8px">
                  <div style="background:${COLORS.bg};border-radius:10px;padding:20px;text-align:center">
                    <div style="font-size:2.5rem;font-weight:800;color:${COLORS.ink};line-height:1">${visitsMonth}</div>
                    <div style="font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${COLORS.inkSoft};margin-top:6px">${T.monthLabel}</div>
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 28px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">${trend.msg}</p>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.footerNote}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(visitsWeek),
    title: T.title(firstName, trend.icon),
    bodyHtml,
    cta: { text: T.cta, url: cardUrl },
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName, visitsWeek),
    html,
  };
}

async function processWeeklyStats(db, emailClient) {
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.com';
  const now = new Date();
  const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: proCards, error } = await db
    .from('cards')
    .select('slug, nombre, email, idioma')
    .eq('plan', 'pro')
    .eq('status', 'active')
    .is('deleted_at', null)
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
      idioma: card.idioma,
    });

    try {
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
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
