const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_DAYS = { base: 90, pro: 365, renovacion: 365 };

function makeHandler(stripeClient, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const auth = checkAdminAuth(event);
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const { action, slug, reason } = body;

    if (!slug) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el slug' }) };
    }

    const { data: card, error: fetchError } = await db
      .from('cards')
      .select('*')
      .eq('slug', slug)
      .single();

    if (fetchError || !card) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Tarjeta no encontrada' }) };
    }

    if (action === 'reactivate') {
      const days = PLAN_DAYS[card.plan] || 90;
      const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await db.from('cards').update({ status: 'active', expires_at }).eq('slug', slug);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

      console.log(`Tarjeta reactivada: ${slug}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, expires_at }) };
    }

    if (action === 'extend') {
      const base = card.expires_at && new Date(card.expires_at) > new Date()
        ? new Date(card.expires_at)
        : new Date();
      const expires_at = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error } = await db.from('cards').update({ expires_at }).eq('slug', slug);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

      console.log(`Tarjeta extendida 30 días: ${slug}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, expires_at }) };
    }

    if (action === 'refund') {
      if (!card.stripe_session_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'La tarjeta no tiene sesión de pago asociada' }) };
      }

      try {
        const session = await stripeClient.checkout.sessions.retrieve(card.stripe_session_id);
        if (!session.payment_intent) {
          return { statusCode: 400, body: JSON.stringify({ error: 'No se encontró el pago en Stripe' }) };
        }
        await stripeClient.refunds.create({ payment_intent: session.payment_intent });
      } catch (err) {
        console.error('Error en reembolso Stripe:', err.message);
        return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
      }

      const { error } = await db.from('cards').update({
        status: 'inactive',
        refund_reason: reason || null,
        refunded_at: new Date().toISOString(),
      }).eq('slug', slug);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

      console.log(`Tarjeta reembolsada y desactivada: ${slug} — motivo: ${reason || 'sin especificar'}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'toggle_directory') {
      const { field, value } = body;
      const allowed = ['directory_visible', 'directory_featured'];
      if (!allowed.includes(field)) {
        return { statusCode: 400, body: JSON.stringify({ error: `Campo no permitido: ${field}` }) };
      }
      const { error } = await db.from('cards').update({ [field]: !!value }).eq('slug', slug);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
      console.log(`toggle_directory: ${slug} → ${field} = ${!!value}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida: ${action}` }) };
  };
}

exports.handler = makeHandler(stripe, supabase);
exports.makeHandler = makeHandler;
