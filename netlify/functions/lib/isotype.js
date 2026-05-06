'use strict';

/**
 * PerfilaPro · Isotipo SSR helper
 *
 * Renderiza la "P" italic verde sobre cuadrado redondeado tinta.
 * Misma "P" extraída del wordmark — no es un símbolo arbitrario.
 *
 * Componente: public/styles/components.css → .pp-iso
 *
 * Tamaños canónicos del brief: 16, 32, 48, 64, 128 px.
 *   · 16  · mínimo
 *   · 32  · favicon
 *   · 48  · sello QR
 *   · 64  · avatar redes
 *   · 128 · app icon
 *
 * Fondos:
 *   · 'tinta' (default) · cuadrado tinta + P verde
 *   · 'verde'           · cuadrado verde + P blanca
 *   · 'white'           · cuadrado blanco con borde + P tinta
 */

const SIZES       = [16, 32, 48, 64, 128];
const BACKGROUNDS = ['tinta', 'verde', 'white'];

/**
 * @param {Object} [opts]
 * @param {number} [opts.size=48]
 * @param {string} [opts.background='tinta']
 * @param {string} [opts.alt='PerfilaPro']
 * @param {string} [opts.className]
 * @returns {string} HTML
 */
function renderIsotype(opts = {}) {
  const size = SIZES.includes(opts.size) ? opts.size : 48;
  const bg   = BACKGROUNDS.includes(opts.background) ? opts.background : 'tinta';
  const alt  = opts.alt || 'PerfilaPro';
  const extraCls = opts.className ? ` ${String(opts.className)}` : '';

  const cls = `pp-iso pp-iso--${size}${bg !== 'tinta' ? ` pp-iso--bg-${bg}` : ''}${extraCls}`;

  return `<span class="${cls}" role="img" aria-label="${alt}"><span class="pp-iso__P">P</span></span>`;
}

module.exports = { renderIsotype, SIZES, BACKGROUNDS };
