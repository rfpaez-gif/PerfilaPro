import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  resolveUniqueOrgSlug,
  handleSubscriptionCheckout,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
} from '../netlify/functions/lib/org-subscription.js';

// ── Mock builders ────────────────────────────────────────────────────────────
//
// Las funciones de org-subscription hacen llamadas predecibles:
//   * .select().eq().maybeSingle()           → lookup org
//   * .select().eq().is().maybeSingle()      → lookup org no soft-deleted
//   * .insert(row).select(cols).single()     → crear org
//   * .update(row).eq().select().maybeSingle() → update por sub id
//   * .upsert(row, { onConflict })           → upsert org_invoice
//
// Cada test construye un mock que devuelve los datos esperados por el
// camino que ejercita. Esto evita un god-mock que rastree decenas de
// posibles chains.

function chainable(terminalKey, terminalValue) {
  const c = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
  };
  c[terminalKey] = vi.fn().mockResolvedValue(terminalValue);
  return c;
}

const emailClient = { emails: { send: vi.fn().mockResolvedValue({ id: 'e1' }) } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
});

// ─── resolveUniqueOrgSlug ────────────────────────────────────────────────────

describe('resolveUniqueOrgSlug', () => {
  it('devuelve la sugerencia si no choca', async () => {
    const db = { from: vi.fn(() => chainable('maybeSingle', { data: null, error: null })) };
    const slug = await resolveUniqueOrgSlug(db, 'acme-studio', 'Acme Studio');
    expect(slug).toBe('acme-studio');
  });

  it('genera desde org_name si suggested viene vacío', async () => {
    const db = { from: vi.fn(() => chainable('maybeSingle', { data: null, error: null })) };
    const slug = await resolveUniqueOrgSlug(db, '', 'Mi Despacho de Abogados');
    expect(slug).toBe('mi-despacho-de-abogados');
  });

  it('añade -2 si el base colisiona, -3 si ese también', async () => {
    let calls = 0;
    const db = {
      from: vi.fn(() => {
        const seen = [null, null, null];
        seen[0] = { data: { id: 'x' }, error: null };  // acme exists
        seen[1] = { data: { id: 'y' }, error: null };  // acme-2 exists
        seen[2] = { data: null, error: null };          // acme-3 libre
        const c = chainable('maybeSingle', seen[calls]);
        calls++;
        return c;
      }),
    };
    const slug = await resolveUniqueOrgSlug(db, 'acme', 'Acme');
    expect(slug).toBe('acme-3');
  });

  it('fallback "org" si nombre y sugerencia están ambos vacíos', async () => {
    const db = { from: vi.fn(() => chainable('maybeSingle', { data: null, error: null })) };
    const slug = await resolveUniqueOrgSlug(db, '', '');
    expect(slug).toBe('org');
  });
});

// ─── handleSubscriptionCheckout ──────────────────────────────────────────────

