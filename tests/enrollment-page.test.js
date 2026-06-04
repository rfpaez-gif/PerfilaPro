import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/enrollment-page.js';

const TOKEN = 'b'.repeat(32);
const OPEN = { id: 'camp-1', organization_id: 'club-1', season: '2025-26', status: 'open', matricula_cents: 3500, monthly_fee_cents: 3000, num_installments: 9 };
const ORG = { id: 'club-1', name: 'EF Universal', kind: 'sports_club', deleted_at: null };

function makeDb({ campaign = OPEN, org = ORG } = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'enrollment_campaigns') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: campaign, error: null }) }) }) };
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: org, error: null }) }) }) };
      return {};
    }),
  };
}
const ev = (path, token) => ({ httpMethod: 'GET', headers: {}, path, queryStringParameters: token ? { token } : {} });

describe('enrollment-page', () => {
  beforeEach(() => { process.env.CANTERA_VERTICAL_ACTIVE = '1'; });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('404 si el carril está off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeHandler(makeDb())(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.statusCode).toBe(404);
  });

  it('siempre noindex', async () => {
    const res = await makeHandler(makeDb())(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.headers['X-Robots-Tag']).toMatch(/noindex/);
  });

  it('token mal formado → página cerrada', async () => {
    const res = await makeHandler(makeDb())(ev('/es/inscripcion/xxx'));
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Inscripciones cerradas');
  });

  it('campaña abierta → formulario con club + importes', async () => {
    const res = await makeHandler(makeDb())(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('EF Universal');
    expect(res.body).toContain('2025-26');
    expect(res.body).toContain('id="enrForm"');
    expect(res.body).toContain('35,00'); // matrícula formateada
    expect(res.body).toContain('payment_choice');
  });

  it('campaña cerrada → página informativa sin form', async () => {
    const res = await makeHandler(makeDb({ campaign: { ...OPEN, status: 'closed' } }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Inscripciones cerradas');
    expect(res.body).not.toContain('id="enrForm"');
  });

  it('club soft-deleted o no deportivo → cerrada', async () => {
    const res = await makeHandler(makeDb({ org: { ...ORG, deleted_at: '2026-01-01' } }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).toContain('Inscripciones cerradas');
  });

  it('detecta idioma ca por el path', async () => {
    const res = await makeHandler(makeDb())(ev(`/ca/inscripcion/${TOKEN}`));
    expect(res.body).toContain('lang="ca"');
  });

  it('escapa el nombre del club (XSS)', async () => {
    const res = await makeHandler(makeDb({ org: { ...ORG, name: '<script>x</script>' } }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });

  it('con plan a medida muestra los conceptos + total y solo pago al club', async () => {
    const campaign = {
      ...OPEN,
      concepts_jsonb: { plan: [
        { concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' },
        { concepto: '2º plazo', amount_cents: 10000, due_date: '2027-01-10' },
      ] },
    };
    const res = await makeHandler(makeDb({ campaign }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).toContain('Plan de pagos de la temporada');
    expect(res.body).toContain('Inscripción');
    expect(res.body).toContain('2º plazo');
    expect(res.body).toContain('260,00'); // total 160+100
    // Con plan a medida el cobro es manual: no se ofrece el radio "online".
    expect(res.body).toContain('value="club"');
    expect(res.body).not.toContain('value="online"');
  });

  it('escapa el nombre del concepto (XSS)', async () => {
    const campaign = { ...OPEN, concepts_jsonb: { plan: [{ concepto: '<img src=x>', amount_cents: 100, due_date: '2026-09-01' }] } };
    const res = await makeHandler(makeDb({ campaign }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).not.toContain('<img src=x>');
    expect(res.body).toContain('&lt;img');
  });

  it('sin plan a medida mantiene matrícula/cuota y el pago online', async () => {
    const res = await makeHandler(makeDb())(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).toContain('35,00'); // matrícula
    expect(res.body).toContain('value="online"');
  });

  it('plan a medida + club con Stripe conectado → ofrece pago online (SEPA/tarjeta)', async () => {
    const campaign = { ...OPEN, concepts_jsonb: { plan: [{ concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' }] } };
    const org = { ...ORG, stripe_connect_charges_enabled: true };
    const res = await makeHandler(makeDb({ campaign, org }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).toContain('Plan de pagos de la temporada');
    expect(res.body).toContain('value="online"');   // online disponible
    expect(res.body).toContain('value="club"');      // + alternativa manual
    expect(res.body).toContain('SEPA');
  });

  it('plan a medida SIN Stripe conectado → solo pago al club (manual)', async () => {
    const campaign = { ...OPEN, concepts_jsonb: { plan: [{ concepto: 'Inscripción', amount_cents: 16000, due_date: '2026-09-01' }] } };
    const res = await makeHandler(makeDb({ campaign }))(ev(`/es/inscripcion/${TOKEN}`));
    expect(res.body).toContain('value="club"');
    expect(res.body).not.toContain('value="online"');
  });
});
