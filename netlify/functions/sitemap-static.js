'use strict';

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const today = new Date().toISOString().split('T')[0];

  const staticUrls = [
    { loc: `${siteUrl}/alta`, priority: '0.8', changefreq: 'monthly' },
  ];

  const entries = staticUrls.map(({ loc, priority, changefreq }) =>
    `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
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
