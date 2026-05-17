import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler as makeJsonHandler } from '../netlify/functions/org-stats.js';
import { makeHandler as makePageHandler } from '../netlify/functions/org-stats-page.js';
import {
  isValidStatsToken,
  authenticateOrgStats,
  computeOrgStats,
} from '../netlify/functions/lib/org-stats-utils.js';

const VALID_TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);

// Builder de mocks para Supabase. La función db.from(table) devuelve una
// chain distinta según la tabla porque organizations/cards/visits hacen
// queries con shapes distintas.
function makeMockDb({ org, cards, visits }) {
  const orgChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: org || null, error: null }),
  };
  const cardsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: cards || [], error: null }),
  };
  const visitsChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: visits || [], error: null }),
  };
  const from = vi.fn((table) => {
    if (table === 'organizations') return orgChain;
    if (table === 'cards')         return cardsChain;
    if (table === 'visits')        return visitsChain;
    throw new Error(`unexpected table: ${table}`);
  });
  return { db: { from }, orgChain, cardsChain, visitsChain };
}

function buildEvent({ method = 'GET', slug, token, path } = {}) {
  const qs = {};
  if (slug)  qs.slug  = slug;
  if (token) qs.token = token;
  return {
    httpMethod: method,
    headers: { 'x-forwarded-proto': 'https', host: 'perfilapro.es', 'x-forwarded-for': '1.2.3.4' },
    queryStringParameters: qs,
    path: path || '/api/org-stats',
  };
}

describe('isValidStatsToken', () => {
  it('acepta exactamente 64 chars hex', () => {
    expect(isValidStatsToken('0123456789abcdef'.repeat(4))).toBe(true);
  });
  it('rechaza longitud incorrecta', () => {
    expect(isValidStatsToken('a'.repeat(63))).toBe(false);
    expect(isValidStatsToken('a'.repeat(65))).toBe(false);
  });
  it('rechaza caracteres no-hex', () => {
    expect(isValidStatsToken('z'.repeat(64))).toBe(false);
  });
  it('rechaza tipos no-string', () => {
    expect(isValidStatsToken(null)).toBe(false);
    expect(isValidStatsToken(undefined)).toBe(false);
    expect(isValidStatsToken(123)).toBe(false);
  });
});

describe('authenticateOrgStats', () => {
  const futureExpiry = new Date(Date.now() + 86400000).toISOString();
  const pastExpiry   = new Date(Date.now() - 86400000).toISOString();

  it('devuelve la org cuando slug + token coinciden y no ha expirado', async () => {
    const { db } = makeMockDb({
      org: { id: 'o1', slug: 'acme', name: 'Acme', stats_token: VALID_TOKEN, stats_token_expires_at: futureExpiry },
    });
    const result = await authenticateOrgStats(db, 'acme', VALID_TOKEN);
    expect(result).toMatchObject({ id: 'o1', slug: 'acme' });
  });

  it('devuelve null si el token no coincide', async () => {
    const { db } = makeMockDb({
      org: { id: 'o1', slug: 'acme', stats_token: OTHER_TOKEN, stats_token_expires_at: futureExpiry },
    });
    expect(await authenticateOrgStats(db, 'acme', VALID_TOKEN)).toBeNull();
  });

  it('devuelve null si el token está expirado', async () => {
    const { db } = makeMockDb({
      org: { id: 'o1', slug: 'acme', stats_token: VALID_TOKEN, stats_token_expires_at: pastExpiry },
    });
    expect(await authenticateOrgStats(db, 'acme', VALID_TOKEN)).toBeNull();
  });

  it('devuelve null si la org no tiene stats_token', async () => {
    const { db } = makeMockDb({
      org: { id: 'o1', slug: 'acme', stats_token: null, stats_token_expires_at: null },
    });
    expect(await authenticateOrgStats(db, 'acme', VALID_TOKEN)).toBeNull();
  });

  it('devuelve null si la org no existe', async () => {
    const { db } = makeMockDb({ org: null });
    expect(await authenticateOrgStats(db, 'acme', VALID_TOKEN)).toBeNull();
  });

  it('devuelve null si el token tiene formato inválido (no llega a BD)', async () => {
    const { db } = makeMockDb({ org: { id: 'o1', stats_token: VALID_TOKEN } });
    expect(await authenticateOrgStats(db, 'acme', 'short')).toBeNull();
  });
});

