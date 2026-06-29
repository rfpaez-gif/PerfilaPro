import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/inmo-scrape-now.js';

const LISTADO = `<a href="/detalleSubasta.php?idSub=SUB-JA-2024-111">x</a>`;
const DETALLE = `
  <div><span class="lbl">Estado</span><span class="val">En plazo</span></div>
  <div><span class="lbl">Valor de subasta</span><span class="val">120.000,00 €</span></div>
  <div><span class="lbl">Tipo de bien</span><span class="val">Vivienda</span></div>
  <div><span class="lbl">Localidad</span><span class="val">Cambrils</span></div>`;

const fakeFetch = () => vi.fn(async (url) => {
  let body = '';
  if (url.includes('idSub=SUB-JA-2024-111')) body = DETALLE;
  else if (url.includes('page=')) body = '<html>vacío</html>';
  else body = LISTADO;
  return { ok: true, status: 200, text: async () => body };
});

function makeDb() {
  const calls = { insert: [] };
  const api = {
    _mode: null,
    from() { this._mode = null; return this; },
    select() { return this; },
    update(p) { this._mode = 'update'; this._patch = p; return this; },
    insert(rows) { calls.insert.push(rows); return Promise.resolve({ error: null }); },
    eq() { return Promise.resolve({ error: null }); },
    in() { return this._mode === 'update' ? Promise.resolve({ error: null }) : Promise.resolve({ data: [], error: null }); },
    _calls: calls,
  };
  return api;
}

describe('inmo · disparador manual /api/inmo-scrape-now', () => {
  beforeEach(() => {
    process.env.INMO_VERTICAL_ACTIVE = '1';
    process.env.ADMIN_PASSWORD = 'secreto';
    process.env.SITE_URL = 'https://perfilapro.es';
    delete process.env.INMO_ALERT_INBOX;
  });

  it('rechaza sin key correcta', async () => {
    const handler = makeHandler(makeDb(), { emails: { send: vi.fn() } }, { fetchImpl: fakeFetch(), delayMs: 0 });
    const res = await handler({ queryStringParameters: { key: 'mala' } });
    expect(res.statusCode).toBe(401);
  });

  it('modo dry rastrea sin escribir en BD', async () => {
    const db = makeDb();
    const handler = makeHandler(db, { emails: { send: vi.fn() } }, { fetchImpl: fakeFetch(), delayMs: 0 });
    const res = await handler({ queryStringParameters: { key: 'secreto', dry: '1' } });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.dry).toBe(true);
    expect(body.encontradas).toBe(1);
    expect(body.subastas[0].municipio).toBe('Cambrils');
    expect(body.subastas[0].ficha).toBe('https://perfilapro.es/s/sub-ja-2024-111');
    expect(db._calls.insert).toHaveLength(0); // dry = no escribe
  });

  it('modo real persiste lo encontrado', async () => {
    const db = makeDb();
    const handler = makeHandler(db, { emails: { send: vi.fn() } }, { fetchImpl: fakeFetch(), delayMs: 0 });
    const res = await handler({ queryStringParameters: { key: 'secreto' } });
    const body = JSON.parse(res.body);
    expect(body.dry).toBe(false);
    expect(body.nuevas).toBe(1);
    expect(db._calls.insert).toHaveLength(1);
  });

  it('410 si el vertical está apagado', async () => {
    process.env.INMO_VERTICAL_ACTIVE = '';
    const handler = makeHandler(makeDb(), { emails: { send: vi.fn() } }, { fetchImpl: fakeFetch(), delayMs: 0 });
    const res = await handler({ queryStringParameters: { key: 'secreto' } });
    expect(res.statusCode).toBe(410);
  });
});
