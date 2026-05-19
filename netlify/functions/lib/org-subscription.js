'use strict';

// Lógica de Stripe Subscription para el carril B2B (Bloque B).
//
// El webhook stripe-webhook.js delega aquí los eventos de subscription
// para mantener el handler principal legible. Cada función opera sobre
// objetos Stripe ya parseados (no hace network) y devuelve { ok, ... }
// con el efecto persistente o el motivo del no-op.
//
// Idempotencia: todas las operaciones son safe re-run. Stripe puede
// reenviar el mismo evento (timeout del webhook, replay manual) y el
// resultado en BD debe ser idéntico.

const crypto = require('crypto');
const { signPanelSession } = require('./panel-auth');
const { buildEmailLayout, COLORS } = require('./email-layout');

const VALID_TIERS  = new Set(['team', 'org', 'enterprise']);
const VALID_CYCLES = new Set(['monthly', 'annual']);

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 35);
}

// Encuentra un slug libre. Si el sugerido colisiona con otra org no
// soft-deleted, intenta `-2`, `-3`, … hasta 50. Fallback con sufijo
// random de 4 chars (cobertura para nombres extremadamente comunes).
async function resolveUniqueOrgSlug(db, suggested, orgName) {
  let base = (suggested && suggested.trim()) || slugify(orgName) || 'org';
  base = base.substring(0, 35);

  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await db
      .from('organizations')
      .select('id')
      .eq('slug', candidate)
      .is('deleted_at', null)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

const ORG_WELCOME_STRINGS = {
  es: {
    subject: (n) => `${n}, tu equipo en PerfilaPro ya está activo 🚀`,
    preheader: 'Tu suscripción está activa. Entra a tu panel para invitar al equipo y subir el logo.',
    title: (n) => `¡Bienvenidos, ${n}!`,
    intro: 'Tu suscripción acaba de activarse. Desde tu panel puedes subir el logo, configurar branding e invitar a todo el equipo en lote.',
    panelCta: 'Abrir mi panel →',
    whatNowTitle: '¿Qué hacer ahora?',
    step1: '1. Sube tu logo y elige el color principal (Branding).',
    step2: '2. Invita al equipo desde la pestaña Equipo (acepta lotes de hasta 100 emails).',
    step3: '3. Comparte el enlace público de tu organización con clientes y partners.',
    publicLink: 'Tu página pública',
    accessNote: 'Este enlace es válido durante 7 días. Si caduca, vuelve a /panel.html con el email de la organización y te enviaremos uno nuevo.',
    footerNote: '🔒 Mantén este email privado — el enlace da acceso al panel de tu organización.',
  },
  ca: {
    subject: (n) => `${n}, el teu equip a PerfilaPro ja és actiu 🚀`,
    preheader: 'La teva subscripció és activa. Entra al teu panell per convidar l\'equip i pujar el logo.',
    title: (n) => `Benvinguts, ${n}!`,
    intro: 'La teva subscripció acaba d\'activar-se. Des del teu panell pots pujar el logo, configurar el branding i convidar tot l\'equip de cop.',
    panelCta: 'Obrir el meu panell →',
    whatNowTitle: 'Què cal fer ara?',
    step1: '1. Puja el teu logo i tria el color principal (Branding).',
    step2: '2. Convida l\'equip des de la pestanya Equip (admet lots fins a 100 emails).',
    step3: '3. Comparteix l\'enllaç públic de la teva organització amb clients i partners.',
    publicLink: 'La teva pàgina pública',
    accessNote: 'Aquest enllaç és vàlid durant 7 dies. Si caduca, torna a /panel.html amb l\'email de l\'organització i te n\'enviarem un de nou.',
    footerNote: '🔒 Mantén aquest email privat — l\'enllaç dóna accés al panell de la teva organització.',
  },
};

function buildOrgWelcomeEmail({ orgName, orgSlug, panelUrl, publicUrl, idioma = 'es', siteUrl }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = ORG_WELCOME_STRINGS[lang];

  const bodyHtml = `
    <p style="margin:0 0 20px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">${T.intro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
      <tr><td align="center">
        <a href="${panelUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.panelCta}</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
      <tr>
        <td style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:22px 22px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">${T.whatNowTitle}</p>
          <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">${T.step1}</p>
          <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">${T.step2}</p>
          <p style="margin:0;font-size:14px;color:${COLORS.ink};line-height:1.6">${T.step3}</p>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
      <tr>
        <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:10px;padding:14px 18px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${T.publicLink}</p>
          <a href="${publicUrl}" style="font-size:14px;font-weight:600;color:${COLORS.accent};text-decoration:none;word-break:break-all">${publicUrl}</a>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">${T.accessNote}</p>
  `;

  const html = buildEmailLayout({
    preheader: T.preheader,
    title: T.title(orgName),
    bodyHtml,
    cta: null,
    footerNote: T.footerNote,
    siteUrl,
    idioma: lang,
  });

  return { subject: T.subject(orgName), html };
}

// ─── checkout.session.completed (B2B kind) ───────────────────────────────────
//
// Stripe nos manda el session completo. Lo importante:
//   * session.subscription   — id (string) de la subscription creada
//   * session.customer       — id del Customer
//   * session.metadata       — lo que pusimos en create-org-checkout
//   * session.subscription_details? no — ese campo no existe, hay que pedirlo
//     con stripe.subscriptions.retrieve() si necesitamos current_period_end
//     antes de que llegue customer.subscription.created. Aquí lo dejamos NULL
//     y el siguiente evento subscription.updated lo rellenará.
async function handleSubscriptionCheckout({ db, emailClient, session, siteUrl }) {
  const md = session.metadata || {};
  if (md.kind !== 'org-subscription') {
    return { ok: false, reason: 'not-b2b-kind' };
  }

  const tier  = VALID_TIERS.has(md.tier)   ? md.tier  : null;
  const cycle = VALID_CYCLES.has(md.cycle) ? md.cycle : null;
  const seats = parseInt(md.seats, 10);
  const orgName = (md.org_name || '').toString().trim().substring(0, 100);
  const agentCode = md.agent_code || null;
  const idioma = md.idioma === 'ca' ? 'ca' : 'es';
  const suggestedSlug = (md.slug || '').toString().trim();

  if (!tier || !cycle || !Number.isFinite(seats) || seats < 1 || !orgName) {
    console.error('B2B checkout con metadata incompleta', { tier, cycle, seats, orgName });
    return { ok: false, reason: 'metadata-incomplete' };
  }

  const customerEmail = (session.customer_details && session.customer_details.email)
    || session.customer_email
    || null;

  // Idempotencia: si la subscription_id ya está en BD (replay del webhook),
  // no insertamos otra fila — devolvemos ok con la org existente.
  if (session.subscription) {
    const { data: existing } = await db
      .from('organizations')
      .select('id, slug, email')
      .eq('stripe_subscription_id', session.subscription)
      .maybeSingle();
    if (existing) {
      return { ok: true, orgId: existing.id, orgSlug: existing.slug, replayed: true };
    }
  }

  const slug = await resolveUniqueOrgSlug(db, suggestedSlug, orgName);

  const row = {
    slug,
    name: orgName,
    email: customerEmail,
    agent_code: agentCode,
    stripe_customer_id:     session.customer || null,
    stripe_subscription_id: session.subscription || null,
    tier, cycle, seats,
    subscription_status: 'active',
  };

  const { data: inserted, error } = await db
    .from('organizations')
    .insert(row)
    .select('id, slug, email')
    .single();

  if (error) {
    console.error('Error insertando org B2B:', error.message);
    return { ok: false, reason: 'db-insert-failed', error: error.message };
  }

  // Welcome email con magic-link al panel. No bloquea el ok del webhook — si
  // Resend falla, el cliente puede usar /panel.html con su email y recibir
  // el magic-link estándar de panel-auth.
  if (customerEmail && emailClient) {
    try {
      const sessionToken = signPanelSession({ orgId: inserted.id, orgSlug: inserted.slug });
      const panelUrl  = `${siteUrl}/panel.html?session=${sessionToken}`;
      const publicUrl = `${siteUrl}/e/${inserted.slug}`;
      const { subject, html } = buildOrgWelcomeEmail({
        orgName, orgSlug: inserted.slug, panelUrl, publicUrl, idioma, siteUrl,
      });
      await emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: customerEmail,
        subject, html,
      });
    } catch (err) {
      console.error('Welcome email B2B falló (no fatal):', err.message);
    }
  }

  return { ok: true, orgId: inserted.id, orgSlug: inserted.slug, replayed: false };
}

