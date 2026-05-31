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
});
