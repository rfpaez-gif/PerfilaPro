'use strict';

// Disparador manual del rastreo INMO — para probar sin esperar al cron de
// las 07:00. Protegido con ?key=<ADMIN_PASSWORD>.
//
//   GET /api/inmo-scrape-now?key=XXX&dry=1   → rastrea y NO escribe en BD
//                                              (prueba pura del scraper).
//   GET /api/inmo-scrape-now?key=XXX         → rastrea, persiste y avisa.
//
// Devuelve JSON con lo encontrado (municipio, tipo, valor, enlace a la
// ficha /s/:slug y al BOE), para ver el resultado de un vistazo.
//
// Gateado por INMO_VERTICAL_ACTIVE. Mismo motor que la scheduled function.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const { isInmoActive, inmoDisabledResponse } = require('./lib/inmo/flag');
const { centsToEuros } = require('./lib/inmo/subasta-model');
const boe = require('./lib/inmo/boe-client');
const { scrapeCoastalSubastas, persist } = require('./inmo-scrape-subastas');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj, null, 2),
});

function summarize(rows, siteUrl) {
  return rows.map((r) => ({
    municipio: r.municipio,
    tipo: r.tipo_bien,
    valor: centsToEuros(r.valor_subasta_cents),
    cierra: r.fecha_fin,
    ficha: `${siteUrl}/s/${r.slug}`,
    boe: r.detalle_url,
  }));
}

// fetch con timeout que NO lanza en HTTP != 2xx (queremos ver el status).
async function rawFetch(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': boe.BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    });
    const html = await res.text();
    return { status: res.status, html };
  } finally {
    clearTimeout(timer);
  }
}

// Extrae cada <select name> del HTML con sus <option value>texto. Capado
// para no devolver una respuesta enorme.
function dumpSelects(html) {
  const out = [];
  const selRe = /<select\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  let m;
  while ((m = selRe.exec(html)) !== null && out.length < 30) {
    const name = m[1];
    const inner = m[2];
    const options = [];
    const optRe = /<option\b[^>]*\bvalue="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let o;
    while ((o = optRe.exec(inner)) !== null && options.length < 70) {
      options.push({ value: o[1], text: o[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    out.push({ name, options });
  }
  return out;
}

// Vuelca los <input> del formulario (name/value/type), filtrado a los
// que importan (campo[N]/dato[N]/accion/page_hits/sort). Los campo[N]
// son inputs ocultos con el CÓDIGO de campo — la pieza que falta para
// armar la URL de búsqueda.
function dumpInputs(html) {
  const out = [];
  const tagRe = /<input\b[^>]*>/gi;
  let t;
  while ((t = tagRe.exec(html)) !== null && out.length < 90) {
    const tag = t[0];
    const name = (tag.match(/\bname="([^"]*)"/i) || [])[1];
    if (!name || !/^(campo|dato)\[|^(accion|page_hits|sort_field|sort_order)/.test(name)) continue;
    const value = (tag.match(/\bvalue="([^"]*)"/i) || [])[1] || '';
    const type = (tag.match(/\btype="([^"]*)"/i) || [])[1] || 'text';
    out.push({ name, value, type });
  }
  return out;
}

// Diagnóstico: qué devuelve el BOE y qué nombres de campo / código de
// provincia trae el formulario de búsqueda. Sirve para corregir la URL
// de búsqueda sin acceso directo al portal.
async function debugProbe(fetchImpl) {
  const out = { usingCustomUrl: !!process.env.INMO_BOE_SEARCH_URL };

  // 1) La URL de búsqueda que usa el scraper.
  const searchUrl = boe.buildSearchUrl();
  let ids = [];
  try {
    const { status, html } = await rawFetch(searchUrl, fetchImpl);
    ids = boe.extractIdSubs(html);
    out.search = {
      url: searchUrl,
      status,
      length: html.length,
      idSubs: ids.length,
      idSubsSample: ids.slice(0, 5),
      snippet: html.replace(/\s+/g, ' ').slice(0, 1200),
    };
  } catch (e) {
    out.search = { url: searchUrl, error: e.message };
  }

  // 1b) Si hay resultados, baja la PRIMERA ficha y la parsea — así
  //     verificamos el parser de detalle en la misma pasada.
  if (ids.length) {
    const detalleUrl = `https://subastas.boe.es/detalleSubasta.php?idSub=${ids[0]}`;
    try {
      const { status, html } = await rawFetch(detalleUrl, fetchImpl);
      const parsed = boe.parseDetalle(html, { idSubasta: ids[0], detalleUrl });
      out.detalle = {
        url: detalleUrl,
        status,
        length: html.length,
        parsed,
        snippet: html.replace(/\s+/g, ' ').slice(0, 2500),
      };
    } catch (e) {
      out.detalle = { url: detalleUrl, error: e.message };
    }
  }

  // 2) El formulario de búsqueda: vuelca cada <select> con sus opciones
  //    (value+texto) para leer los códigos reales de campo[N]/dato[N]
  //    (qué código = provincia, tipo de bien, estado, y sus valores).
  try {
    const { status, html } = await rawFetch('https://subastas.boe.es/subastas_ava.php', fetchImpl);
    out.form = {
      status,
      length: html.length,
      inputs: dumpInputs(html),
      selects: dumpSelects(html),
    };
  } catch (e) {
    out.form = { error: e.message };
  }

  return out;
}

function makeHandler(db, emailClient = resend, deps = {}) {
  return async (event) => {
    if (!isInmoActive()) return inmoDisabledResponse();

    const key = event.queryStringParameters?.key;
    if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
      return json(401, { error: 'no autorizado (falta ?key=ADMIN_PASSWORD)' });
    }

    const siteUrl = process.env.SITE_URL || 'https://perfilapro.es';
    const dry = event.queryStringParameters?.dry === '1';
    const debug = event.queryStringParameters?.debug === '1';

    try {
      if (debug) {
        const fetchImpl = deps.fetchImpl || globalThis.fetch;
        return json(200, { debug: true, ...(await debugProbe(fetchImpl)) });
      }

      if (dry) {
        // Rastrea sin tocar la BD: prueba pura del scraper + geofiltro.
        const rows = await scrapeCoastalSubastas({ ...deps, log: (m) => console.log(`inmo-now: ${m}`) });
        return json(200, { ok: true, dry: true, encontradas: rows.length, subastas: summarize(rows, siteUrl) });
      }

      // Rastreo real: persiste y (si hay inbox) avisa. Reusa el motor del cron.
      const rows = await scrapeCoastalSubastas({ ...deps, log: (m) => console.log(`inmo-now: ${m}`) });
      const { nuevas } = await persist(db, rows, new Date());
      return json(200, {
        ok: true, dry: false,
        encontradas: rows.length, nuevas: nuevas.length,
        subastas: summarize(rows, siteUrl),
      });
    } catch (err) {
      console.error('inmo-now:', err);
      return json(500, { error: err.message });
    }
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.summarize = summarize;
