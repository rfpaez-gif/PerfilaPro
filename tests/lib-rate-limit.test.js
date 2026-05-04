import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
const {
  checkRateLimit,
  rateLimitResponse,
  getIp,
  _resetRateLimit,
} = require('../netlify/functions/lib/rate-limit.js');

function ev(ip = '1.2.3.4') {
  return { headers: { 'x-forwarded-for': ip } };
}

describe('getIp', () => {
  it('extrae primera IP de x-forwarded-for', () => {
    expect(getIp({ headers: { 'x-forwarded-for': '5.6.7.8, 9.10.11.12' } })).toBe('5.6.7.8');
  });

  it('soporta header con mayúsculas', () => {
    expect(getIp({ headers: { 'X-Forwarded-For': '5.6.7.8' } })).toBe('5.6.7.8');
  });

  it('devuelve "unknown" si no hay header', () => {
    expect(getIp({ headers: {} })).toBe('unknown');
    expect(getIp({})).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => { _resetRateLimit(); });

  it('exige bucket, limit y windowMs', () => {
    expect(() => checkRateLimit(ev(), { limit: 5, windowMs: 1000 })).toThrow();
    expect(() => checkRateLimit(ev(), { bucket: 'x', windowMs: 1000 })).toThrow();
    expect(() => checkRateLimit(ev(), { bucket: 'x', limit: 5 })).toThrow();
  });

  it('permite hasta `limit` requests y bloquea la siguiente', () => {
    const opts = { bucket: 'test', limit: 3, windowMs: 60_000 };
    expect(checkRateLimit(ev(), opts).limited).toBe(false);
    expect(checkRateLimit(ev(), opts).limited).toBe(false);
    expect(checkRateLimit(ev(), opts).limited).toBe(false);
    const blocked = checkRateLimit(ev(), opts);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('aísla buckets distintos', () => {
    const a = { bucket: 'a', limit: 1, windowMs: 60_000 };
    const b = { bucket: 'b', limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(ev(), a).limited).toBe(false);
    expect(checkRateLimit(ev(), b).limited).toBe(false);
    expect(checkRateLimit(ev(), a).limited).toBe(true);
    expect(checkRateLimit(ev(), b).limited).toBe(true);
  });

  it('aísla IPs distintas en el mismo bucket', () => {
    const opts = { bucket: 'test', limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(ev('1.1.1.1'), opts).limited).toBe(false);
    expect(checkRateLimit(ev('2.2.2.2'), opts).limited).toBe(false);
    expect(checkRateLimit(ev('1.1.1.1'), opts).limited).toBe(true);
  });

  it('expira la ventana y resetea el contador', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const opts = { bucket: 'test', limit: 2, windowMs: 60_000 };

    expect(checkRateLimit(ev(), opts).limited).toBe(false);
    expect(checkRateLimit(ev(), opts).limited).toBe(false);
    expect(checkRateLimit(ev(), opts).limited).toBe(true);

    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(checkRateLimit(ev(), opts).limited).toBe(false);

    vi.useRealTimers();
  });

  it('soporta key explícita en lugar de IP', () => {
    const opts = { bucket: 'test', limit: 1, windowMs: 60_000, key: 'custom-key' };
    expect(checkRateLimit(ev('1.1.1.1'), opts).limited).toBe(false);
    expect(checkRateLimit(ev('2.2.2.2'), opts).limited).toBe(true);
  });
});

describe('rateLimitResponse', () => {
  it('devuelve 429 con Retry-After y mensaje JSON', () => {
    const r = rateLimitResponse(42);
    expect(r.statusCode).toBe(429);
    expect(r.headers['Retry-After']).toBe('42');
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(r.body).error).toMatch(/demasiadas/i);
  });
});
