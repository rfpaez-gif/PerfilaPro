import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/showcase.js';

const mockGetDb         = vi.fn(() => ({}));
const mockFetchShowcase = vi.fn();

const handler = makeHandler({ getDb: mockGetDb, fetchShowcase: mockFetchShowcase });

const SAMPLE = [
  {
    sector: 'oficios',
    sector_label: 'Oficios',
    sort_order: 5,
    profiles: [
      { slug: 'seed-juan-fontanero', nombre: 'Juan F.', tagline: 'Fontanero', foto_url: 'https://x/y.jpg',
        plan: 'base', profile_views: 42, profession_label: 'Fontanero', city_slug: 'madrid' },
    ],
  },
];

function buildEvent(query = {}) {
  return { queryStringParameters: query, headers: {} };
}

describe('showcase handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchShowcase.mockResolvedValue(SAMPLE);
  });

  it('responde 200 con JSON y la cabecera Cache-Control', async () => {
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/json');
    expect(res.headers['Cache-Control']).toContain('s-maxage=3600');
  });

  it('devuelve los sectores tal cual los entrega fetchShowcase', async () => {
    const res = await handler(buildEvent());
    const body = JSON.parse(res.body);
    expect(body.sectors).toEqual(SAMPLE);
  });

  it('usa el límite por defecto cuando no se pasa ?limit', async () => {
    await handler(buildEvent());
    const args = mockFetchShowcase.mock.calls[0][1];
    expect(args.limitPerSector).toBe(8);
  });

  it('respeta ?limit dentro del rango permitido', async () => {
    await handler(buildEvent({ limit: '4' }));
    expect(mockFetchShowcase.mock.calls[0][1].limitPerSector).toBe(4);
  });

  it('ignora ?limit fuera de rango y vuelve al default', async () => {
    await handler(buildEvent({ limit: '999' }));
    expect(mockFetchShowcase.mock.calls[0][1].limitPerSector).toBe(8);
  });

  it('devuelve 500 si fetchShowcase falla', async () => {
    mockFetchShowcase.mockRejectedValueOnce(new Error('boom'));
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('showcase_unavailable');
  });

  it('devuelve sectores vacíos cuando no hay seeds', async () => {
    mockFetchShowcase.mockResolvedValueOnce([]);
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).sectors).toEqual([]);
  });
});
