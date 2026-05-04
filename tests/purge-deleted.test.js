import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, purge, GRACE_DAYS } from '../netlify/functions/purge-deleted.js';

function buildDb({ candidates = [], selectError = null, deleteErrors = {} } = {}) {
  // SELECT chain: from('cards').select().not('deleted_at','is',null).lt('deleted_at', cutoff)
  const cardsSelect = {
    select: vi.fn().mockReturnThis(),
    not:    vi.fn().mockReturnThis(),
    lt:     vi.fn().mockResolvedValue({ data: candidates, error: selectError }),
  };

  const deletes = {
    visits:   vi.fn().mockImplementation((field, slug) => ({ error: deleteErrors.visits?.[slug]   || null })),
    facturas: vi.fn().mockImplementation((field, slug) => ({ error: deleteErrors.facturas?.[slug] || null })),
    cards:    vi.fn().mockImplementation((field, slug) => ({ error: deleteErrors.cards?.[slug]    || null })),
  };

  function deleteBuilder(table) {
    return { delete: vi.fn(() => ({ eq: deletes[table] })) };
  }

  return {
    from: vi.fn((table) => {
      if (table === 'cards') return { ...cardsSelect, ...deleteBuilder('cards') };
      if (table === 'visits')   return deleteBuilder('visits');
      if (table === 'facturas') return deleteBuilder('facturas');
      throw new Error(`unexpected table: ${table}`);
    }),
    _deletes: deletes,
    _cardsSelect: cardsSelect,
  };
}

describe('purge-deleted', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GRACE_DAYS por defecto es 30', () => {
    expect(GRACE_DAYS).toBe(30);
  });

  it('purge: 0 candidates → no llama a deletes', async () => {
    const db = buildDb({ candidates: [] });
    const result = await purge(db);
    expect(result).toEqual({ purged: 0, errors: 0 });
    expect(db._deletes.visits).not.toHaveBeenCalled();
  });

  it('purge: aplica filtro deleted_at NOT NULL y < cutoff', async () => {
    const db = buildDb({ candidates: [] });
    const now = new Date('2026-05-04T00:00:00Z');
    await purge(db, { now, graceDays: 30 });

    expect(db._cardsSelect.not).toHaveBeenCalledWith('deleted_at', 'is', null);
    const ltCall = db._cardsSelect.lt.mock.calls[0];
    expect(ltCall[0]).toBe('deleted_at');
    // cutoff = 2026-05-04 menos 30 días = 2026-04-04
    expect(ltCall[1]).toBe('2026-04-04T00:00:00.000Z');
  });

  it('purge: borra visits → facturas → card en orden por cada candidate', async () => {
    const db = buildDb({ candidates: [{ slug: 'foo' }, { slug: 'bar' }] });
    const result = await purge(db);
    expect(result).toEqual({ purged: 2, errors: 0 });

    expect(db._deletes.visits).toHaveBeenCalledTimes(2);
    expect(db._deletes.facturas).toHaveBeenCalledTimes(2);
    expect(db._deletes.cards).toHaveBeenCalledTimes(2);
    expect(db._deletes.visits).toHaveBeenCalledWith('slug', 'foo');
    expect(db._deletes.cards).toHaveBeenCalledWith('slug', 'bar');
  });

  it('purge: si falla visits, no borra facturas ni card de ese slug y suma error', async () => {
    const db = buildDb({
      candidates:    [{ slug: 'foo' }, { slug: 'bar' }],
      deleteErrors:  { visits: { foo: { message: 'fail' } } },
    });
    const result = await purge(db);
    expect(result.purged).toBe(1);  // solo bar
    expect(result.errors).toBe(1);  // foo falló
    // foo: solo visits llamado
    expect(db._deletes.facturas).not.toHaveBeenCalledWith('slug', 'foo');
    expect(db._deletes.cards).not.toHaveBeenCalledWith('slug', 'foo');
    // bar: cadena completa
    expect(db._deletes.cards).toHaveBeenCalledWith('slug', 'bar');
  });

  it('purge: si falla select, devuelve 1 error y 0 purged', async () => {
    const db = buildDb({ selectError: { message: 'db down' } });
    const result = await purge(db);
    expect(result).toEqual({ purged: 0, errors: 1 });
  });

  it('handler devuelve 200 con el resultado', async () => {
    const db = buildDb({ candidates: [{ slug: 'foo' }] });
    const handler = makeHandler(db);
    const res = await handler({});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ purged: 1, errors: 0 });
  });
});
