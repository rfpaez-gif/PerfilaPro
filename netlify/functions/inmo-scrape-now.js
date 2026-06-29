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

function makeHandler(db, emailClient = resend, deps = {}) {
  return async (event) => {
    if (!isInmoActive()) return inmoDisabledResponse();

    const key = event.queryStringParameters?.key;
    if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
      return json(401, { error: 'no autorizado (falta ?key=ADMIN_PASSWORD)' });
    }

    const siteUrl = process.env.SITE_URL || 'https://perfilapro.es';
    const dry = event.queryStringParameters?.dry === '1';

    try {
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
