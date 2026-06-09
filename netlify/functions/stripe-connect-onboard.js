'use strict';

// POST /api/stripe-connect-onboard { action }   ·   Cantera capa 4a
//
// Onboarding de Stripe Connect Express para un club deportivo. El club
// conecta SU cuenta Stripe (su NIF, su IBAN, su responsabilidad fiscal);
// PerfilaPro cobra application_fee sobre las cuotas padre→club (capa 4b).
//
// Express (no Standard): Stripe hospeda el onboarding y la verificación, el
// club no se da de alta en su propio Dashboard sino que rellena un formulario
// corto Perfila→Stripe. Onboarding INCREMENTAL (collection_options.fields =
// 'currently_due'): el club empieza a cobrar en minutos con lo mínimo (CIF +
// IBAN + DNI del presidente) y completa el resto según sube volumen.
//
// Pedimos las capabilities de cobro del carril cantera: card_payments,
// sepa_debit_payments y bizum_payments (Bizum solo entra en checkouts
// one-shot puros; ver lib/enrollment-checkout.js) + transfers para los
// direct charges con application_fee.
//
// Usamos onboarding API-based (Account Links), no OAuth: creamos una cuenta
// `express` y devolvemos un enlace de onboarding hospedado por Stripe. No
// requiere STRIPE_CONNECT_CLIENT_ID.
//
// Acciones:
//   - onboard → crea la cuenta si no existe y devuelve un Account Link.
//   - status  → retrieve de la cuenta + persiste charges/payouts_enabled.
//
// Auth: JWT org-panel del club (scoped a session.orgId). Solo sports_club.
// Gateado por isCanteraActive().

const { createClient } = require('@supabase/supabase-js');
const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { authFromEvent, unauthorizedResponse } = require('./lib/panel-auth');
const { isCanteraActive, canteraDisabledResponse } = require('./lib/cantera-flag');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const defaultStripe = process.env.STRIPE_SECRET_KEY ? stripeLib(process.env.STRIPE_SECRET_KEY) : null;

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function makeHandler(stripe, db) {
  return async (event) => {
    if (!isCanteraActive()) return canteraDisabledResponse();
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    if (!stripe) return jsonResponse(503, { error: 'Stripe no configurado' });

    const rl = checkRateLimit(event, { bucket: 'connect-onboard', limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const session = authFromEvent(event);
    if (!session) return unauthorizedResponse();

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'JSON inválido' }); }
    const action = body.action || 'onboard';

    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id, slug, name, email, kind, stripe_connect_account_id, deleted_at')
      .eq('id', session.orgId).maybeSingle();
    if (orgErr) return jsonResponse(500, { error: orgErr.message });
    if (!org || org.deleted_at) return unauthorizedResponse();
    if (org.kind !== 'sports_club') return jsonResponse(403, { error: 'Solo disponible para clubes deportivos' });

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    // ── status: lee el estado real de la cuenta conectada ──
    if (action === 'status') {
      if (!org.stripe_connect_account_id) return jsonResponse(200, { ok: true, connected: false });
      let acct;
      try {
        acct = await stripe.accounts.retrieve(org.stripe_connect_account_id);
      } catch (err) {
        console.error('connect-onboard status: retrieve falló:', err.message);
        return jsonResponse(502, { error: 'No se pudo consultar la cuenta de Stripe' });
      }
      const charges = !!acct.charges_enabled;
      const payouts = !!acct.payouts_enabled;
      await db.from('organizations')
        .update({ stripe_connect_charges_enabled: charges, stripe_connect_payouts_enabled: payouts })
        .eq('id', org.id);
      return jsonResponse(200, { ok: true, connected: true, charges_enabled: charges, payouts_enabled: payouts });
    }

    // ── onboard: crea cuenta (si falta) + devuelve Account Link ──
    if (action === 'onboard') {
      let accountId = org.stripe_connect_account_id;
      if (!accountId) {
        let acct;
        try {
          acct = await stripe.accounts.create({
            type: 'express',
            country: 'ES',
            email: org.email || undefined,
            capabilities: {
              card_payments: { requested: true },
              sepa_debit_payments: { requested: true },
              bizum_payments: { requested: true },
              transfers: { requested: true },
            },
            metadata: { org_id: org.id, org_slug: org.slug },
          });
        } catch (err) {
          console.error('connect-onboard: accounts.create falló:', err.message);
          return jsonResponse(502, { error: 'No se pudo crear la cuenta de Stripe' });
        }
        accountId = acct.id;
        const { error: upErr } = await db.from('organizations')
          .update({ stripe_connect_account_id: accountId }).eq('id', org.id);
        if (upErr) return jsonResponse(500, { error: upErr.message });
      }

      let link;
      try {
        link = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${siteUrl}/panel.html?connect=refresh`,
          return_url: `${siteUrl}/panel.html?connect=done`,
          type: 'account_onboarding',
          collection_options: { fields: 'currently_due' },
        });
      } catch (err) {
        console.error('connect-onboard: accountLinks.create falló:', err.message);
        return jsonResponse(502, { error: 'No se pudo generar el enlace de onboarding' });
      }
      return jsonResponse(200, { ok: true, url: link.url, account_id: accountId });
    }

    return jsonResponse(400, { error: `Acción desconocida: ${action}` });
  };
}

exports.handler = makeHandler(defaultStripe, defaultDb);
exports.makeHandler = makeHandler;
