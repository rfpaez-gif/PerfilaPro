import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidHex,
  isSafeLogoUrl,
  isValidOrgSlug,
  isValidTagline,
  getOrgBySlug,
  listCardsByOrg,
} from '../netlify/functions/lib/org-utils.js';

describe('isValidHex', () => {
  it('acepta #RRGGBB en minúsculas y mayúsculas', () => {
    expect(isValidHex('#aabbcc')).toBe(true);
    expect(isValidHex('#AABBCC')).toBe(true);
    expect(isValidHex('#0A1F44')).toBe(true);
  });
  it('rechaza formatos cortos #RGB y sin almohadilla', () => {
    expect(isValidHex('#abc')).toBe(false);
    expect(isValidHex('aabbcc')).toBe(false);
  });
  it('rechaza chars no-hex y valores no-string', () => {
    expect(isValidHex('#zzzzzz')).toBe(false);
    expect(isValidHex(null)).toBe(false);
    expect(isValidHex(undefined)).toBe(false);
    expect(isValidHex(123456)).toBe(false);
  });
});

describe('isSafeLogoUrl', () => {
  it('acepta URLs https de Supabase storage', () => {
    expect(isSafeLogoUrl('https://abc.supabase.co/storage/v1/object/public/logos/iris.png')).toBe(true);
    expect(isSafeLogoUrl('https://abc.supabase.in/storage/v1/object/public/logos/iris.png')).toBe(true);
  });
  it('rechaza hosts no whitelisted', () => {
    expect(isSafeLogoUrl('https://evil.com/logo.png')).toBe(false);
    expect(isSafeLogoUrl('https://cdn.cloudflare.com/logo.png')).toBe(false);
  });
  it('rechaza http (no https)', () => {
    expect(isSafeLogoUrl('http://abc.supabase.co/storage/v1/object/public/logos/iris.png')).toBe(false);
  });
  it('rechaza valores vacíos o no-string', () => {
    expect(isSafeLogoUrl('')).toBe(false);
    expect(isSafeLogoUrl(null)).toBe(false);
    expect(isSafeLogoUrl(undefined)).toBe(false);
  });
});

describe('isValidOrgSlug', () => {
  it('acepta slugs [a-z0-9-] de 2-40 chars', () => {
    expect(isValidOrgSlug('iris')).toBe(true);
    expect(isValidOrgSlug('iris-comercializadora')).toBe(true);
    expect(isValidOrgSlug('a1')).toBe(true);
  });
  it('rechaza mayúsculas, espacios y chars especiales', () => {
    expect(isValidOrgSlug('Iris')).toBe(false);
    expect(isValidOrgSlug('iris comer')).toBe(false);
    expect(isValidOrgSlug('iris@')).toBe(false);
  });
  it('rechaza guiones al inicio o al final', () => {
    expect(isValidOrgSlug('-iris')).toBe(false);
    expect(isValidOrgSlug('iris-')).toBe(false);
  });
  it('rechaza menos de 2 chars y más de 40 chars', () => {
    expect(isValidOrgSlug('a')).toBe(false);
    expect(isValidOrgSlug('a'.repeat(41))).toBe(false);
    expect(isValidOrgSlug('a'.repeat(40))).toBe(true);
  });
});

describe('isValidTagline', () => {
  it('acepta strings hasta 140 chars (incluida string vacía)', () => {
    expect(isValidTagline('')).toBe(true);
    expect(isValidTagline('Equipo de Iris')).toBe(true);
    expect(isValidTagline('x'.repeat(140))).toBe(true);
  });
  it('rechaza más de 140 chars y no-strings', () => {
    expect(isValidTagline('x'.repeat(141))).toBe(false);
    expect(isValidTagline(null)).toBe(false);
    expect(isValidTagline(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
// Acceso a BD: mocks de chain Supabase
// ─────────────────────────────────────────────────────

function makeQueryMock(result) {
  const mock = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    // para listCardsByOrg que termina en .order y no en .maybeSingle/.single
    then: undefined,
  };
  // Hacer el chain "thenable" cuando se await directamente (caso listCardsByOrg)
  return mock;
}

function makeDb(tableResult) {
  return {
    from: vi.fn((table) => {
      const q = tableResult[table] || {};
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(q.maybeSingle ?? { data: null, error: null }),
      };
      // .order().order() devuelve la promesa final para listCardsByOrg
      const lastOrder = {
        ...chain,
        then: (resolve) => Promise.resolve(q.listResult ?? { data: [], error: null }).then(resolve),
      };
      chain.order = vi.fn(() => lastOrder);
      return chain;
    }),
  };
}

describe('getOrgBySlug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve null si el slug no es válido sin tocar la BD', async () => {
    const db = makeDb({});
    const res = await getOrgBySlug(db, 'IRIS-MAYUS');
    expect(res).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('devuelve la org cuando existe y no está borrada', async () => {
    const orgData = { id: 'uuid-1', slug: 'iris', name: 'Iris', logo_url: null, color_primary: null, tagline: null, deleted_at: null };
    const db = makeDb({ organizations: { maybeSingle: { data: orgData, error: null } } });
    const res = await getOrgBySlug(db, 'iris');
    expect(res).toEqual(orgData);
  });

  it('devuelve null si la query devuelve error', async () => {
    const db = makeDb({ organizations: { maybeSingle: { data: null, error: { message: 'oops' } } } });
    const res = await getOrgBySlug(db, 'iris');
    expect(res).toBeNull();
  });
});

describe('listCardsByOrg', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve {cards:[]} si no se pasa orgId', async () => {
    const db = makeDb({});
    const res = await listCardsByOrg(db, null);
    expect(res).toEqual({ cards: [], error: null });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('devuelve las cards activas de la org', async () => {
    const cards = [
      { slug: 'ana', nombre: 'Ana', plan: 'pro' },
      { slug: 'beto', nombre: 'Beto', plan: 'base' },
    ];
    const db = makeDb({ cards: { listResult: { data: cards, error: null } } });
    const res = await listCardsByOrg(db, 'uuid-1');
    expect(res.cards).toEqual(cards);
    expect(res.error).toBeNull();
  });
});
