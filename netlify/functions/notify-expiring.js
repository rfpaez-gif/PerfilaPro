const { createClient } = require('@supabase/supabase-js');
const { send, expiryEmail } = require('./utils/email');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async () => {
  const now = new Date();

  const windows = [
    { days: 30, label: '30 días' },
    { days: 7,  label: '7 días'  },
  ];

  for (const { days } of windows) {
    const from = new Date(now.getTime() + (days - 1) * 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000).toISOString();

    const { data: cards, error } = await supabase
      .from('cards')
      .select('slug, nombre, email, expires_at')
      .eq('status', 'active')
      .not('email', 'is', null)
      .gte('expires_at', from)
      .lte('expires_at', to);

    if (error) {
      console.error(`[notify-expiring] Error consultando tarjetas (${days}d):`, error.message);
      continue;
    }

    for (const card of cards || []) {
      const daysLeft = Math.round((new Date(card.expires_at) - now) / (1000 * 60 * 60 * 24));
      const { subject, html, text } = expiryEmail({ nombre: card.nombre, slug: card.slug, daysLeft });
      await send({ to: card.email, subject, html, text });
      console.log(`[notify-expiring] Aviso enviado a ${card.email} (${card.slug}, ${daysLeft}d)`);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
