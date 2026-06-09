import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildPlayerCardPVC, buildPlayerCardsBookletPDF } from '../netlify/functions/printable-card-utils.js';
import { makeHandler as makeNfc } from '../netlify/functions/nfc-register.js';
import { makeHandler as makeExport } from '../netlify/functions/print-order-export.js';

const resolve = (v) => () => Promise.resolve(v);
const PDF_MAGIC = '%PDF';

// Nº de páginas del PDF = nº de /MediaBox (uno por página en PDFKit).
const countPages = (buf) => (buf.toString('latin1').match(/\/MediaBox/g) || []).length;
// PNG 1×1 transparente válido, para ejercitar el render de imagen (patrocinador/foto).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// ───────────────────────── buildPlayerCardPVC ─────────────────────────

describe('buildPlayerCardPVC', () => {
  it('genera un PDF válido (sin logo/foto remotos)', async () => {
    const buf = await buildPlayerCardPVC({
      card: { slug: 'p-1', nombre: 'Leo Pérez', foto_url: null },
      club: { name: 'CD Test', color_primary: '#00C277', logo_url: null },
      season: { dorsal: 10, category_name: 'Infantil', team_name: 'Infantil A' },
      logoBuffer: null, photoBuffer: null,
      siteUrl: 'https://perfilapro.es',
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
  });
  it('lanza sin card.slug', async () => {
    await expect(buildPlayerCardPVC({ card: {}, logoBuffer: null, photoBuffer: null })).rejects.toThrow();
  });
  it('genera un carnet de DOS caras (2 páginas) con temporada', async () => {
    const buf = await buildPlayerCardPVC({
      card: { slug: 'p-1', nombre: 'Leo Pérez', foto_url: null },
      club: { name: 'CD Test', color_primary: '#00C277', logo_url: null },
      season: { dorsal: 10, category_name: 'Infantil', team_name: 'Primera Infantil A', season: '2025-26' },
      logoBuffer: null, photoBuffer: null, sponsorBuffer: null,
      siteUrl: 'https://perfilapro.es',
    });
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
    expect(countPages(buf)).toBe(2);
  });
  it('renderiza el patrocinador en la cara B sin romper', async () => {
    const buf = await buildPlayerCardPVC({
      card: { slug: 'p-2', nombre: 'Ana', foto_url: null },
      club: { name: 'CD Test', color_primary: '#0A1F44', logo_url: null },
      season: { dorsal: 7, season: '2025-26' },
      logoBuffer: null, photoBuffer: PNG_1PX, sponsorBuffer: PNG_1PX,
      siteUrl: 'https://perfilapro.es',
    });
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
    expect(countPages(buf)).toBe(2);
  });
  it('booklet con varios jugadores genera PDF', async () => {
    const players = [
      { card: { slug: 'p-1', nombre: 'A', foto_url: null }, season: { dorsal: 1 } },
      { card: { slug: 'p-2', nombre: 'B', foto_url: null }, season: { dorsal: 2 } },
    ];
    const buf = await buildPlayerCardsBookletPDF({ players, club: { name: 'CD', color_primary: '#0A1F44', logo_url: null }, siteUrl: 'https://x' });
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
    // 2 jugadores × 2 caras = 4 páginas.
    expect(countPages(buf)).toBe(4);
  });
  it('booklet vacío lanza', async () => {
    await expect(buildPlayerCardsBookletPDF({ players: [], club: {} })).rejects.toThrow();
  });
});

// ───────────────────────── nfc-register ─────────────────────────

function nfcEvent(body, pwd = 'admin123') {
  return { httpMethod: 'POST', headers: { 'x-admin-password': pwd, 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify(body) };
}
function nfcDb({ order = { id: 'o1', card_slug: 'p-1', status: 'paid' }, updateErr = null } = {}) {
  const updates = [];
  return {
    updates,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: resolve({ data: order, error: null }),
          order: () => ({ limit: () => ({ maybeSingle: resolve({ data: order, error: null }) }) }),
        }),
      }),
      update: (p) => { updates.push(p); return { eq: resolve({ error: updateErr }) }; },
    }),
  };
}

