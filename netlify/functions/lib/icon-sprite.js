'use strict';

/**
 * PerfilaPro · Icon · helper SSR
 *
 * Renderiza un <svg><use href="/sprite.svg#icon-{name}"/></svg> con la clase
 * .pp-icon + modificador de tamaño. El sprite vive en public/sprite.svg
 * (single source of truth visual).
 *
 * Estilos: public/styles/components.css   (.pp-icon, .pp-icon--<size>)
 * Demo:    public/_dev/components.html
 *
 * ¿Por qué sprite externo y no inline? Modern browsers (Chrome/Firefox/Safari
 * 15+/Edge) cargan el sprite una vez por sesión y reutilizan. Cero coste por
 * icono adicional. Para superficies que NO pueden referenciar externos
 * (emails, OG/share images con Satori), usar lib/icons.js (paths inline).
 *
 * Iconos disponibles:
 *   Oficios:        fontaneria, electricidad, carpinteria, mecanica,
 *                   hosteleria, peluqueria
 *   Acciones:       editar, copiar, descargar, compartir, ojo
 *   Estados:        tilde, reloj, candado
 *   Comunicación:   telefono, email
 */

const { esc } = require('./render.js');

const SIZES = new Set(['sm', 'md', 'default', 'lg', 'xl']);

const ICON_NAMES = [
  'fontaneria', 'electricidad', 'carpinteria', 'mecanica', 'hosteleria',
  'peluqueria',
  'editar', 'copiar', 'descargar', 'compartir', 'ojo',
  'tilde', 'reloj', 'candado',
  'telefono', 'email',
];

const ICON_NAMES_SET = new Set(ICON_NAMES);

const SPRITE_PATH = '/sprite.svg';

/**
 * @param {string} name                        Nombre del icono (kebab-case).
 * @param {Object} [opts]
 * @param {'sm'|'md'|'default'|'lg'|'xl'} [opts.size='default']
 * @param {string} [opts.className]            Clase adicional.
 * @param {string} [opts.title]                Si se pasa, el icono no es
 *                                             decorativo y se anuncia con
 *                                             aria-label en lugar de aria-hidden.
 * @returns {string} HTML del <svg>.
 * @throws {Error} si name no es válido.
 */
function renderIcon(name, opts = {}) {
  if (!ICON_NAMES_SET.has(name)) {
    throw new Error(
      `[icon-sprite] Unknown icon: "${name}". ` +
      `Available: ${ICON_NAMES.join(', ')}`
    );
  }

  const size = SIZES.has(opts.size) ? opts.size : 'default';
  const extra = opts.className ? ` ${esc(opts.className)}` : '';
  const accessibility = opts.title
    ? ` role="img" aria-label="${esc(opts.title)}"`
    : ' aria-hidden="true" focusable="false"';

  return `<svg class="pp-icon pp-icon--${size}${extra}"${accessibility}>`
    + `<use href="${SPRITE_PATH}#icon-${name}"/>`
    + `</svg>`;
}

/**
 * Lista los nombres canónicos de los iconos disponibles en el sprite.
 * @returns {string[]}
 */
function listIcons() {
  return ICON_NAMES.slice();
}

module.exports = { renderIcon, listIcons, SPRITE_PATH };
