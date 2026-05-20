'use strict';

const PAGES = [
  { path: 'empresas',   priority: '1.0', changefreq: 'weekly'  },
  { path: '',           priority: '0.9', changefreq: 'weekly'  },
  { path: 'alta',       priority: '0.8', changefreq: 'monthly' },
  { path: 'terminos',   priority: '0.3', changefreq: 'yearly'  },
  { path: 'privacidad', priority: '0.3', changefreq: 'yearly'  },
  { path: 'legal',      priority: '0.3', changefreq: 'yearly'  },
];

const LANGS = ['es', 'ca'];

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const today = new Date().toISOString().split('T')[0];

  const entries = [];

  for (const { path, priority, changefreq } of PAGES) {
    for (const lang of LANGS) {
      const suffix = path ? `/${path}` : '/';
      const loc = `${siteUrl}/${lang}${suffix}`;

      const alternates = LANGS.map(l =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(`${siteUrl}/${l}${suffix}`)}"/>`
      ).join('\n');
      const xDefault =
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(`${siteUrl}/es${suffix}`)}"/>`;

      entries.push(
        `  <url>\n` +
        `    <loc>${escapeXml(loc)}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `${alternates}\n${xDefault}\n` +
        `  </url>`
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
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