describe('computeOrgStats', () => {
  it('orgId vacío → defaults con 30 días vacíos', async () => {
    const { db } = makeMockDb({});
    const stats = await computeOrgStats(db, null);
    expect(stats.members).toBe(0);
    expect(stats.totals).toEqual({ visits_7d: 0, visits_30d: 0, visits_all: 0 });
    expect(stats.by_day).toHaveLength(30);
    expect(stats.by_day.every(d => d.count === 0)).toBe(true);
  });

  it('agrega visits por miembro y por periodo', async () => {
    const now = Date.now();
    const HOUR = 3600000;
    const { db } = makeMockDb({
      cards: [
        { slug: 'maria', nombre: 'María', foto_url: null },
        { slug: 'jose',  nombre: 'José',  foto_url: null },
      ],
      visits: [
        { slug: 'maria', visited_at: new Date(now - 2 * HOUR).toISOString() },     // <7d
        { slug: 'maria', visited_at: new Date(now - 5 * 86400000).toISOString() }, // <7d
        { slug: 'maria', visited_at: new Date(now - 20 * 86400000).toISOString() },// <30d
        { slug: 'maria', visited_at: new Date(now - 90 * 86400000).toISOString() },// all-time only
        { slug: 'jose',  visited_at: new Date(now - 1 * HOUR).toISOString() },     // <7d
      ],
    });
    const stats = await computeOrgStats(db, 'o1');
    expect(stats.members).toBe(2);
    expect(stats.totals).toEqual({ visits_7d: 3, visits_30d: 4, visits_all: 5 });

    const maria = stats.by_member.find(m => m.slug === 'maria');
    const jose  = stats.by_member.find(m => m.slug === 'jose');
    expect(maria.visits_7d).toBe(2);
    expect(maria.visits_30d).toBe(3);
    expect(maria.visits_all).toBe(4);
    expect(jose.visits_7d).toBe(1);
    expect(jose.visits_all).toBe(1);

    // Ordenado por visits_30d desc
    expect(stats.by_member[0].slug).toBe('maria');
  });

  it('descarta visits con visited_at no parseable', async () => {
    const { db } = makeMockDb({
      cards: [{ slug: 'maria', nombre: 'María', foto_url: null }],
      visits: [
        { slug: 'maria', visited_at: 'no-es-una-fecha' },
        { slug: 'maria', visited_at: new Date().toISOString() },
      ],
    });
    const stats = await computeOrgStats(db, 'o1');
    expect(stats.totals.visits_all).toBe(1);
  });
});

describe('org-stats JSON handler', () => {
  let db;
  const futureExpiry = new Date(Date.now() + 86400000).toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function handler(mocks) {
    ({ db } = makeMockDb(mocks));
    return makeJsonHandler({ db });
  }

  it('rechaza POST con 405', async () => {
    const res = await handler({})({ ...buildEvent({ slug: 'acme', token: VALID_TOKEN }), httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('400 si faltan slug o token', async () => {
    const res = await handler({})(buildEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('400 si slug es inválido', async () => {
    const res = await handler({})(buildEvent({ slug: 'X-MAY', token: VALID_TOKEN }));
    expect(res.statusCode).toBe(400);
  });

  it('404 si la org no existe o el token no coincide', async () => {
    const res = await handler({ org: null })(buildEvent({ slug: 'acme', token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
  });

  it('200 con la shape esperada cuando todo es válido', async () => {
    const res = await handler({
      org:    { id: 'o1', slug: 'acme', name: 'Acme', tagline: 'Best', stats_token: VALID_TOKEN, stats_token_expires_at: futureExpiry, logo_url: null, color_primary: '#FF0000' },
      cards:  [{ slug: 'maria', nombre: 'María', foto_url: null }],
      visits: [{ slug: 'maria', visited_at: new Date().toISOString() }],
    })(buildEvent({ slug: 'acme', token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.org).toEqual({ slug: 'acme', name: 'Acme', tagline: 'Best', logo_url: null, color_primary: '#FF0000' });
    expect(json.members).toBe(1);
    expect(json.totals.visits_all).toBe(1);
    expect(json.by_member).toHaveLength(1);
    expect(json.by_day).toHaveLength(30);
  });

  it('Cache-Control private no-store en la respuesta', async () => {
    const res = await handler({
      org: { id: 'o1', slug: 'acme', name: 'Acme', stats_token: VALID_TOKEN, stats_token_expires_at: futureExpiry },
    })(buildEvent({ slug: 'acme', token: VALID_TOKEN }));
    expect(res.headers['Cache-Control']).toContain('no-store');
  });
});

describe('org-stats-page HTML handler', () => {
  const futureExpiry = new Date(Date.now() + 86400000).toISOString();

  beforeEach(() => vi.clearAllMocks());

  function handler(mocks) {
    const { db } = makeMockDb(mocks);
    return makePageHandler({ db });
  }

  it('devuelve HTML noindex con KPIs cuando la auth es válida', async () => {
    const res = await handler({
      org:    { id: 'o1', slug: 'acme', name: 'Acme', tagline: null, stats_token: VALID_TOKEN, stats_token_expires_at: futureExpiry, color_primary: '#0A1F44', logo_url: null },
      cards:  [{ slug: 'maria', nombre: 'María', foto_url: null }],
      visits: [{ slug: 'maria', visited_at: new Date().toISOString() }],
    })(buildEvent({ slug: 'acme', token: VALID_TOKEN, path: '/e/acme/stats' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Robots-Tag']).toContain('noindex');
    expect(res.body).toContain('María');
    expect(res.body).toContain('Estadísticas');
    expect(res.body).toContain('Acme');
  });

  it('404 cuando el token no es válido', async () => {
    const res = await handler({ org: null })(buildEvent({ slug: 'acme', token: VALID_TOKEN, path: '/e/acme/stats' }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('caducado o no es válido');
  });

  it('404 si falta el token', async () => {
    const res = await handler({})(buildEvent({ slug: 'acme', path: '/e/acme/stats' }));
    expect(res.statusCode).toBe(404);
  });

  it('respeta hex inválido cayendo al color por defecto', async () => {
    const res = await handler({
      org: { id: 'o1', slug: 'acme', name: 'Acme', stats_token: VALID_TOKEN, stats_token_expires_at: futureExpiry, color_primary: 'not-a-hex', logo_url: null },
    })(buildEvent({ slug: 'acme', token: VALID_TOKEN, path: '/e/acme/stats' }));
    expect(res.statusCode).toBe(200);
    // El default es #0A1F44 (tinta)
    expect(res.body).toContain('#0A1F44');
  });
});
