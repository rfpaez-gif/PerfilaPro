'use strict';

/**
 * PerfilaPro · Logo wordmark SSR helper
 *
 * Renderiza el wordmark "Perfila" + "Pro" italic verde para usar
 * en cualquier función que emita HTML server-side (card.js,
 * dir-utils.js, email-layout.js si quiere; estáticos lo escriben
 * a mano con la misma estructura).
 *
 * El componente vive en public/styles/components.css → .pp-logo.
 *
 * Brief de marca:
 *   - Tipografía: Source Serif 4 weight 600, letter-spacing -0.02em
 *   - "Perfila"  → Tinta #0A1F44 (default)
 *   - "Pro"      → Verde Match #00C277, italic, mismo peso
 *   - Sobre tinta: "Perfila" blanco, "Pro" verde
 *   - Sobre verde: ambos blancos (mantiene contraste)
 */

const SIZES    = ['xs', 'sm', 'md', 'lg', 'hero'];
const VARIANTS = ['default', 'on-tinta', 'on-verde', 'mono-tinta', 'mono-blanco', 'mono-verde'];

/**
 * Devuelve el HTML del wordmark.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.size='sm']        xs | sm | md | lg | hero
 * @param {string}  [opts.variant='default']default | on-tinta | on-verde | mono-tinta | mono-blanco | mono-verde
 * @param {string}  [opts.href]             si se pasa, se renderiza como <a>
 * @param {string}  [opts.tag='span']       tag a usar cuando no hay href (span | h1 | div...)
 * @param {string}  [opts.ariaLabel='PerfilaPro']
 * @param {string}  [opts.className]        clases extra (separadas por espacio)
 * @returns {string} HTML
 */
function renderLogo(opts = {}) {
  const size       = SIZES.includes(opts.size) ? opts.size : 'sm';
  const variant    = VARIANTS.includes(opts.variant) ? opts.variant : 'default';
  const href       = opts.href || null;
  const tag        = href ? 'a' : (opts.tag || 'span');
  const ariaLabel  = opts.ariaLabel || 'PerfilaPro';
  const extraCls   = opts.className ? ` ${String(opts.className)}` : '';

  const cls = `pp-logo pp-logo--${size}${variant !== 'default' ? ` pp-logo--${variant}` : ''}${extraCls}`;

  const attrs = href
    ? ` href="${href}" aria-label="${ariaLabel}"`
    : ` role="img" aria-label="${ariaLabel}"`;

  return `<${tag} class="${cls}"${attrs}>Perfila<span class="pp-logo__pro">Pro</span></${tag}>`;
}

/**
 * Lockup vertical: wordmark + tagline maestro debajo.
 * Usado en hero, deck, factura, asset descargable.
 *
 * @param {Object} [opts]
 * @param {string} [opts.size='lg']       Tamaño del wordmark
 * @param {string} [opts.variant='default']
 * @param {string} [opts.tagline='Tu trabajo merece verse.']
 * @returns {string} HTML
 */
function renderLogoLockup(opts = {}) {
  const tagline = opts.tagline || 'Tu trabajo merece verse.';
  const variant = VARIANTS.includes(opts.variant) ? opts.variant : 'default';
  const wrapVariant =
    variant === 'on-tinta' ? ' pp-logo-lockup--on-tinta'
    : variant === 'on-verde' ? ' pp-logo-lockup--on-verde'
    : '';

  const wordmark = renderLogo({ size: opts.size || 'lg', variant });
  return `<div class="pp-logo-lockup${wrapVariant}">${wordmark}<span class="pp-logo__tagline">${escapeHtml(tagline)}</span></div>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { renderLogo, renderLogoLockup, SIZES, VARIANTS };
