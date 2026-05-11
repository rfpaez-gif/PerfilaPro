import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/onboarding-prefill.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const validToken = 'a'.repeat(48);

function makeMockDb({ leadResult, orgResult } = {}) {
  // Cada llamada a db.from() devuelve un builder fresco. El handler:
  //   db.from('b2b_leads').select(...).eq('invite_token', t).maybeSingle()
  //   db.from('organizations').select(...).eq('id', x).is('deleted_at', null).maybeSingle()
  const leadChain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(leadResult || { data: null, error: null }),
  };
  const orgChain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(orgResult || { data: null, error: null }),
  };
  const from = vi.fn((table) => table === 'organizations' ? orgChain : leadChain);
  return { db: { from }, leadChain, orgChain };
}

function buildEvent({ method = 'GET', token, ip = '7.7.7.7' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-forwarded-for': ip },
    queryStringParameters: token != null ? { token } : {},
  };
}

describe('onboarding-prefill handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
  });

  it('405 si no es GET', async () => {
    const { db } = makeMockDb();
    const res = await makeHandler(db)(buildEvent({ method: 'POST', token: validToken }));
    expect(res.statusCode).toBe(405);
  });

  it('400 si el token no tiene formato hex 48', async () => {
    const { db } = makeMockDb();
    const res = await makeHandler(db)(buildEvent({ token: 'no-valido' }));
    expect(res.statusCode).toBe(400);
  });

  it('400 si no hay token en la query', async () => {
    const { db } = makeMockDb();
    const res = await makeHandler(db)(buildEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('404 si el lead no existe', async () => {
    const { db } = makeMockDb({ leadResult: { data: null, error: null } });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(404);
  });

  it('410 si el lead ya está redimido (idempotencia)', async () => {
    const { db } = makeMockDb({
      leadResult: {
        data: {
          id: 'l1', name: 'X', company: 'Y', email: 'x@y.com', sector: 'empresa',
          idioma: 'es', organization_id: null, redeemed_at: '2026-05-01T00:00:00Z',
        },
        error: null,
      },
    });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(410);
  });

  it('200 con lead sin org (org=null en respuesta)', async () => {
    const { db } = makeMockDb({
      leadResult: {
        data: {
          id: 'l1', name: 'Carlos', company: 'Allianz', email: 'c@a.com',
          sector: 'empresa', idioma: 'es', organization_id: null, redeemed_at: null,
        },
        error: null,
      },
    });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.lead.email).toBe('c@a.com');
    expect(json.lead.name).toBe('Carlos');
    expect(json.lead.company).toBe('Allianz');
    expect(json.org).toBeNull();
  });

  it('200 con branding de la org si está asociada', async () => {
    const { db } = makeMockDb({
      leadResult: {
        data: {
          id: 'l1', name: 'Marta', company: 'Despacho X', email: 'm@x.com',
          sector: 'despacho', idioma: 'ca', organization_id: 'org-uuid-1', redeemed_at: null,
        },
        error: null,
      },
      orgResult: {
        data: {
          id: 'org-uuid-1', slug: 'despacho-x', name: 'Despacho X',
          tagline: 'Buena gente', logo_url: 'https://x.supabase.co/storage/v1/x.png',
          color_primary: '#003781',
        },
        error: null,
      },
    });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.org).toBeTruthy();
    expect(json.org.slug).toBe('despacho-x');
    expect(json.org.color_primary).toBe('#003781');
    expect(json.lead.idioma).toBe('ca');
  });

  it('200 con org=null si organization_id apunta a una org soft-deleted', async () => {
    // Simula que la org existió pero está borrada — el query con is('deleted_at', null)
    // devuelve null. El lead sigue válido, simplemente sin branding.
    const { db } = makeMockDb({
      leadResult: {
        data: {
          id: 'l1', name: 'X', company: 'Y', email: 'x@y.com', sector: 'empresa',
          idioma: 'es', organization_id: 'org-deleted', redeemed_at: null,
        },
        error: null,
      },
      orgResult: { data: null, error: null },
    });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).org).toBeNull();
  });

  it('500 si la consulta de BD falla', async () => {
    const { db } = makeMockDb({
      leadResult: { data: null, error: { message: 'connection lost' } },
    });
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.statusCode).toBe(500);
  });

  it('Cache-Control: private, no-store en cualquier respuesta', async () => {
    const { db } = makeMockDb();
    const res = await makeHandler(db)(buildEvent({ token: validToken }));
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });
});
