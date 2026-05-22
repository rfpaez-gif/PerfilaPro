import { vi, describe, it, expect, beforeEach } from 'vitest';
import { offboardCard, restoreCard, COURTESY_DAYS } from '../netlify/functions/lib/card-offboard.js';

/**
 * Helper para mockear el chain de Supabase. Cada llamada `.from(table)`
 * devuelve un objeto con los métodos que el código real encadena
 * (select/eq/is/maybeSingle/update). El test inyecta los resultados.
 */
function makeDb({ cardLookup, orgLookup, updateResult = { error: null } } = {}) {
  const cardLookupChain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(cardLookup || { data: null, error: null }),
  };
  const orgLookupChain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(orgLookup || { data: null, error: null }),
  };
  const updateChain = {
    eq: vi.fn().mockResolvedValue(updateResult),
  };
  // El UPDATE mock vive a nivel del módulo para poder inspeccionarlo
  // luego con .mock.calls[0][0]. Si lo recreáramos dentro del closure
  // de from(table), perderíamos visibilidad de las invocaciones.
  const cardUpdateMock = vi.fn(() => updateChain);
  const cardsTable = {
    select: vi.fn(() => cardLookupChain),
    update: cardUpdateMock,
  };
  const orgsTable = {
    select: vi.fn(() => orgLookupChain),
  };
  return {
    db: {
      from: vi.fn((table) => {
        if (table === 'cards') return cardsTable;
        if (table === 'organizations') return orgsTable;
        return {};
      }),
    },
    cardUpdateMock,
    updateChain,
    cardLookupChain,
    orgLookupChain,
  };
}

