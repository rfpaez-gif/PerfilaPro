'use strict';

/**
 * PerfilaPro · ProCard · helper SSR
 *
 * Card del directorio. Foto vertical 4/5, pastilla con nombre+trade
 * superpuesta sobre la foto, pie con handle (mono) + location (sans).
 *
 * Variantes:
 *   default      · sobre #FFFFFF, borde gris-200
 *   on-crema     · sobre var(--color-crema), borde gris-200
 *   placeholder  · sin foto (isotipo P), CTA "¿Eres tú?" en pie
 *
 * Estilos: public/styles/components.css   (.pp-pro-card, modificadores)
 * Demo:    public/_dev/components.html
 */

const { esc } = require('./render.js');

const VARIANTS = new Set(['default', 'on-crema', 'placeholder']);

/**
 * @param {Object}  opts
 * @param {string}  opts.name                      Nombre del profesional.
 * @param {string}  opts.trade                     Oficio o rol.
 * @param {string}  opts.handle                    Handle/slug.
 * @param {string} [opts.photo]                    URL de la foto.
 * @param {string} [opts.location]                 Localización (ej. "Madrid").
 * @param {string} [opts.href]                     Si está, la card es un link.
 * @param {string} [opts.domain='perfilapro.es']   Dominio en el handle.
 * @param {'default'|'on-crema'|'placeholder'} [opts.variant='default']
 * @returns {string} HTML de la card.
 */
function renderProCard(opts = {}) {
  const {
    photo = null,
    name = '',
    trade = '',
    handle = '',
    location = null,
    href = null,
    domain = 'perfilapro.es',
    variant = 'default',
  } = opts;

  const safeVariant = VARIANTS.has(variant) ? variant : 'default';
  const isPlaceholder = safeVariant === 'placeholder';
  const tag = href ? 'a' : 'article';
  const hrefAttrs = href ? ` href="${esc(href)}"` : '';
  const cls = [
    'pp-pro-card',
    `pp-pro-card--${safeVariant}`,
    href ? 'pp-pro-card--link' : null,
  ].filter(Boolean).join(' ');

  const showImage = !isPlaceholder && photo;

  const photoInner = showImage
    ? `<img class="pp-pro-card__img" src="${esc(photo)}" alt="" loading="lazy">`
    : `<span class="pp-pro-card__fallback" aria-hidden="true">P</span>`;

  const hasOverlay = name || trade;
  const overlay = hasOverlay
    ? `<div class="pp-pro-card__overlay">`
      + (name  ? `<p class="pp-pro-card__name">${esc(name)}</p>`   : '')
      + (trade ? `<p class="pp-pro-card__trade">${esc(trade)}</p>` : '')
      + `</div>`
    : '';

  const footHandle = handle
    ? `<span class="pp-pro-card__handle">`
      + `<span class="pp-pro-card__handle-domain">${esc(domain)}</span>`
      + `<span class="pp-pro-card__handle-slash" aria-hidden="true">/</span>`
      + `<span class="pp-pro-card__handle-name">${esc(handle)}</span>`
      + `</span>`
    : '';

  const footRight = isPlaceholder
    ? `<span class="pp-pro-card__cta">¿Eres tú?</span>`
    : (location ? `<span class="pp-pro-card__location">${esc(location)}</span>` : '');

  return `<${tag} class="${cls}"${hrefAttrs}>`
    + `<div class="pp-pro-card__photo">${photoInner}${overlay}</div>`
    + `<div class="pp-pro-card__foot">${footHandle}${footRight}</div>`
    + `</${tag}>`;
}

module.exports = { renderProCard };
