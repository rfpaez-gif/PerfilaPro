import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildDailySeries } from '../netlify/functions/profile-stats.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const VALID_TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const baseProCard  = { slug: 'ana-pro',  plan: 'pro',  edit_token_expires_at: FUTURE };
const baseFreeCard = { slug: 'pepe-free', plan: 'base', edit_token_expires_at: FUTURE };

function buildEvent({ method = 'GET', slug = 'ana-pro', token = VALID_TOKEN, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { slug, token },
    headers: { 'x-forwarded-for': ip },
  };
}

function buildDb({ card = baseProCard, cardError = null, total = 0, last7 = 0, last30Rows = [] } = {}) {
  // SELECT cards: from('cards').select().eq().eq().is().single()
  const cardsSelect = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: card, error: cardError }),
  };

  // Visits queries: tres calls distintas. Construyo un builder reusable.
  function visitsBuilder() {
    const b = {};
    b.eq    = vi.fn(() => b);
    b.gte   = vi.fn(() => b);
    return b;
  }

  // Para count head:true las dos primeras devuelven { count }
  // Para la última (sin head) devuelven { data: rows }
  let visitsCallCount = 0;
  function visitsSelect(fields, opts) {
    visitsCallCount++;
    const isHead = !!(opts && opts.head);
    const b = visitsBuilder();
    if (isHead) {
      // Primera llamada (total): solo eq.
      // Segunda llamada (last7d): eq + gte.
      // Hago que la última función llamada devuelva el count adecuado.
      const total7Resolved = visitsCallCount === 1
        ? { count: total, error: null }
        : { count: last7, error: null };
      // hacemos que tanto eq como gte resuelvan a ese valor (Supabase los permite chainables).
      b.eq  = vi.fn(() => Object.assign(visitsBuilder(), { gte: vi.fn().mockResolvedValue(total7Resolved), then: function(cb) { return Promise.resolve(total7Resolved).then(cb); } }));
      // Pero primero debemos resolver el primer eq como promesa también (call 1: solo eq)
      if (visitsCallCount === 1) {
        b.eq = vi.fn().mockResolvedValue(total7Resolved);
      } else {
        // Call 2: chain eq().gte()
        b.eq = vi.fn(() => ({ gte: vi.fn().mockResolvedValue(total7Resolved) }));
      }
    } else {
      // Call 3: select('visited_at') sin head, chain eq().gte()
      b.eq = vi.fn(() => ({ gte: vi.fn().mockResolvedValue({ data: last30Rows, error: null }) }));
    }
    return b;
  }

  return {
    from: vi.fn((table) => {
      if (table === 'cards')  return cardsSelect;
      if (table === 'visits') return { select: visitsSelect };
      throw new Error(`unexpected table: ${table}`);
    }),
    _cardsSelect: cardsSelect,
  };
}

describe('profile-stats handler', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetRateLimit(); });

  it('devuelve 405 si method no es GET', async () => {
    const res = await makeHandler(buildDb())({ httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 400 si falta slug o token', async () => {
    const res1 = await makeHandler(buildDb())({ httpMethod: 'GET', queryStringParameters: { token: VALID_TOKEN }, headers: {} });
    expect(res1.statusCode).toBe(400);
    const res2 = await makeHandler(buildDb())({ httpMethod: 'GET', queryStringParameters: { slug: 'x' }, headers: {} });
    expect(res2.statusCode).toBe(400);
  });

  it('devuelve 401 si la card no existe / token incorrecto', async () => {
    const res = await makeHandler(buildDb({ card: null, cardError: { message: 'nf' } }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 si el token ha expirado', async () => {
    const res = await makeHandler(buildDb({ card: { ...baseProCard, edit_token_expires_at: PAST } }))(buildEvent());
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 403 si la card no es Pro', async () => {
    const res = await makeHandler(buildDb({ card: baseFreeCard }))(buildEvent({ slug: 'pepe-free' }));
    expect(res.statusCode).toBe(403);
  });

  it('aplica filtro is(deleted_at, null) en el lookup', async () => {
    const db = buildDb();
    await makeHandler(db)(buildEvent());
    expect(db._cardsSelect.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('devuelve total + last7d + last30d + daily series con 30 entradas', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const db = buildDb({
      total: 42,
      last7: 7,
      last30Rows: [
        { visited_at: new Date().toISOString() },
        { visited_at: new Date().toISOString() },
        { visited_at: new Date().toISOString() },
      ],
    });
    const res = await makeHandler(db)(buildEvent());
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.total).toBe(42);
    expect(json.last7d).toBe(7);
    expect(json.last30d).toBe(3);
    expect(json.daily).toHaveLength(30);
    expect(json.daily[json.daily.length - 1].date).toBe(today);
  });

  it('devuelve 429 al superar el límite por IP (30 requests / 10 min)', async () => {
    const handler = makeHandler(buildDb());
    const ip = '9.9.9.9';
    for (let i = 0; i < 30; i++) {
      const res = await handler(buildEvent({ ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ ip }));
    expect(blocked.statusCode).toBe(429);
  });
});

describe('buildDailySeries', () => {
  it('crea 30 entradas con fechas consecutivas terminando en hoy', () => {
    const now = new Date('2026-05-04T12:00:00Z');
    const series = buildDailySeries([], now);
    expect(series).toHaveLength(30);
    expect(series[29].date).toBe('2026-05-04');
    expect(series[0].date).toBe('2026-04-05'); // 29 días antes
    expect(series.every(d => d.count === 0)).toBe(true);
  });

  it('cuenta visitas en el día correcto', () => {
    const now = new Date('2026-05-04T23:59:59Z');
    const visits = [
      { visited_at: '2026-05-04T10:00:00Z' },
      { visited_at: '2026-05-04T15:30:00Z' },
      { visited_at: '2026-05-03T08:00:00Z' },
      { visited_at: '2026-04-15T12:00:00Z' },
    ];
    const series = buildDailySeries(visits, now);
    const byDate = Object.fromEntries(series.map(d => [d.date, d.count]));
    expect(byDate['2026-05-04']).toBe(2);
    expect(byDate['2026-05-03']).toBe(1);
    expect(byDate['2026-04-15']).toBe(1);
  });

  it('ignora visitas fuera de la ventana de 30 días', () => {
    const now = new Date('2026-05-04T12:00:00Z');
    const visits = [
      { visited_at: '2026-01-01T10:00:00Z' }, // mucho antes, fuera
    ];
    const series = buildDailySeries(visits, now);
    const totalCount = series.reduce((acc, d) => acc + d.count, 0);
    expect(totalCount).toBe(0);
  });
});