describe('handleSubscriptionCheckout', () => {
  const baseSession = {
    id: 'cs_test_b2b_1',
    subscription: 'sub_test_1',
    customer: 'cus_test_1',
    customer_details: { email: 'admin@acme.com' },
    metadata: {
      kind: 'org-subscription',
      tier: 'team',
      cycle: 'monthly',
      seats: '10',
      org_name: 'Acme Studio',
      slug: 'acme-studio',
      agent_code: 'AGENT01',
      idioma: 'es',
    },
  };

  it('no-op si metadata.kind no es org-subscription', async () => {
    const db = { from: vi.fn() };
    const r = await handleSubscriptionCheckout({
      db, emailClient, session: { ...baseSession, metadata: { kind: 'something-else' } },
      siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-b2b-kind');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rechaza metadata incompleta (sin tier)', async () => {
    const db = { from: vi.fn() };
    const r = await handleSubscriptionCheckout({
      db, emailClient,
      session: { ...baseSession, metadata: { ...baseSession.metadata, tier: '' } },
      siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('metadata-incomplete');
  });

  it('rechaza seats no numérico', async () => {
    const db = { from: vi.fn() };
    const r = await handleSubscriptionCheckout({
      db, emailClient,
      session: { ...baseSession, metadata: { ...baseSession.metadata, seats: 'abc' } },
      siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('metadata-incomplete');
  });

  it('idempotente: replay del mismo subscription_id devuelve replayed=true', async () => {
    const lookupChain = chainable('maybeSingle', { data: { id: 'org-existing', slug: 'acme-studio', email: 'a@b.c' }, error: null });
    const db = { from: vi.fn(() => lookupChain) };
    const r = await handleSubscriptionCheckout({
      db, emailClient, session: baseSession, siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(true);
    expect(r.orgId).toBe('org-existing');
  });

  it('inserta org nueva con tier/cycle/seats/agent_code y manda welcome email', async () => {
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx === 1) {
          // lookup por subscription_id → no existe
          return chainable('maybeSingle', { data: null, error: null });
        }
        if (callIdx === 2) {
          // resolveUniqueOrgSlug: lookup slug → libre
          return chainable('maybeSingle', { data: null, error: null });
        }
        // insert → devuelve la fila creada
        return chainable('single', { data: { id: 'new-org-uuid', slug: 'acme-studio', email: 'admin@acme.com' }, error: null });
      }),
    };
    const r = await handleSubscriptionCheckout({
      db, emailClient, session: baseSession, siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(false);
    expect(r.orgId).toBe('new-org-uuid');
    expect(r.orgSlug).toBe('acme-studio');
    expect(emailClient.emails.send).toHaveBeenCalledOnce();

    const emailCall = emailClient.emails.send.mock.calls[0][0];
    expect(emailCall.to).toBe('admin@acme.com');
    expect(emailCall.html).toMatch(/panel\.html\?session=/);
    expect(emailCall.html).toMatch(/\/e\/acme-studio/);
  });

  it('email en catalán cuando idioma=ca', async () => {
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx <= 2) return chainable('maybeSingle', { data: null, error: null });
        return chainable('single', { data: { id: 'new-org', slug: 'acme', email: 'a@b.c' }, error: null });
      }),
    };
    await handleSubscriptionCheckout({
      db, emailClient,
      session: { ...baseSession, metadata: { ...baseSession.metadata, idioma: 'ca' } },
      siteUrl: 'https://perfilapro.es',
    });
    const emailCall = emailClient.emails.send.mock.calls[0][0];
    expect(emailCall.subject).toMatch(/equip/);   // catalán: "equip" vs "equipo"
  });

  it('insertar sin email no rompe: orgs sin customer_details siguen creándose', async () => {
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx <= 2) return chainable('maybeSingle', { data: null, error: null });
        return chainable('single', { data: { id: 'org-x', slug: 'acme-studio', email: null }, error: null });
      }),
    };
    const r = await handleSubscriptionCheckout({
      db, emailClient,
      session: { ...baseSession, customer_details: null, customer_email: null },
      siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(true);
    expect(emailClient.emails.send).not.toHaveBeenCalled();
  });

  it('error DB en insert se propaga como ok=false', async () => {
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx <= 2) return chainable('maybeSingle', { data: null, error: null });
        return chainable('single', { data: null, error: { message: 'unique violation' } });
      }),
    };
    const r = await handleSubscriptionCheckout({
      db, emailClient, session: baseSession, siteUrl: 'https://perfilapro.es',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db-insert-failed');
  });
});

// ─── handleSubscriptionUpdated ───────────────────────────────────────────────

