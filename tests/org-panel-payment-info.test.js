import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org-panel.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

vi.mock('../netlify/functions/printable-card-utils', () => ({
  buildBusinessCardPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  buildBusinessCardsBookletPDF: vi.fn().mockResolvedValue(Buffer.from('x')),
  fetchLogoAsPngBuffer: vi.fn().mockResolvedValue(null),
}));

function makeChain(resolver) {
  const filters = {};
  const q = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'update', 'insert', 'maybeSingle', 'single']) {
    q[m] = vi.fn((...args) => { if (m === 'eq' && args.length >= 2) filters[args[0]] = args[1]; return q; });
  }
  q.then = (resolve, reject) => Promise.resolve(resolver(filters)).then(resolve, reject);
  return q;
}
function makeDb(resolvers) {
  return { from: vi.fn((t) => makeChain(resolvers[t] || (() => ({ data: [], error: null })))) };
}

const SPORTS_ORG = { id: 'org-1', name: 'CD Test', slug: 'cd-test', kind: 'sports_club', sport: 'futbol', deleted_at: null };

function event(action, body = {}, token) {
  const headers = { 'x-forwarded-for': '9.9.9.9' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { httpMethod: 'POST', headers, body: JSON.stringify({ action, ...body }) };
}

describe('org-panel · update_payment_info', () => {
  let token;
  beforeEach(() => {
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-secret';
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    token = signPanelSession({ orgId: 'org-1', orgSlug: 'cd-test' });
  });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const db = makeDb({ organizations: () => ({ data: SPORTS_ORG, error: null }) });
    const res = await makeHandler(db, null)(event('update_payment_info', { payment_iban: 'ES12' }, token));
    expect(res.statusCode).toBe(410);
  });

  it('400 si la org no es club deportivo', async () => {
    const db = makeDb({ organizations: () => ({ data: { ...SPORTS_ORG, kind: 'business' }, error: null }) });
    const res = await makeHandler(db, null)(event('update_payment_info', {}, token));
    expect(res.statusCode).toBe(400);
  });

  it('200 guarda y sanea (strip tags + recorta longitud)', async () => {
    const db = makeDb({ organizations: () => ({ data: SPORTS_ORG, error: null }) });
    const res = await makeHandler(db, null)(event('update_payment_info', {
      payment_iban: '  ES12 <b>x</b>  ',
      payment_bizum: '600111222',
      payment_instructions: 'a'.repeat(600),
    }, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.payment_iban).toBe('ES12 x');
    expect(body.payment_bizum).toBe('600111222');
    expect(body.payment_instructions.length).toBe(500);
  });

  it('200 con campos vacíos → null (limpia los datos)', async () => {
    const db = makeDb({ organizations: () => ({ data: SPORTS_ORG, error: null }) });
    const res = await makeHandler(db, null)(event('update_payment_info', { payment_iban: '   ', payment_bizum: '' }, token));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.payment_iban).toBe(null);
    expect(body.payment_bizum).toBe(null);
    expect(body.payment_instructions).toBe(null);
  });
});
