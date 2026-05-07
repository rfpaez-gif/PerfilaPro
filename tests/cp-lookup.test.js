import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/cp-lookup.js';

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockDb = { from: mockFrom };

const buildEvent = (cp, method = 'GET') => ({
  httpMethod: method,
  queryStringParameters: cp != null ? { cp } : {},
  headers: { 'x-forwarded-for': '198.51.100.42' },
});

describe('cp-lookup handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null });
    handler = makeHandler({ getDb: () => mockDb });
  });

  it('rechaza métodos distintos de GET', async () => {
    const res = await handler(buildEvent('28001', 'POST'));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve {ok:false, reason:"invalid"} si el CP está vacío', async () => {
    const res = await handler(buildEvent(''));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: false, reason: 'invalid' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devuelve {ok:false, reason:"invalid"} para CP no numérico', async () => {
    const res = await handler(buildEvent('abc12'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reason).toBe('invalid');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devuelve {ok:false, reason:"invalid"} para CP fuera de rango (53xxx)', async () => {
    const res = await handler(buildEvent('53000'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reason).toBe('invalid');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('devuelve {ok:false, reason:"not_found"} si el CP es válido pero no está en la BD', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const res = await handler(buildEvent('28999'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not_found');
    expect(body.cp).toBe('28999');
    expect(mockFrom).toHaveBeenCalledWith('postal_codes');
  });

  it('devuelve {ok:true, ...} con municipio y province_slug si el lookup acierta', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { cp: '28820', municipality_name: 'Coslada', province_slug: 'madrid' },
    });
    const res = await handler(buildEvent('28820'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      ok: true,
      cp: '28820',
      municipality_name: 'Coslada',
      province_slug: 'madrid',
    });
  });

  it('normaliza CP de 4 dígitos (pad-left) antes del lookup', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { cp: '01193', municipality_name: 'Alegría-Dulantzi', province_slug: 'vitoria' },
    });
    const res = await handler(buildEvent('1193'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    // El handler debe haber normalizado a 5 dígitos antes de consultar
    expect(mockEq).toHaveBeenCalledWith('cp', '01193');
  });

  it('devuelve cabeceras de cache largo cuando hay match', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { cp: '28820', municipality_name: 'Coslada', province_slug: 'madrid' },
    });
    const res = await handler(buildEvent('28820'));
    expect(res.headers['Cache-Control']).toMatch(/max-age=86400/);
  });

  it('cabeceras de cache corto cuando reason=invalid (CP vacío)', async () => {
    const res = await handler(buildEvent(''));
    expect(res.headers['Cache-Control']).toMatch(/max-age=60/);
  });
});
