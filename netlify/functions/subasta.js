'use strict';

// Render público de la ficha de una subasta · /s/:slug.
// Reusa el patrón de card.js (slug por query o path, single() en
// Supabase, log de visita no bloqueante) pero contra `subastas`.
// Gateado por INMO_VERTICAL_ACTIVE.

const { createClient } = require('@supabase/supabase-js');
const { isInmoActive } = require('./lib/inmo/flag');
const { renderSubastaPage, renderNotFound } = require('./lib/inmo/subasta-render');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HTML = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body,
});

function makeHandler(db) {
  return async (event) => {
    if (!isInmoActive()) return HTML(404, renderNotFound());

    const slugFromQuery = event.queryStringParameters?.slug;
    const slugFromPath = (event.path || '')
      .replace('/.netlify/functions/subasta', '')
      .replace(/^\/s\//, '')
      .replace(/\/$/, '');
    const slug = slugFromQuery || slugFromPath;
    if (!slug) return HTML(400, renderNotFound());

    const { data, error } = await db
      .from('subastas')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error || !data) return HTML(404, renderNotFound());

    // log de visita, no bloqueante (no rompe el render si falla)
    try {
      db.from('subasta_visits').insert({ subasta_slug: data.slug }).then?.(() => {}, () => {});
    } catch (_) { /* noop */ }

    return HTML(200, renderSubastaPage(data, { siteUrl: process.env.SITE_URL }));
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
