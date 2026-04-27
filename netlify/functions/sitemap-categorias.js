'use strict';

const { getDb } = require('./lib/supabase-client');

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const db = getDb();
  const { data: categories } = await db
    .from('categories')
    .select('sector, specialty')
    .order('sector')
    .order('sort_order');

  const today = new Date().toISOString().split('T')[0];

  const staticUrls = [
    { loc: `${siteUrl}/directorio`, priority: '0.9' },
  ];

  const sectorsSeen = new Set();
  const sectorUrls = [];
  const specialtyUrls = [];

  (categories || []).forEach(({ sector, specialty }) => {
    if (!sectorsSeen.has(sector)) {
      sectorsSeen.add(sector);
      sectorUrls.push({ loc: `${siteUrl}/directorio/${sector}`, priority: '0.8' });
    }
    specialtyUrls.push({ loc: `${siteUrl}/directorio/${sector}/${specialty}`, priority: '0.7' });
  });

  const allUrls = [...staticUrls, ...sectorUrls, ...specialtyUrls];

  const entries = allUrls.map(({ loc, priority }) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
    body: xml,
  };
};
