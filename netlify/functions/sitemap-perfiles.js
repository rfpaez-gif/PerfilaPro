'use strict';

const { getDb } = require('./lib/supabase-client');
const { getVisibleProfileSlugs } = require('./lib/get-profile');

const PAGE_SIZE = 1000;

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const page = Math.max(1, parseInt(event.queryStringParameters?.p || '1', 10));
  const db   = getDb();

  const { slugs, error } = await getVisibleProfileSlugs(db, { page, pageSize: PAGE_SIZE });

  if (error) {
    console.error('sitemap-perfiles error:', error.message);
    return { statusCode: 500, body: 'Internal error' };
  }

  const today = new Date().toISOString().split('T')[0];
  const entries = slugs.map(({ slug, lastmod }) =>
    `  <url>\n    <loc>${siteUrl}/p/${slug}</loc>\n    <lastmod>${lastmod || today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
    body: xml,
  };
};