describe('handleSubscriptionUpdated', () => {
  it('actualiza seats, status y current_period_end', async () => {
    const updateChain = chainable('maybeSingle', { data: { id: 'org-1' }, error: null });
    const db = { from: vi.fn(() => updateChain) };

    const cpeUnix = 1900000000;  // ~2030
    const r = await handleSubscriptionUpdated({
      db,
      subscription: {
        id: 'sub_test',
        status: 'active',
        current_period_end: cpeUnix,
        items: { data: [{ quantity: 25 }] },
      },
    });

    expect(r.ok).toBe(true);
    expect(r.orgId).toBe('org-1');
    expect(updateChain.update).toHaveBeenCalledWith({
      subscription_status: 'active',
      seats: 25,
      current_period_end: new Date(cpeUnix * 1000).toISOString(),
    });
  });

  it('actualiza solo lo que viene (status sin seats)', async () => {
    const updateChain = chainable('maybeSingle', { data: { id: 'org-1' }, error: null });
    const db = { from: vi.fn(() => updateChain) };
    await handleSubscriptionUpdated({
      db, subscription: { id: 'sub_test', status: 'past_due', items: { data: [] } },
    });
    expect(updateChain.update).toHaveBeenCalledWith({ subscription_status: 'past_due' });
  });

  it('reason="org-not-found-yet" si la sub_id no existe en BD', async () => {
    const updateChain = chainable('maybeSingle', { data: null, error: null });
    const db = { from: vi.fn(() => updateChain) };
    const r = await handleSubscriptionUpdated({
      db, subscription: { id: 'sub_nuevo', status: 'active', items: { data: [{ quantity: 5 }] } },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('org-not-found-yet');
  });

  it('reason="nothing-to-update" si Stripe manda payload sin datos útiles', async () => {
    const db = { from: vi.fn() };
    const r = await handleSubscriptionUpdated({
      db, subscription: { id: 'sub_test' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('nothing-to-update');
    expect(db.from).not.toHaveBeenCalled();
  });
});

// ─── handleSubscriptionDeleted ───────────────────────────────────────────────

describe('handleSubscriptionDeleted', () => {
  it('marca subscription_status=canceled', async () => {
    const updateChain = chainable('maybeSingle', { data: { id: 'org-1' }, error: null });
    const db = { from: vi.fn(() => updateChain) };
    const r = await handleSubscriptionDeleted({
      db, subscription: { id: 'sub_test' },
    });
    expect(r.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledWith({ subscription_status: 'canceled' });
  });

  it('reason="org-not-found" si la sub no existe', async () => {
    const updateChain = chainable('maybeSingle', { data: null, error: null });
    const db = { from: vi.fn(() => updateChain) };
    const r = await handleSubscriptionDeleted({
      db, subscription: { id: 'sub_x' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('org-not-found');
  });
});

// ─── handleInvoicePaid ───────────────────────────────────────────────────────

describe('handleInvoicePaid', () => {
  const baseInvoice = {
    id: 'in_test_1',
    subscription: 'sub_test',
    amount_paid: 5000,
    currency: 'eur',
    period_start: 1700000000,
    period_end:   1702592000,
    status_transitions: { paid_at: 1700000010 },
    subscription_details: {
      metadata: { tier: 'team', cycle: 'monthly', seats: '5', agent_code: 'AGENT01' },
    },
  };

  it('skipea invoices sin subscription (one-shot del carril autónomo)', async () => {
    const db = { from: vi.fn() };
    const r = await handleInvoicePaid({
      db, invoice: { ...baseInvoice, subscription: null },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-subscription-invoice');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('inserta org_invoice con snapshot de la org existente (preferido)', async () => {
    let callIdx = 0;
    let upsertChain;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx === 1) {
          // org lookup → existe con agent_code y seats actuales
          return chainable('maybeSingle', {
            data: { id: 'org-1', agent_code: 'AGENT01', tier: 'team', cycle: 'monthly', seats: 7 },
            error: null,
          });
        }
        upsertChain = chainable('upsert', { error: null });
        // upsert termina sin .single() — la chain devuelve directamente
        upsertChain.upsert = vi.fn().mockResolvedValue({ error: null });
        return upsertChain;
      }),
    };
    const r = await handleInvoicePaid({ db, invoice: baseInvoice });
    expect(r.ok).toBe(true);
    expect(r.orgId).toBe('org-1');
    expect(r.agentCode).toBe('AGENT01');

    const row = upsertChain.upsert.mock.calls[0][0];
    expect(row.organization_id).toBe('org-1');
    expect(row.stripe_invoice_id).toBe('in_test_1');
    expect(row.amount_cents).toBe(5000);
    expect(row.currency).toBe('eur');
    expect(row.seats).toBe(7);          // viene del snapshot de la org, no de subMd
    expect(row.agent_code).toBe('AGENT01');

    const opts = upsertChain.upsert.mock.calls[0][1];
    expect(opts.onConflict).toBe('stripe_invoice_id');
  });

  it('fallback a metadata de la sub si la org aún no está en BD (carrera)', async () => {
    let callIdx = 0;
    let upsertChain;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx === 1) return chainable('maybeSingle', { data: null, error: null });
        upsertChain = chainable('upsert', { error: null });
        upsertChain.upsert = vi.fn().mockResolvedValue({ error: null });
        return upsertChain;
      }),
    };
    await handleInvoicePaid({ db, invoice: baseInvoice });
    const row = upsertChain.upsert.mock.calls[0][0];
    expect(row.organization_id).toBe(null);
    expect(row.agent_code).toBe('AGENT01');   // de subMd
    expect(row.tier).toBe('team');
    expect(row.seats).toBe(5);
  });

  it('amount_paid 0 (invoice gratis) se persiste como 0', async () => {
    let upsertChain;
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx === 1) return chainable('maybeSingle', { data: { id: 'org-1', agent_code: null, tier: 'team', cycle: 'monthly', seats: 1 }, error: null });
        upsertChain = chainable('upsert', { error: null });
        upsertChain.upsert = vi.fn().mockResolvedValue({ error: null });
        return upsertChain;
      }),
    };
    await handleInvoicePaid({ db, invoice: { ...baseInvoice, amount_paid: 0 } });
    expect(upsertChain.upsert.mock.calls[0][0].amount_cents).toBe(0);
  });

  it('error DB en upsert se propaga como ok=false', async () => {
    let callIdx = 0;
    const db = {
      from: vi.fn(() => {
        callIdx++;
        if (callIdx === 1) return chainable('maybeSingle', { data: null, error: null });
        const c = chainable('upsert', { error: { message: 'db down' } });
        c.upsert = vi.fn().mockResolvedValue({ error: { message: 'db down' } });
        return c;
      }),
    };
    const r = await handleInvoicePaid({ db, invoice: baseInvoice });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db-upsert-failed');
  });
});
