'use strict';

/**
 * PerfilaPro · UrlPill · helper SSR
 *
 * Devuelve el HTML string de una "pastilla de URL" — el elemento
 * más repetido del producto. Pensado para consumirse desde
 * funciones SSR (card.js, dir-utils.js, perfil-publico.js,
 * share-templates.js) y desde plantillas de email.
 *
 * Estilos: public/styles/components.css   (clase .pp-url-pill)
 * Copy JS: public/js/url-pill.js          (handler global de portapapeles)
 * Demo:    public/_dev/url-pill.html      (todas las variantes y tamaños)
 *
 * Tokens consumidos (definidos en /styles/tokens-color.css y
 * /styles/tokens-typography.css):
 *   --color-tinta, --color-verde-match, --color-verde-dark,
 *   --color-verde-light, --color-piedra, --color-gris-200,
 *   --color-gris-500, --color-coral, --font-mono, --font-serif.
 *
 * Nota HTML5: combinar `href` + `copyable` produce un <button>
 * dentro de un <a>, técnicamente prohibido por la spec aunque
 * todos los navegadores lo toleran y el handler de copy hace
 * stopPropagation para evitar la navegación. Si el linter/CI lo
 * marca, prefiere href XOR copyable.
 */

const { esc } = require('./render.js');

const SIZES = new Set(['sm', 'md', 'lg', 'xl']);
const VARIANTS = new Set(['default', 'on-tinta', 'ghost', 'draft', 'error']);

/**
 * @param {Object}  opts
 * @param {string} [opts.domain='perfilapro.es']
 * @param {string}  opts.handle                       Slug/handle del profesional.
 * @param {'sm'|'md'|'lg'|'xl'} [opts.size='md']
 * @param {'default'|'on-tinta'|'ghost'|'draft'|'error'} [opts.variant='default']
 * @param {boolean} [opts.showSeal=false]             Sello P al inicio.
 * @param {boolean} [opts.copyable=false]             Botón "Copiar" al final.
 * @param {string|null} [opts.href=null]              Si está, el wrapper es <a>.
 * @returns {string} HTML inline (sin saltos de línea innecesarios).
 */
function renderUrlPill(opts = {}) {
  const {
    domain = 'perfilapro.es',
    handle,
    size = 'md',
    variant = 'default',
    showSeal = false,
    copyable = false,
    href = null,
  } = opts;

  if (!handle) return '';

  const safeSize = SIZES.has(size) ? size : 'md';
  const safeVariant = VARIANTS.has(variant) ? variant : 'default';

  const classes = [
    'pp-url-pill',
    `pp-url-pill--${safeSize}`,
    `pp-url-pill--${safeVariant}`,
    href ? 'pp-url-pill--link' : null,
  ].filter(Boolean).join(' ');

  const tag = href ? 'a' : 'span';
  const hrefAttrs = href
    ? ` href="${esc(href)}"`
    : '';

  const fullUrl = `https://${domain}/${handle}`;

  const seal = showSeal
    ? `<span class="pp-url-pill__seal" aria-hidden="true">P</span>`
    : '';

  const badge = safeVariant === 'draft'
    ? `<span class="pp-url-pill__badge">borrador</span>`
    : '';

  const copy = copyable
    ? `<button type="button" class="pp-url-pill__copy" data-pp-copy="${esc(fullUrl)}" aria-label="Copiar URL al portapapeles">Copiar</button>`
    : '';

  return `<${tag} class="${classes}"${hrefAttrs}>`
    + seal
    + `<span class="pp-url-pill__domain">${esc(domain)}</span>`
    + `<span class="pp-url-pill__slash" aria-hidden="true">/</span>`
    + `<span class="pp-url-pill__handle">${esc(handle)}</span>`
    + badge
    + copy
    + `</${tag}>`;
}

module.exports = { renderUrlPill };
