const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

const THRESHOLDS = [30, 15, 7];

const REMINDER_STRINGS = {
  es: {
    locale: 'es-ES',
    urgencyHigh: (d) => `¡Quedan solo ${d} días!`,
    urgencyMid:  (d) => `Quedan ${d} días`,
    urgencyLow:  (d) => `Quedan ${d} días`,
    urgencyTail: ' para que caduque tu tarjeta',
    expiraLabel: 'Fecha de caducidad',
    body1: (fecha) => `Tu tarjeta sigue activa y funcionando. Pero si no la renuevas antes del ${fecha}, dejará de ser pública y tus clientes no podrán encontrarte.`,
    body2: 'Renovar es rápido — menos de 2 minutos y tu tarjeta sigue activa sin cambiar el enlace.',
    currentCardLabel: 'Tu tarjeta actual',
    closing: '¿Tienes alguna duda? Responde este email directamente.',
    preheader: (d) => `Tu tarjeta caduca en ${d} días — renueva en menos de 2 minutos.`,
    title: (n) => `Hola, ${n} 👋`,
    cta: 'Renovar mi tarjeta →',
    subject: (n, d) => `${n}, tu tarjeta PerfilaPro caduca en ${d} días`,
  },
  ca: {
    locale: 'ca-ES',
    urgencyHigh: (d) => `Només queden ${d} dies!`,
    urgencyMid:  (d) => `Queden ${d} dies`,
    urgencyLow:  (d) => `Queden ${d} dies`,
    urgencyTail: ' perquè la teva targeta caduqui',
    expiraLabel: 'Data de caducitat',
    body1: (fecha) => `La teva targeta segueix activa i funcionant. Però si no la renoves abans del ${fecha}, deixarà de ser pública i els teus clients no et podran trobar.`,
    body2: 'Renovar és ràpid — menys de 2 minuts i la teva targeta segueix activa sense canviar l’enllaç.',
    currentCardLabel: 'La teva targeta actual',
    closing: 'Tens cap dubte? Respon aquest email directament.',
    preheader: (d) => `La teva targeta caduca en ${d} dies — renova-la en menys de 2 minuts.`,
    title: (n) => `Hola, ${n} 👋`,
    cta: 'Renovar la meva targeta →',
    subject: (n, d) => `${n}, la teva targeta PerfilaPro caduca en ${d} dies`,
  },
};

function reminderField(days) {
  return `reminder_${days}_sent`;
}

function buildReminderEmail({ nombre, slug, daysLeft, expiresAt, siteUrl, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = REMINDER_STRINGS[lang];
  const firstName = (nombre || '').split(' ')[0];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const expiraFecha = new Date(expiresAt).toLocaleDateString(T.locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const urgency = daysLeft <= 7
    ? { color: '#E5484D', bg: '#FEE7E9', label: T.urgencyHigh(daysLeft) }
    : daysLeft <= 15
    ? { color: '#D97706', bg: '#FEF3C7', label: T.urgencyMid(daysLeft) }
    : { color: '#00C277', bg: COLORS.accentSoft, label: T.urgencyLow(daysLeft) };

  const bodyHtml = `
            <div style="background:${urgency.bg};border-left:3px solid ${urgency.color};border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px">
              <p style="margin:0;font-size:15px;font-weight:700;color:${urgency.color}">${urgency.label}${T.urgencyTail}</p>
              <p style="margin:4px 0 0;font-size:13px;color:${COLORS.inkSoft}">${T.expiraLabel}: ${expiraFecha}</p>
            </div>

            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.body1(expiraFecha)}
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.body2}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.accentSoft};border-radius:8px;margin-bottom:28px">
              <tr>
                <td style="padding:16px 20px">
                  <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">${T.currentCardLabel}</p>
                  <a href="${cardUrl}" style="font-size:13px;color:${COLORS.accent};text-decoration:none;font-weight:700">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.closing}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(daysLeft),
    title: T.title(firstName),
    bodyHtml,
    cta: { text: T.cta, url: `${siteUrl}/${lang}/` },
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName, daysLeft),
    html,
  };
}

async function processReminders(db, emailClient) {
  const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
  const now = new Date();
  let totalSent = 0;

  for (const days of THRESHOLDS) {
    const windowStart = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
    const field = reminderField(days);

    const { data: cards, error } = await db
      .from('cards')
      .select('slug, nombre, email, expires_at, idioma')
      .eq('status', 'active')
      .eq(field, false)
      .neq('plan', 'b2b')
      .is('deleted_at', null)
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
        idioma: card.idioma,
      });

      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
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
