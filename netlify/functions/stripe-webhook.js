const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(stripeClient, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
      stripeEvent = stripeClient.webhooks.constructEvent(
        event.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return { statusCode: 400, body: `Webhook Error: ${err.message}` };
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const { slug, nombre, tagline, whatsapp, zona, servicios, foto, plan } =
        session.metadata || {};

      if (!slug) {
        console.error('No slug in metadata');
        return { statusCode: 400, body: 'Missing slug in metadata' };
      }

      const { error } = await db.from('cards').upsert({
        slug,
        nombre,
        tagline,
        whatsapp,
        zona,
        servicios: servicios ? JSON.parse(servicios) : [],
        foto,
        plan: plan || 'base',
        status: 'active',
        stripe_session_id: session.id,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: 'slug' });

      if (error) {
        console.error('Supabase error:', error.message);
        return { statusCode: 500, body: 'Database error' };
      }

      console.log(`Tarjeta activada: ${slug}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  };
}

exports.handler = makeHandler(stripe, supabase);
exports.makeHandler = makeHandler;
