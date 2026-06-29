import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/subasta.js';

const ROW = {
  id: 'SUB-JA-2024-111-L1', id_subasta: 'SUB-JA-2024-111', slug: 'sub-ja-2024-111-l1',
  estado: 'abierta', tipo_subasta: 'judicial', tipo_bien: 'vivienda',
  municipio: 'Cambrils', localidad_raw: 'Cambrils', direccion: 'Carrer del Mar 12',
  valor_subasta_cents: 12000000, deposito_cents: 600000, fecha_fin: '2024-07-20T18:00:00.000Z',
  detalle_url: 'https://subastas.boe.es/detalleSubasta.php?idSub=SUB-JA-2024-111',
  fotos: [], ref_catastral: '1234567AB1234C0001XY',
};

function makeDb(row) {
  return {
    from(table) { this._table = table; return this; },
    select() { return this; },
    eq() { return this; },
    single() { return Promise.resolve({ data: row, error: row ? null : { message: 'not found' } }); },
    insert() { return Promise.resolve({ error: null }); },
  };
}

describe('inmo · página pública /s/:slug', () => {
  beforeEach(() => { process.env.INMO_VERTICAL_ACTIVE = '1'; });

  it('renderiza la ficha de una subasta existente', async () => {
    const db = makeDb(ROW);
    const handler = makeHandler(db);
    const res = await handler({ queryStringParameters: { slug: 'sub-ja-2024-111-l1' }, path: '/s/sub-ja-2024-111-l1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('Cambrils');
    expect(res.body).toContain('120.000,00 €');
    expect(res.body).toContain('Ver en el BOE');
    expect(res.body).toContain('noindex'); // no se indexa
  });

  it('devuelve 404 cuando no existe', async () => {
    const handler = makeHandler(makeDb(null));
    const res = await handler({ queryStringParameters: {}, path: '/s/inexistente' });
    expect(res.statusCode).toBe(404);
  });

  it('devuelve 404 si el vertical está apagado', async () => {
    process.env.INMO_VERTICAL_ACTIVE = '';
    const handler = makeHandler(makeDb(ROW));
    const res = await handler({ queryStringParameters: { slug: 'x' }, path: '/s/x' });
    expect(res.statusCode).toBe(404);
  });

  it('escapa contenido para evitar XSS', async () => {
    const db = makeDb({ ...ROW, direccion: '<script>alert(1)</script>' });
    const handler = makeHandler(db);
    const res = await handler({ queryStringParameters: { slug: ROW.slug }, path: `/s/${ROW.slug}` });
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});
