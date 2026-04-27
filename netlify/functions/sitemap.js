'use strict';

const { getDb } = require('./lib/supabase-client');

const SITEMAP_PAGE_SIZE = 1000;

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const db = getDb();

  const { count } = await db
    .from('cards')
    .select('slug', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('directory_visible', true);

  const totalProfiles = count || 0;
  const profilePages  = Math.max(1, Math.ceil(totalProfiles / SITEMAP_PAGE_SIZE));

  const today = new Date().toISOString().split('T')[0];

  const staticSitemaps = [
    `${siteUrl}/sitemap-categorias.xml`,
  ];

  const profileSitemaps = Array.from({ length: profilePages }, (_, i) =>
    `${siteUrl}/sitemap-perfiles.xml?p=${i + 1}`
  );

  const entries = [...staticSitemaps, ...profileSitemaps]
    .map(loc => `  <sitemap>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
    body: xml,
  };
};
