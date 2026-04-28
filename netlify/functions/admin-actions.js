'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PLAN_DAYS = { base: 90, pro: 365, renovacion: 365 };

function auditLog(db, ip, action, slug, field, oldValue, newValue) {
  db.from('admin_audit_log').insert({
    action,
    entity_slug: slug,
    field: field || null,
    old_value: oldValue != null ? String(oldValue) : null,
    new_value: newValue != null ? String(newValue) : null,
    ip,
  }).then(({ error }) => {
    if (error) console.error('audit_log error:', error.message);
  });
}

function makeHandler(stripeClient, db) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const auth = checkAdminAuth(event);
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

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

      auditLog(db, ip, 'reactivate', slug, 'status', card.status, 'active');
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

      auditLog(db, ip, 'extend', slug, 'expires_at', card.expires_at, expires_at);
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

      auditLog(db, ip, 'refund', slug, 'status', card.status, 'inactive');
      console.log(`Tarjeta reembolsada y desactivada: ${slug} — motivo: ${reason || 'sin especificar'}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'toggle_directory') {
      const { field, value } = body;
      const allowed = ['directory_visible', 'directory_featured'];
      if (!allowed.includes(field)) {
        return { statusCode: 400, body: JSON.stringify({ error: `Campo no permitido: ${field}` }) };
      }
      if (field === 'directory_visible' && !!value && (!card.category_id || !card.city_slug)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Perfil incompleto: falta categoría o ciudad' }) };
      }
      const { error } = await db.from('cards').update({ [field]: !!value }).eq('slug', slug);
      if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

      auditLog(db, ip, 'toggle_directory', slug, field, card[field], !!value);
      console.log(`toggle_directory: ${slug} → ${field} = ${!!value}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'set_category') {
      const { sector, specialty, city_slug: newCitySlug } = body;
      if (!sector || !specialty || !newCitySlug) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan campos: sector, specialty, city_slug' }) };
      }
      const { data: cat } = await db
        .from('categories')
        .select('id')
        .eq('sector', sector)
        .eq('specialty', specialty)
        .maybeSingle();
      if (!cat?.id) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Categoría no encontrada' }) };
      }
      const { error: updateError } = await db
        .from('cards')
        .update({ category_id: cat.id, city_slug: newCitySlug, directory_visible: false })
        .eq('slug', slug);
      if (updateError) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error guardando' }) };
      }
      auditLog(db, ip, 'set_category', slug, 'category_id+city_slug', null, `${sector}/${specialty}/${newCitySlug}`);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, category_id: cat.id, city_slug: newCitySlug }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida: ${action}` }) };
  };
}

exports.handler = makeHandler(stripe, supabase);
exports.makeHandler = makeHandler;
