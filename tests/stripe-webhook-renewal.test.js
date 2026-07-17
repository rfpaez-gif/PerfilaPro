import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleRenewalCheckout, RENEWAL_KIND } from '../netlify/functions/stripe-webhook.js';

function makeDb({ card, facturasCount = 3 } = {}) {
  const cardsUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const cardsUpdate = vi.fn(() => ({ eq: cardsUpdateEq }));
  const cardsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: card, error: null });
  const facturasInsert = vi.fn().mockResolvedValue({ error: null });
  const facturasLike = vi.fn().mockResolvedValue({ count: facturasCount, error: null });

  const from = vi.fn((table) => {
    if (table === 'cards') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: cardsSelectMaybeSingle }) }),
        update: cardsUpdate,
      };
    }
    if (table === 'facturas') {
      return {
        select: () => ({ like: facturasLike }),
        insert: facturasInsert,
      };
    }
    return {};
  });

  return { from, _cardsUpdate: cardsUpdate, _cardsUpdateEq: cardsUpdateEq, _facturasInsert: facturasInsert };
}

function baseCard(overrides = {}) {
  return {
    slug: 'ana-fontanera',
    nombre: 'Ana Fontanera',
    email: 'ana@test.com',
    idioma: 'es',
    edit_token: 'tok-abc',
    expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    plan: 'base',
    stripe_session_id: 'cs_old_session',
    deleted_at: null,
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return { id: 'cs_new_session', metadata: { kind: RENEWAL_KIND, slug: 'ana-fontanera' }, ...overrides };
}

describe('handleRenewalCheckout', () => {
  let emailClient;
  beforeEach(() => {
    emailClient = { emails: { send: vi.fn().mockResolvedValue({ id: 'email-1' }) } };
    process.env.SITE_URL = 'https://perfilapro.es';
  });

  it('reason=missing_slug si la metadata no trae slug', async () => {
    const db = makeDb({ card: baseCard() });
    const result = await handleRenewalCheckout({ db, emailClient, session: { id: 'x', metadata: {} } });
    expect(result).toEqual({ ok: false, reason: 'missing_slug' });
  });

  it('reason=card_not_found si la card no existe', async () => {
    const db = makeDb({ card: null });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    expect(result).toEqual({ ok: false, reason: 'card_not_found' });
  });

  it('reason=card_not_found si la card está soft-deleted', async () => {
    const db = makeDb({ card: baseCard({ deleted_at: new Date().toISOString() }) });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('card_not_found');
  });

  it('idempotente: replayed=true si stripe_session_id ya coincide (webhook duplicado)', async () => {
    const card = baseCard({ stripe_session_id: 'cs_new_session' });
    const db = makeDb({ card });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    expect(result).toEqual({ ok: true, slug: 'ana-fontanera', replayed: true, expires_at: card.expires_at });
    expect(db._cardsUpdate).not.toHaveBeenCalled();
  });

  it('extiende expires_at 365 días desde la fecha de caducidad actual (aún vigente)', async () => {
    const currentExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const db = makeDb({ card: baseCard({ expires_at: currentExpiry.toISOString() }) });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });

    expect(result.ok).toBe(true);
    const expectedExpiry = new Date(currentExpiry.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(new Date(result.expires_at).getTime()).toBeCloseTo(expectedExpiry.getTime(), -2);

    const updatePayload = db._cardsUpdate.mock.calls[0][0];
    expect(updatePayload.plan).toBe('renovacion');
    expect(updatePayload.status).toBe('active');
    expect(updatePayload.stripe_session_id).toBe('cs_new_session');
    expect(updatePayload.reminder_30_sent).toBe(false);
    expect(updatePayload.reminder_15_sent).toBe(false);
    expect(updatePayload.reminder_7_sent).toBe(false);
  });

  it('extiende 365 días desde HOY si la card ya caducó (no regala días muertos)', async () => {
    const pastExpiry = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const db = makeDb({ card: baseCard({ expires_at: pastExpiry.toISOString() }) });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });

    const expectedExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    // Diferencia respecto a "ahora + 365d" debe ser mínima (no partir de pastExpiry).
    expect(Math.abs(new Date(result.expires_at).getTime() - expectedExpiry.getTime())).toBeLessThan(5000);
  });

  it('envía email de confirmación y marca kit_email_sent_at', async () => {
    const db = makeDb({ card: baseCard() });
    await handleRenewalCheckout({ db, emailClient, session: makeSession() });

    expect(emailClient.emails.send).toHaveBeenCalled();
    const payload = emailClient.emails.send.mock.calls[0][0];
    expect(payload.to).toBe('ana@test.com');
    expect(payload.subject).toContain('[Renovación]');
    expect(payload.attachments.some((a) => a.filename.startsWith('factura-'))).toBe(true);

    // Segunda llamada a update: marca kit_email_sent_at tras enviar el email.
    const secondUpdatePayload = db._cardsUpdate.mock.calls[1][0];
    expect(secondUpdatePayload.kit_email_sent_at).toBeDefined();
  });

  it('usa prefijo catalán cuando idioma=ca', async () => {
    const db = makeDb({ card: baseCard({ idioma: 'ca' }) });
    await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    const payload = emailClient.emails.send.mock.calls[0][0];
    expect(payload.subject).toContain('[Renovació]');
  });

  it('guarda la factura con plan=renovacion y total 5€', async () => {
    const db = makeDb({ card: baseCard() });
    await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    const facturaRow = db._facturasInsert.mock.calls[0][0];
    expect(facturaRow.plan).toBe('renovacion');
    expect(facturaRow.total).toBe(5.00);
  });

  it('no bloquea si el UPDATE de la card falla', async () => {
    const db = makeDb({ card: baseCard() });
    db._cardsUpdate.mockReturnValueOnce({ eq: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) });
    const result = await handleRenewalCheckout({ db, emailClient, session: makeSession() });
    expect(result).toEqual({ ok: false, reason: 'db_update_failed' });
  });
});
