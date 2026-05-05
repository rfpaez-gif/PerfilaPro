'use strict';

/**
 * PerfilaPro · Avatar · helper SSR
 *
 * Avatar de profesional. Cuadrado redondeado (NUNCA circular) en 4 tamaños.
 * Si no hay src, fallback a iniciales (max 2 chars) o "P" sobre fondo Tinta
 * en serif italic verde-match.
 *
 * Estilos: public/styles/components.css   (.pp-avatar, .pp-avatar--<size>)
 * Demo:    public/_dev/components.html
 */

const { esc } = require('./render.js');

const SIZES = new Set(['xs', 'sm', 'md', 'hero']);

/**
 * @param {Object}  opts
 * @param {string}  opts.alt                          Texto accesible (obligatorio).
 * @param {string} [opts.src]                         URL de la foto.
 * @param {string} [opts.initials]                    Fallback (max 2 chars).
 * @param {'xs'|'sm'|'md'|'hero'} [opts.size='sm']
 * @param {boolean} [opts.showStatus=false]           Punto verde "activo".
 *                                                    Solo aplica a size=hero.
 * @returns {string} HTML del avatar.
 */
function renderAvatar(opts = {}) {
  const {
    src = null,
    initials = null,
    size = 'sm',
    showStatus = false,
    alt = '',
  } = opts;

  const safeSize = SIZES.has(size) ? size : 'sm';
  const cls = `pp-avatar pp-avatar--${safeSize}`;
  const safeAlt = esc(alt);

  const status = (showStatus && safeSize === 'hero')
    ? `<span class="pp-avatar__status" aria-hidden="true"></span>`
    : '';

  if (src) {
    return `<span class="${cls}">`
      + `<img class="pp-avatar__img" src="${esc(src)}" alt="${safeAlt}" loading="lazy">`
      + status
      + `</span>`;
  }

  // Fallback: iniciales (max 2) o "P".
  const raw = initials ? String(initials).trim() : '';
  const text = (raw && raw.slice(0, 2).toUpperCase()) || 'P';

  return `<span class="${cls}" role="img" aria-label="${safeAlt}">`
    + `<span class="pp-avatar__init" aria-hidden="true">${esc(text)}</span>`
    + status
    + `</span>`;
}

module.exports = { renderAvatar };
