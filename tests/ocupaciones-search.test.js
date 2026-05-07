'use strict';

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/ocupaciones-search.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const mockIlike = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

function makeDb(startsResult, containsResult) {
  let callIdx = 0;
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(function () {
        const result = callIdx === 0 ? startsResult : containsResult;
        callIdx++;
        return Promise.resolve({ data: result, error: null });
      }),
    })),
  };
}

function buildEvent({ method = 'GET', q = '', limit, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: { q, limit },
    headers: { 'x-forwarded-for': ip },
  };
}

describe('ocupaciones-search handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
  });

  it('devuelve 405 para POST', async () => {
    const handler = makeHandler({ getDb: () => makeDb([], []) });
    const res = await handler(buildEvent({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve [] sin tocar BD si q < 2 caracteres', async () => {
    const dbFactory = vi.fn(() => makeDb([], []));
    const handler = makeHandler({ getDb: dbFactory });
    const res = await handler(buildEvent({ q: 'a' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).results).toEqual([]);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  it('devuelve [] cuando q tiene solo espacios', async () => {
    const dbFactory = vi.fn(() => makeDb([], []));
    const handler = makeHandler({ getDb: dbFactory });
    const res = await handler(buildEvent({ q: '   ' }));
    expect(JSON.parse(res.body).results).toEqual([]);
    expect(dbFactory).not.toHaveBeenCalled();
  });

  it('busca ocupaciones que empiezan por el query primero', async () => {
    const starts = [
      { code: '74301014', name: 'Mecánicos de Motor de Aviación', sector_slug: 'oficios' },
      { code: '74321022', name: 'Mecánicos en General', sector_slug: 'oficios' },
    ];
    const contains = [
      { code: '83321020', name: 'Operadores de Máquina', sector_slug: 'transporte' },
    ];
    const handler = makeHandler({ getDb: () => makeDb(starts, contains) });
    const res = await handler(buildEvent({ q: 'meca' }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.results).toHaveLength(3);
    expect(json.results[0].code).toBe('74301014');
    expect(json.results[1].code).toBe('74321022');
  });

  it('normaliza el query (quita acentos y mayúsculas)', async () => {
    const fake = [{ code: '74301014', name: 'Mecánicos', sector_slug: 'oficios' }];
    const handler = makeHandler({ getDb: () => makeDb(fake, []) });
    const res = await handler(buildEvent({ q: 'MEC' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).results).toHaveLength(1);
  });

  it('respeta el parámetro limit hasta MAX_LIMIT=25', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      code: `7430${String(i).padStart(4, '0')}`,
      name: `Mecánico ${i}`,
      sector_slug: 'oficios',
    }));
    const handler = makeHandler({ getDb: () => makeDb(many, []) });
    const res1 = await handler(buildEvent({ q: 'mec', limit: '5' }));
    expect(JSON.parse(res1.body).results).toHaveLength(5);

    _resetRateLimit();
    const res2 = await handler(buildEvent({ q: 'mec', limit: '999' }));
    expect(JSON.parse(res2.body).results).toHaveLength(25);
  });

  it('deduplica entre starts y contains', async () => {
    const dup = { code: 'X', name: 'Dup', sector_slug: 'oficios' };
    const handler = makeHandler({ getDb: () => makeDb([dup], [dup]) });
    const res = await handler(buildEvent({ q: 'dup' }));
    expect(JSON.parse(res.body).results).toHaveLength(1);
  });

  it('devuelve 429 al superar rate limit (60 / 10 min)', async () => {
    const handler = makeHandler({ getDb: () => makeDb([], []) });
    const ip = '9.9.9.9';
    for (let i = 0; i < 60; i++) {
      const res = await handler(buildEvent({ q: 'tes', ip }));
      expect(res.statusCode).toBe(200);
    }
    const blocked = await handler(buildEvent({ q: 'tes', ip }));
    expect(blocked.statusCode).toBe(429);
  });

  it('expone Cache-Control público para CDN', async () => {
    const handler = makeHandler({ getDb: () => makeDb([], []) });
    const res = await handler(buildEvent({ q: 'fonta' }));
    expect(res.headers['Cache-Control']).toContain('s-maxage');
  });
});
