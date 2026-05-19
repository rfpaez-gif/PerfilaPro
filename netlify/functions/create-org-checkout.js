'use strict';

// Stripe Subscription checkout para el carril B2B (Sprint Bloque A · monetización
// recurrente por organización). Espejo de create-checkout.js pero:
//   * mode='subscription' en vez de 'payment'
//   * line_items.quantity = seats (Stripe controla MRR via subscription.quantity)
//   * 4 prices recurrentes en env (Team/Org × Monthly/Annual)
//   * agent_code (opcional, de ?via=agent-XXXX) viaja en metadata DEL SESSION
//     Y de la SUBSCRIPTION para que el webhook lo encuentre en invoice.paid
//     sin tener que retro-buscar el session original.
//
// Tier 'enterprise' NO se sirve aquí — la landing /es/empresas lo gatea por
// el form lead-b2b (decisión de hilo: enterprise = talk to sales).

const stripeLib = require('stripe');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const defaultStripe = stripeLib(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  team:    { monthly: 'STRIPE_PRICE_TEAM_MONTHLY', annual: 'STRIPE_PRICE_TEAM_ANNUAL' },
  org:     { monthly: 'STRIPE_PRICE_ORG_MONTHLY',  annual: 'STRIPE_PRICE_ORG_ANNUAL'  },
};

const TIERS  = ['team', 'org'];
const CYCLES = ['monthly', 'annual'];
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE      = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;       // 2-40, sin guiones en extremos
const AGENT_CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;
const MAX_SEATS = 500;  // cap defensivo; un alta self-serve >500 es lead Enterprise

function makeHandler(stripe) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'create-org-checkout', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: 'JSON inválido' };
    }

    const {
      tier: rawTier,
      cycle: rawCycle,
      seats: rawSeats,
      org_name: rawOrgName,
      email: rawEmail,
      agent_code: rawAgentCode,
      slug: rawSlug,
      idioma: rawIdioma,
    } = body || {};

    const tier  = TIERS.includes(rawTier)   ? rawTier  : null;
    const cycle = CYCLES.includes(rawCycle) ? rawCycle : null;
    if (!tier)  return { statusCode: 400, body: 'tier inválido (team|org)' };
    if (!cycle) return { statusCode: 400, body: 'cycle inválido (monthly|annual)' };

    const seats = Number.isInteger(rawSeats) ? rawSeats : parseInt(rawSeats, 10);
    if (!Number.isFinite(seats) || seats < 1 || seats > MAX_SEATS) {
      return { statusCode: 400, body: `seats debe ser entero 1-${MAX_SEATS}` };
    }

    const orgName = typeof rawOrgName === 'string' ? rawOrgName.trim() : '';
    if (orgName.length < 2 || orgName.length > 100) {
      return { statusCode: 400, body: 'org_name requerido (2-100 chars)' };
    }

    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) {
      return { statusCode: 400, body: 'email inválido' };
    }

    // agent_code opcional. Si llega malformado (alguien forjando ?via en la URL),
    // lo silenciamos (cae a venta directa founder) en vez de 400 — el carril
    // debe ser tolerante a links rotos compartidos por chat.
    let agentCode = '';
    if (typeof rawAgentCode === 'string' && rawAgentCode.trim()) {
      const candidate = rawAgentCode.trim();
      if (AGENT_CODE_RE.test(candidate)) agentCode = candidate;
    }

    // slug opcional. Si llega válido, lo pre-reservamos en metadata para que
    // el webhook lo intente como slug de la organización (si choca con uno
    // existente, el webhook genera uno derivado). Si no llega, el webhook lo
    // genera desde org_name.
    let slug = '';
    if (typeof rawSlug === 'string' && rawSlug.trim()) {
      const candidate = rawSlug.trim().toLowerCase();
      if (SLUG_RE.test(candidate)) slug = candidate;
    }

    const idioma = rawIdioma === 'ca' ? 'ca' : 'es';

    const priceEnvKey = PRICES[tier][cycle];
    const priceId = process.env[priceEnvKey];
    if (!priceId) {
      // Env no configurada en este entorno (preview/dev sin Stripe live). Es
      // un error de configuración, no de input — devolvemos 503 para que la
      // landing pueda mostrar un mensaje genérico de "vuelve más tarde".
      console.error(`Precio Stripe no configurado: ${priceEnvKey}`);
      return { statusCode: 503, body: 'Configuración de pago no disponible' };
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    // Metadata compartida entre Checkout Session y Subscription. La Session
    // metadata se usa en checkout.session.completed; la Subscription metadata
    // se usa en customer.subscription.* e invoice.paid (donde no llega la
    // session original). Persistir agent_code en ambos sitios evita lookups
    // cross-object en el webhook.
    const metadata = {
      kind: 'org-subscription',
      tier,
      cycle,
      seats: String(seats),
      org_name: orgName.substring(0, 100),
      slug,
      agent_code: agentCode,
      idioma,
    };

    try {
      const sessionParams = {
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: seats }],
        customer_email: email,
        metadata,
        subscription_data: { metadata },
        // Permite al cliente cambiar seats desde el portal de Stripe en el
        // futuro sin que el flow se rompa: la subscription tiene metadata
        // propia que el webhook lee.
        allow_promotion_codes: true,
        success_url: `${siteUrl}/${idioma}/empresas?subscribed=1`,
        cancel_url:  `${siteUrl}/${idioma}/empresas`,
      };

      const session = await stripe.checkout.sessions.create(sessionParams);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: session.url }),
      };
    } catch (err) {
      console.error('Stripe error (org-checkout):', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  };
}

exports.handler = makeHandler(defaultStripe);
exports.makeHandler = makeHandler;
