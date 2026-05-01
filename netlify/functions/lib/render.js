'use strict';

const SITE_URL = process.env.SITE_URL || 'https://perfilapro.es';

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Geist:wght@400;500;600&' +
  'family=Geist+Mono:wght@400;500&' +
  'family=Fraunces:ital,wght@0,400;1,400&' +
  'display=swap';

/**
 * Devuelve el bloque <head> base que debe usar cualquier función
 * que renderice HTML server-side. Garantiza que tokens.css,
 * fuentes y meta tags básicos estén presentes y consistentes.
 *
 * @param {Object}  opts
 * @param {string}  opts.title          Título de la página
 * @param {string}  opts.description    Meta description (SEO)
 * @param {string} [opts.canonical]     URL canónica absoluta
 * @param {string} [opts.ogImage]       URL absoluta de imagen OG
 * @param {boolean}[opts.noindex=false] Si true añade noindex/nofollow
 * @param {string} [opts.extraHead='']  HTML extra a inyectar al final
 * @returns {string} HTML del bloque <head> SIN las tags <head></head>
 */
function renderHead(opts) {
  const {
    title,
    description,
    canonical,
    ogImage = `${SITE_URL}/assets/og-default.png`,
    noindex = false,
    extraHead = '',
  } = opts || {};

  const safeTitle = esc(title);
  const safeDesc  = esc(description);

  return `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:site_name" content="PerfilaPro">
<meta property="og:locale" content="es_ES">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${esc(ogImage)}">

<!-- Favicon -->
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">

<!-- Sistema de marca -->
<link rel="stylesheet" href="/styles/brand.css">

<!-- Tipografía -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS_HREF}" rel="stylesheet">

${extraHead}`.trim();
}

/**
 * Wrapper de página completa.
 *
 * @param {Object} opts
 * @param {string} opts.head           HTML del head (devuelto por renderHead)
 * @param {string} opts.body           HTML del body
 * @param {string} [opts.lang='es']
 * @param {string} [opts.bodyClass=''] Clases CSS para <body>
 * @returns {string} HTML completo de la página con DOCTYPE
 */
function renderPage({ head, body, lang = 'es', bodyClass = '' } = {}) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
${head}
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
${body}
</body>
</html>`;
}

/**
 * Escape HTML básico para texto en atributos y nodos.
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { renderHead, renderPage, esc };
