'use strict';

// Scheduled function · rastreo diario de subastas de inmuebles en la
// costa de Tarragona (Portal de Subastas del BOE).
//
// Flujo: busca inmuebles en la provincia 43 → recoge identificadores →
// abre el detalle de cada uno → se queda SOLO con los bienes cuya
// localidad cae en la franja costera (lib/inmo/municipios) → upsert en
// `subastas` → email de aviso con las nuevas y las que cierran pronto.
//
// Gateado por INMO_VERTICAL_ACTIVE: si está off, no hace nada.
// makeHandler(db, emailClient, deps) para tests con mocks.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const { isInmoActive } = require('./lib/inmo/flag');
const boe = require('./lib/inmo/boe-client');
const { municipioCostero } = require('./lib/inmo/municipios');
const { buildSubastaRow, cierraPronto } = require('./lib/inmo/subasta-model');
const { buildAlertEmail } = require('./lib/inmo/subasta-email');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
};

// Recorre el listado (con paginación best-effort) y los detalles,
// devolviendo las filas costeras listas para BD. fetchImpl inyectable.
async function scrapeCoastalSubastas(deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    log = () => {},
    maxPages = num(process.env.INMO_MAX_PAGES, 5, 1, 50),
    delayMs = num(process.env.INMO_REQUEST_DELAY_MS, 800, 0, 10000),
  } = deps;

  const searchUrl = boe.buildSearchUrl();
  const ids = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? searchUrl : `${searchUrl}${searchUrl.includes('?') ? '&' : '?'}page=${page}`;
    let html;
    try {
      html = await boe.fetchText(url, { fetchImpl });
    } catch (err) {
      log(`listado p${page}: ${err.message}`);
      break;
    }
    const pageIds = boe.extractIdSubs(html).filter((id) => !seen.has(id));
    if (!pageIds.length) break; // no hay más resultados nuevos
    pageIds.forEach((id) => { seen.add(id); ids.push(id); });
    if (delayMs) await sleep(delayMs);
  }

  log(`${ids.length} subastas en provincia; filtrando costa…`);

  const rows = [];
  for (const idSubasta of ids) {
    const detalleUrl = `https://subastas.boe.es/detalleSubasta.php?idSub=${idSubasta}`;
    let html;
    try {
      html = await boe.fetchText(detalleUrl, { fetchImpl });
    } catch (err) {
      log(`detalle ${idSubasta}: ${err.message}`);
      continue;
    }
    const detalle = boe.parseDetalle(html, { idSubasta, detalleUrl });
    const municipio = municipioCostero(detalle.localidad);
    if (!municipio) { if (delayMs) await sleep(delayMs); continue; }
    rows.push(buildSubastaRow(detalle, municipio));
    if (delayMs) await sleep(delayMs);
  }

  log(`${rows.length} en la costa.`);
  return rows;
}

// Persiste las filas y devuelve { nuevas, cerrandoPronto } para avisar.
async function persist(db, rows, now) {
  if (!rows.length) return { nuevas: [], cerrandoPronto: [] };
  const ids = rows.map((r) => r.id);

  const { data: existingRows } = await db
    .from('subastas')
    .select('id,notified_new,notified_closing')
    .in('id', ids);
  const existing = new Map((existingRows || []).map((r) => [r.id, r]));

  const nowIso = now.toISOString();
  const toInsert = [];
  const updates = [];
  for (const r of rows) {
    if (existing.has(r.id)) {
      const { id, slug, ...mutable } = r; // no tocar id; slug es estable
      updates.push({ id: r.id, patch: { ...mutable, last_seen_at: nowIso } });
    } else {
      toInsert.push({ ...r, first_seen_at: nowIso, last_seen_at: nowIso });
    }
  }

  if (toInsert.length) await db.from('subastas').insert(toInsert);
  for (const u of updates) await db.from('subastas').update(u.patch).eq('id', u.id);

  const nuevas = toInsert;
  const cerrandoPronto = rows.filter((r) => {
    if (!cierraPronto(r, 3, now)) return false;
    const ex = existing.get(r.id);
    return !(ex && ex.notified_closing); // no repetir aviso de cierre
  });

  return { nuevas, cerrandoPronto };
}

async function processScrape(db, emailClient, deps = {}) {
  const now = deps.now || new Date();
  const log = deps.log || ((m) => console.log(`inmo-scrape: ${m}`));

  const rows = await scrapeCoastalSubastas({ ...deps, log });
  const { nuevas, cerrandoPronto } = await persist(db, rows, now);

  const inbox = process.env.INMO_ALERT_INBOX;
  let emailed = false;
  if (inbox && (nuevas.length || cerrandoPronto.length)) {
    const mail = buildAlertEmail({ nuevas, cerrandoPronto, siteUrl: process.env.SITE_URL });
    if (mail) {
      try {
        await emailClient.emails.send({
          from: 'PerfilaPro <hola@perfilapro.es>',
          to: inbox,
          subject: mail.subject,
          html: mail.html,
        });
        emailed = true;
        // marca como avisadas para no repetir
        if (nuevas.length) {
          await db.from('subastas').update({ notified_new: true }).in('id', nuevas.map((r) => r.id));
        }
        if (cerrandoPronto.length) {
          await db.from('subastas').update({ notified_closing: true }).in('id', cerrandoPronto.map((r) => r.id));
        }
      } catch (err) {
        log(`email: ${err.message}`);
      }
    }
  }

  return { scraped: rows.length, nuevas: nuevas.length, cerrandoPronto: cerrandoPronto.length, emailed };
}

function makeHandler(db, emailClient = resend, deps = {}) {
  return async () => {
    if (!isInmoActive()) {
      console.log('inmo-scrape: vertical apagado (INMO_VERTICAL_ACTIVE!=1)');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }
    const result = await processScrape(db, emailClient, deps);
    console.log(`inmo-scrape: ${JSON.stringify(result)}`);
    return { statusCode: 200, body: JSON.stringify(result) };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.scrapeCoastalSubastas = scrapeCoastalSubastas;
exports.persist = persist;
exports.processScrape = processScrape;