describe('offboardCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marca previous_organization_id + offboarded_at + offboarded_by, nullifica org y aplica cortesía 90d', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'maria',
          nombre: 'María López',
          email: 'maria@test.com',
          idioma: 'es',
          organization_id: 'uuid-aossa',
          expires_at: null,
          edit_token: 'existing-token-1234',
          edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        },
      },
      orgLookup: { data: { name: 'AOSSA' } },
    });

    const result = await offboardCard(db, { cardSlug: 'maria', actor: 'client' });
    expect(result.ok).toBe(true);
    expect(result.orgName).toBe('AOSSA');
    expect(result.courtesyDays).toBe(COURTESY_DAYS);
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    // El UPDATE debe llevar TODOS los campos del offboard.
    expect(db.from('cards').update).toHaveBeenCalledOnce();
    const updateCall = cardUpdateMock.mock.calls[0][0];
    expect(updateCall.previous_organization_id).toBe('uuid-aossa');
    expect(updateCall.offboarded_at).toBeTruthy();
    expect(updateCall.offboarded_by).toBe('client');
    expect(updateCall.organization_id).toBeNull();
    expect(updateCall.plan).toBe('base');
    expect(updateCall.reminder_30_sent).toBe(false);
    expect(updateCall.reminder_15_sent).toBe(false);
    expect(updateCall.reminder_7_sent).toBe(false);
    // No regenera el edit_token porque el existente sigue vigente.
    expect(updateCall.edit_token).toBeUndefined();
  });

  it('actor=founder se persiste en offboarded_by', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'paco', nombre: 'Paco', email: null, idioma: 'es',
          organization_id: 'uuid-iris', expires_at: null,
          edit_token: 'tok', edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        },
      },
      orgLookup: { data: { name: 'Iris' } },
    });
    await offboardCard(db, { cardSlug: 'paco', actor: 'founder' });
    const updateCall = cardUpdateMock.mock.calls[0][0];
    expect(updateCall.offboarded_by).toBe('founder');
  });

  it('regenera edit_token si está caducado', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'olga', nombre: 'Olga', email: 'o@x.com', idioma: 'es',
          organization_id: 'uuid-org', expires_at: null,
          edit_token: 'old-expired',
          edit_token_expires_at: new Date(Date.now() - 86400000).toISOString(),
        },
      },
      orgLookup: { data: { name: 'Org' } },
    });
    const result = await offboardCard(db, { cardSlug: 'olga', actor: 'client' });
    expect(result.editToken).not.toBe('old-expired');
    expect(result.editToken).toMatch(/^[0-9a-f]{64}$/);
    const updateCall = cardUpdateMock.mock.calls[0][0];
    expect(updateCall.edit_token).toBe(result.editToken);
    expect(updateCall.edit_token_expires_at).toBeTruthy();
  });

  it('preserva expires_at si era posterior a NOW+90d (caso edge: ya pagó Pro)', async () => {
    const future = new Date(Date.now() + 200 * 86400000).toISOString();
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'lola', nombre: 'Lola', email: null, idioma: 'es',
          organization_id: 'uuid-org', expires_at: future,
          edit_token: 'tok', edit_token_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
        },
      },
      orgLookup: { data: { name: 'Org' } },
    });
    const result = await offboardCard(db, { cardSlug: 'lola', actor: 'client' });
    expect(result.expiresAt).toBe(future);
  });

  it('rechaza actor inválido con 400', async () => {
    const { db } = makeDb();
    const result = await offboardCard(db, { cardSlug: 'x', actor: 'admin' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('devuelve 404 si la card no existe', async () => {
    const { db } = makeDb({ cardLookup: { data: null } });
    const result = await offboardCard(db, { cardSlug: 'fantasma', actor: 'client' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('devuelve 400 si la card no está asignada a ninguna org', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'libre', nombre: 'Libre', email: null, idioma: 'es',
          organization_id: null, expires_at: null,
        },
      },
    });
    const result = await offboardCard(db, { cardSlug: 'libre', actor: 'client' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/no está asignada/i);
  });
});

describe('restoreCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('devuelve la card a la org original, limpia el trail y resetea reminders', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'maria', nombre: 'María', email: 'maria@x.com', idioma: 'es',
          organization_id: null,
          previous_organization_id: 'uuid-aossa',
          offboarded_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
      },
      orgLookup: { data: { id: 'uuid-aossa', name: 'AOSSA' } },
    });
    const result = await restoreCard(db, { cardSlug: 'maria' });
    expect(result.ok).toBe(true);
    expect(result.orgName).toBe('AOSSA');

    const updateCall = cardUpdateMock.mock.calls[0][0];
    expect(updateCall.organization_id).toBe('uuid-aossa');
    expect(updateCall.plan).toBe('b2b');
    expect(updateCall.expires_at).toBeNull();
    expect(updateCall.previous_organization_id).toBeNull();
    expect(updateCall.offboarded_at).toBeNull();
    expect(updateCall.offboarded_by).toBeNull();
    expect(updateCall.reminder_30_sent).toBe(false);
  });

  it('devuelve 400 si la card no está offboarded', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: { slug: 'x', organization_id: 'uuid-org', previous_organization_id: null, offboarded_at: null },
      },
    });
    const result = await restoreCard(db, { cardSlug: 'x' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('devuelve 409 si la card ya pertenece a otra org tras la baja', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'movida',
          organization_id: 'uuid-otra-org', // ya re-asignada
          previous_organization_id: 'uuid-aossa',
          offboarded_at: new Date(Date.now() - 86400000).toISOString(),
        },
      },
    });
    const result = await restoreCard(db, { cardSlug: 'movida' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/ya pertenece/i);
  });

  it('devuelve 404 si la org original fue soft-deleted', async () => {
    const { db, cardUpdateMock } = makeDb({
      cardLookup: {
        data: {
          slug: 'x', organization_id: null,
          previous_organization_id: 'uuid-borrada',
          offboarded_at: new Date(Date.now() - 86400000).toISOString(),
        },
      },
      orgLookup: { data: null }, // soft-deleted o no existe
    });
    const result = await restoreCard(db, { cardSlug: 'x' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toMatch(/org original/i);
  });

  it('devuelve 404 si la card no existe', async () => {
    const { db } = makeDb({ cardLookup: { data: null } });
    const result = await restoreCard(db, { cardSlug: 'fantasma' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});