// ─── customer.subscription.created / updated ─────────────────────────────────
//
// El evento subscription trae el estado canónico que Stripe quiere que
// reflejemos: status, items.quantity (seats), current_period_end. Si la
// org ya existe (creada por checkout.session.completed), UPDATE; si no
// (caso raro de subscription creada por API), no-op.
async function handleSubscriptionUpdated({ db, subscription }) {
  if (!subscription || !subscription.id) {
    return { ok: false, reason: 'no-subscription-id' };
  }

  const subId = subscription.id;
  const status = subscription.status || null;
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const seats = item && Number.isFinite(item.quantity) ? item.quantity : null;
  const cpe = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const updates = {};
  if (status) updates.subscription_status = status;
  if (seats !== null) updates.seats = seats;
  if (cpe) updates.current_period_end = cpe;

  if (Object.keys(updates).length === 0) {
    return { ok: false, reason: 'nothing-to-update' };
  }

  const { data, error } = await db
    .from('organizations')
    .update(updates)
    .eq('stripe_subscription_id', subId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error UPDATE org subscription:', error.message);
    return { ok: false, reason: 'db-update-failed', error: error.message };
  }
  if (!data) {
    // La sub puede haber llegado antes que el checkout.session.completed
    // (carrera en Stripe). No es fatal — el próximo evento volverá a
    // intentarlo y entonces la org ya existirá.
    return { ok: false, reason: 'org-not-found-yet' };
  }
  return { ok: true, orgId: data.id, updates };
}

