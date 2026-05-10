'use strict';

// Páginas client-facing indexables, en ES y CA. Cada entrada genera DOS <url>
// (una por idioma) con el mismo bloque de <xhtml:link rel="alternate"> — patrón
// recomendado por Google para sitemaps multilingües.
// Excluidas: /editar y /success llevan robots=noindex (token-protected /
// post-pago, sin valor SEO).
const PAGES = [
  { path: '',           priority: '1.0', changefreq: 'weekly'  },
  { path: 'alta',       priority: '0.9', changefreq: 'monthly' },
  { path: 'terminos',   priority: '0.4', changefreq: 'yearly'  },
  { path: 'privacidad', priority: '0.4', changefreq: 'yearly'  },
  { path: 'legal',      priority: '0.4', changefreq: 'yearly'  },
];

const LANGS = ['es', 'ca'];

function buildLangUrl(siteUrl, lang, path) {
  return path ? `${siteUrl}/${lang}/${path}` : `${siteUrl}/${lang}/`;
}

function buildAlternates(siteUrl, path) {
  const links = LANGS.map(lang =>
    `    <xhtml:link rel="alternate" hreflang="${lang}" href="${buildLangUrl(siteUrl, lang, path)}"/>`
  );
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/"/>`);
  return links.join('\n');
}

function buildUrlEntry({ siteUrl, lang, path, priority, changefreq, lastmod }) {
  const loc = buildLangUrl(siteUrl, lang, path);
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    buildAlternates(siteUrl, path),
    '  </url>',
  ].join('\n');
}

function buildSitemapXml(siteUrl, today) {
  const entries = PAGES.flatMap(({ path, priority, changefreq }) =>
    LANGS.map(lang => buildUrlEntry({
      siteUrl, lang, path, priority, changefreq, lastmod: today,
    }))
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>`;
}

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;
  const today   = new Date().toISOString().split('T')[0];

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
    body: buildSitemapXml(siteUrl, today),
  };
};

exports.PAGES = PAGES;
exports.LANGS = LANGS;
exports.buildSitemapXml = buildSitemapXml;
