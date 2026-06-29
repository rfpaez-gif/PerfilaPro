import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/inmo-scrape-subastas.js';

const LISTADO = `
  <a href="/detalleSubasta.php?idSub=SUB-JA-2024-111">Cambrils</a>
  <a href="/detalleSubasta.php?idSub=SUB-JA-2024-222">Reus</a>`;

const detalle = (localidad, valor) => `
  <div><span class="lbl">Estado</span><span class="val">En plazo</span></div>
  <div><span class="lbl">Valor de subasta</span><span class="val">${valor}</span></div>
  <div><span class="lbl">Fecha de conclusión</span><span class="val">20-07-2024 18:00:00</span></div>
  <div><span class="lbl">Tipo de bien</span><span class="val">Vivienda</span></div>
  <div><span class="lbl">Localidad</span><span class="val">${localidad}</span></div>
  <div><span class="lbl">Provincia</span><span class="val">Tarragona</span></div>`;

// fetch simulado del portal: listado + dos detalles (uno costero, uno interior).
function fakeFetch() {
  return vi.fn(async (url) => {
    let body = '';
    if (url.includes('idSub=SUB-JA-2024-111')) body = detalle('Cambrils', '120.000,00 €');
    else if (url.includes('idSub=SUB-JA-2024-222')) body = detalle('Reus', '90.000,00 €');
    else if (url.includes('page=')) body = '<html>sin resultados</html>';
    else body = LISTADO;
    return { ok: true, status: 200, text: async () => body };
  });
}

// Mock Supabase mínimo: registra insert/update y devuelve sin filas existentes.
function makeDb() {
  const calls = { insert: [], updateIn: [] };
  const api = {
    _mode: null, _patch: null,
    from() { this._mode = null; return this; },
    select() { return this; },
    update(patch) { this._mode = 'update'; this._patch = patch; return this; },
    insert(rows) { calls.insert.push(rows); return Promise.resolve({ error: null }); },
    eq() { this._mode = null; return Promise.resolve({ error: null }); },
    in(_col, ids) {
      if (this._mode === 'update') { calls.updateIn.push({ patch: this._patch, ids }); this._mode = null; return Promise.resolve({ error: null }); }
      return Promise.resolve({ data: [], error: null }); // select...in: sin existentes
    },
    _calls: calls,
  };
  return api;
}

describe('inmo · scrape end-to-end (mocks)', () => {
  beforeEach(() => {
    process.env.INMO_VERTICAL_ACTIVE = '1';
    process.env.INMO_ALERT_INBOX = 'rafa@example.com';
    process.env.SITE_URL = 'https://perfilapro.es';
  });

  it('queda solo con lo costero, lo persiste y avisa por email', async () => {
    const db = makeDb();
    const emailClient = { emails: { send: vi.fn().mockResolvedValue({ id: 'e1' }) } };
    const handler = makeHandler(db, emailClient, { fetchImpl: fakeFetch(), delayMs: 0 });

    const res = await handler();
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.scraped).toBe(1);        // Reus (interior) descartada
    expect(body.nuevas).toBe(1);
    expect(body.emailed).toBe(true);

    // insertó exactamente la subasta de Cambrils
    expect(db._calls.insert).toHaveLength(1);
    expect(db._calls.insert[0]).toHaveLength(1);
    expect(db._calls.insert[0][0].municipio).toBe('Cambrils');
    expect(db._calls.insert[0][0].id).toBe('SUB-JA-2024-111');

    // envió aviso y marcó notified_new
    expect(emailClient.emails.send).toHaveBeenCalledTimes(1);
    expect(emailClient.emails.send.mock.calls[0][0].subject).toMatch(/nueva/i);
    expect(db._calls.updateIn.some((u) => u.patch.notified_new === true)).toBe(true);
  });

  it('no hace nada si el vertical está apagado', async () => {
    process.env.INMO_VERTICAL_ACTIVE = '0';
    const db = makeDb();
    const emailClient = { emails: { send: vi.fn() } };
    const handler = makeHandler(db, emailClient, { fetchImpl: fakeFetch(), delayMs: 0 });

    const res = await handler();
    expect(JSON.parse(res.body).skipped).toBe(true);
    expect(db._calls.insert).toHaveLength(0);
    expect(emailClient.emails.send).not.toHaveBeenCalled();
  });
});