describe('nfc-register', () => {
  beforeEach(() => { process.env.ADMIN_PASSWORD = 'admin123'; delete process.env.ADMIN_TOTP_SECRET; });

  it('401 sin auth', async () => {
    expect((await makeNfc(nfcDb())(nfcEvent({ order_id: 'o1', nfc_uid: 'AB' }, 'mal'))).statusCode).toBe(401);
  });
  it('400 sin nfc_uid', async () => {
    expect((await makeNfc(nfcDb())(nfcEvent({ order_id: 'o1' }))).statusCode).toBe(400);
  });
  it('404 si no encuentra el pedido', async () => {
    expect((await makeNfc(nfcDb({ order: null }))(nfcEvent({ order_id: 'o9', nfc_uid: 'AB' }))).statusCode).toBe(404);
  });
  it('200 registra UID y avanza a sent_to_printer', async () => {
    const db = nfcDb();
    const res = await makeNfc(db)(nfcEvent({ order_id: 'o1', nfc_uid: '04A1B2C3' }));
    expect(res.statusCode).toBe(200);
    expect(db.updates[0]).toEqual({ nfc_uid: '04A1B2C3', status: 'sent_to_printer' });
  });
  it('409 si el UID ya está asignado (unique)', async () => {
    const db = nfcDb({ updateErr: { message: 'duplicate key value violates unique constraint' } });
    expect((await makeNfc(db)(nfcEvent({ order_id: 'o1', nfc_uid: 'dup' }))).statusCode).toBe(409);
  });
});

// ───────────────────────── print-order-export ─────────────────────────

function expEvent(body) {
  return { httpMethod: 'POST', headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify(body) };
}
function expDb({ orders = [{ id: 'o1', card_slug: 'p-1', organization_id: 'c1', kind: 'setup', status: 'paid', nfc_uid: null, ordered_at: '2026-01-01' }], cards = [{ slug: 'p-1', nombre: 'Leo' }] } = {}) {
  return {
    from: (t) => {
      if (t === 'card_print_orders') {
        const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: orders, error: null }) };
        return chain;
      }
      if (t === 'cards') return { select: () => ({ in: resolve({ data: cards, error: null }) }) };
      return {};
    },
  };
}

describe('print-order-export', () => {
  beforeEach(() => { process.env.ADMIN_PASSWORD = 'admin123'; delete process.env.ADMIN_TOTP_SECRET; });

  it('401 sin auth', async () => {
    const res = await makeExport(expDb())({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ format: 'csv' }) });
    expect(res.statusCode).toBe(401);
  });
  it('csv: devuelve text/csv con cabecera y filas', async () => {
    const res = await makeExport(expDb())(expEvent({ format: 'csv' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.body.split('\n')[0]).toBe('order_id,card_slug,nombre,organization_id,kind,status,nfc_uid,ordered_at');
    expect(res.body).toContain('p-1');
    expect(res.body).toContain('Leo');
  });
  it('format inválido → 400', async () => {
    expect((await makeExport(expDb())(expEvent({ format: 'xml' }))).statusCode).toBe(400);
  });

  // Filtro "solo carnets listos" (foto + equipo + dorsal).
  function expDbReady() {
    const orders = [
      { id: 'o1', card_slug: 'p-1', organization_id: 'c1', kind: 'setup', status: 'paid', nfc_uid: null, ordered_at: '2026-01-01' },
      { id: 'o2', card_slug: 'p-2', organization_id: 'c1', kind: 'setup', status: 'paid', nfc_uid: null, ordered_at: '2026-01-02' },
    ];
    const cards = [
      { slug: 'p-1', nombre: 'Leo', foto_url: 'https://x/p1.png' },  // listo
      { slug: 'p-2', nombre: 'Ana', foto_url: null },                 // falta foto
    ];
    const seasons = [
      { card_slug: 'p-1', role: 'jugador', dorsal: 10, team_id: null, team_name: 'Infantil A' },
      { card_slug: 'p-2', role: 'jugador', dorsal: 7, team_id: null, team_name: 'Infantil A' },
    ];
    return {
      from: (t) => {
        if (t === 'card_print_orders') {
          const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: orders, error: null }) };
          return chain;
        }
        if (t === 'cards') return { select: () => ({ in: () => Promise.resolve({ data: cards, error: null }) }) };
        if (t === 'member_club_seasons') return { select: () => ({ in: () => ({ is: () => Promise.resolve({ data: seasons, error: null }) }) }) };
        return {};
      },
    };
  }

  it('only_ready=true filtra a los carnets listos (foto+equipo+dorsal)', async () => {
    const res = await makeExport(expDbReady())(expEvent({ format: 'csv', only_ready: true }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('p-1');
    expect(res.body).not.toContain('p-2');
  });

  it('sin only_ready exporta todo el lote', async () => {
    const res = await makeExport(expDbReady())(expEvent({ format: 'csv' }));
    expect(res.body).toContain('p-1');
    expect(res.body).toContain('p-2');
  });
});
