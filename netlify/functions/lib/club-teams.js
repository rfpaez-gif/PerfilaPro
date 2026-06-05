'use strict';

// Equipos gestionados del club (CANTERA · migración 040). Helpers PUROS
// (sin BD): validan/normalizan el nombre, el color y el id de equipo que
// llegan del panel del coordinador. La escritura vive en org-panel
// (acciones team_*); aquí sólo decisiones deterministas y testeables.

const { isValidHex } = require('./org-utils');

const TEAM_NAME_MAX = 60;
const TEAM_LABEL_MAX = 8;
// uuid v4-ish; vale para validar team_id/category_id que llegan del front.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripTags(str) {
  return String(str == null ? '' : str).replace(/<[^>]*>/g, '').trim();
}

// Nombre del equipo: 1..TEAM_NAME_MAX, sin tags. { value, error }.
function normalizeTeamName(input) {
  const name = stripTags(input);
  if (!name) return { value: null, error: 'El nombre del equipo es obligatorio' };
  if (name.length > TEAM_NAME_MAX) return { value: null, error: `El nombre no puede superar ${TEAM_NAME_MAX} caracteres` };
  return { value: name, error: null };
}

// Color opcional: null/'' → null; si viene, debe ser #RRGGBB. { value, error }.
function normalizeTeamColor(input) {
  if (input == null || input === '') return { value: null, error: null };
  const c = stripTags(input);
  if (!isValidHex(c)) return { value: null, error: 'El color debe ser #RRGGBB' };
  return { value: c, error: null };
}

function isValidTeamId(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

// Sufijo opcional A/B para dos equipos en la misma competición. ≤8 chars,
// sin tags. null/'' → null. { value, error }.
function normalizeTeamLabel(input) {
  if (input == null || input === '') return { value: null, error: null };
  const label = stripTags(input);
  if (!label) return { value: null, error: null };
  if (label.length > TEAM_LABEL_MAX) return { value: null, error: `La etiqueta no puede superar ${TEAM_LABEL_MAX} caracteres` };
  return { value: label, error: null };
}

module.exports = {
  TEAM_NAME_MAX,
  TEAM_LABEL_MAX,
  UUID_RE,
  normalizeTeamName,
  normalizeTeamColor,
  normalizeTeamLabel,
  isValidTeamId,
};