// ─── customer.subscription.deleted ───────────────────────────────────────────
//
// Marca la org como canceled, no soft-delete. La org sigue accesible
// hasta current_period_end para que los cards públicos no se rompan;
// la limpieza efectiva (cards desvinculadas, soft-delete) la hace el
// admin manualmente desde admin-orgs cuando vea procedente.
async function handleSubscriptionDeleted({ db, subscription }) {
  if (!subscription || !subscription.id) {
    return { ok: false, reason: 'no-subscription-id' };
  }
  const { data, error } = await db
    .from('organizations')
    .update({ subscription_status: 'canceled' })
    .eq('stripe_subscription_id', subscription.id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Error UPDATE org canceled:', error.message);
    return { ok: false, reason: 'db-update-failed', error: error.message };
  }
  if (!data) return { ok: false, reason: 'org-not-found' };
  return { ok: true, orgId: data.id };
}

// ─── invoice.paid ────────────────────────────────────────────────────────────
//
// Inserta una fila en org_invoices con snapshot de agent_code/tier/cycle/seats
// del momento del cobro. Sirve para que agent-data calcule comisión recurrente
// sin re-llamar a Stripe en cada carga del dashboard del agente.
//
// Idempotencia: stripe_invoice_id es UNIQUE. Si el mismo invoice se reintenta
// (replay del webhook), upsert con onConflict:'stripe_invoice_id' no duplica.
async function handleInvoicePaid({ db, invoice }) {
  if (!invoice || !invoice.id) {
    return { ok: false, reason: 'no-invoice-id' };
  }

  // Solo consideramos invoices de subscription (las one-shot del carril
  // autónomo viajan por checkout.session.completed). Defensivo: si llega
  // una invoice sin subscription, ignoramos.
  const subId = invoice.subscription || null;
  if (!subId) {
    return { ok: false, reason: 'not-subscription-invoice' };
  }

  // Resolvemos la org via subscription_id. Si la sub aún no está en BD
  // (carrera con checkout.session.completed), persistimos sin organization_id;
  // un reconciler futuro podría hilar después. Para el cálculo de comisión
  // basta con agent_code, que viaja en la subscription metadata.
  const { data: org } = await db
    .from('organizations')
    .select('id, agent_code, tier, cycle, seats')
    .eq('stripe_subscription_id', subId)
    .is('deleted_at', null)
    .maybeSingle();

  const paidAt = invoice.status_transitions && invoice.status_transitions.paid_at
    ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
    : new Date().toISOString();

  const periodStart = invoice.period_start
    ? new Date(invoice.period_start * 1000).toISOString()
    : null;
  const periodEnd = invoice.period_end
    ? new Date(invoice.period_end * 1000).toISOString()
    : null;

  // agent_code y tier/cycle/seats: preferimos el snapshot vivo de la org
  // (refleja cambios desde el último invoice); si no hay org aún, caemos
  // a la metadata de la subscription (que create-org-checkout replicó).
  const subMd = invoice.subscription_details && invoice.subscription_details.metadata
    || invoice.lines && invoice.lines.data && invoice.lines.data[0] && invoice.lines.data[0].metadata
    || {};

  const agentCode = org?.agent_code || subMd.agent_code || null;
  const tier      = org?.tier  || (VALID_TIERS.has(subMd.tier)   ? subMd.tier  : null);
  const cycle     = org?.cycle || (VALID_CYCLES.has(subMd.cycle) ? subMd.cycle : null);
  const seats     = org?.seats || (Number.isFinite(parseInt(subMd.seats, 10)) ? parseInt(subMd.seats, 10) : null);

  const row = {
    organization_id: org?.id || null,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: subId,
    amount_cents: Number.isFinite(invoice.amount_paid) ? invoice.amount_paid : (invoice.amount_due || 0),
    currency: (invoice.currency || 'eur').toLowerCase(),
    period_start: periodStart,
    period_end: periodEnd,
    paid_at: paidAt,
    agent_code: agentCode,
    tier, cycle, seats,
  };

  const { error } = await db
    .from('org_invoices')
    .upsert(row, { onConflict: 'stripe_invoice_id' });

  if (error) {
    console.error('Error upsert org_invoices:', error.message);
    return { ok: false, reason: 'db-upsert-failed', error: error.message };
  }
  return { ok: true, invoiceId: invoice.id, orgId: org?.id || null, agentCode };
}

module.exports = {
  resolveUniqueOrgSlug,
  buildOrgWelcomeEmail,
  handleSubscriptionCheckout,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
};
