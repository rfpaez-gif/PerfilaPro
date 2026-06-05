'use strict';

// Encuadre del club (capa I5 · docs/cantera-inscripcion-temporada.md §6).
//
// Tras la avalancha de inscripciones, el club asigna equipo + dorsal (y
// opcionalmente posición/categoría) a cada jugador, en lote, desde la
// bandeja agrupada por categoría (get_roster ya la pinta). Este lib es
// PURO: valida/normaliza cada fila de asignación y devuelve el patch a
// aplicar sobre member_club_seasons. La escritura la hace org-panel
// (enrollment_assign), una fila por jugador, scoped al club del JWT.

const SLUG_RE = /^p-[0-9a-f]{8}$/;

const { isValidTeamId } = require('./club-teams');

function stripTags(str) {
  return String(str == null ? '' : str).replace(/<[^>]*>/g, '').trim();
}

// Valida una fila de asignación. Devuelve { slug, patch, error }:
//   - slug: card_slug normalizado (clave del UPDATE).
//   - patch: objeto con SOLO los campos presentes (no pisa con null lo
//     que el club no tocó). Si el club manda dorsal=null explícito, sí
//     se limpia (caso "quitar dorsal").
//   - error: string si la fila es inválida (no se debe aplicar).
//
// Campos aceptados: dorsal (0-999 o null), team_name (≤80), position
// (≤40), category_id (uuid-ish ≤40 o null).
function buildAssignmentPatch(input) {
  const i = input || {};
  const slug = stripTags(i.card_slug);
  if (!SLUG_RE.test(slug)) return { slug: null, patch: null, error: 'card_slug inválido' };

  const patch = {};

  // dorsal: presente → number 0-999 o null para limpiar.
  if ('dorsal' in i) {
    if (i.dorsal === null || i.dorsal === '') {
      patch.dorsal = null;
    } else {
      const d = Number(i.dorsal);
      if (!Number.isInteger(d) || d < 0 || d > 999) {
        return { slug, patch: null, error: 'dorsal debe ser 0-999' };
      }
      patch.dorsal = d;
    }
  }

  // team_id: equipo gestionado (migración 040). uuid para asignar, null/''
  // para desasignar. La pertenencia del id al club la verifica org-panel
  // (enrollmentAssign) contra los equipos del club antes de aplicar.
  if ('team_id' in i) {
    if (i.team_id === null || i.team_id === '') {
      patch.team_id = null;
    } else if (isValidTeamId(i.team_id)) {
      patch.team_id = String(i.team_id).trim();
    } else {
      return { slug, patch: null, error: 'team_id inválido' };
    }
  }

  if ('team_name' in i) {
    patch.team_name = i.team_name ? stripTags(i.team_name).substring(0, 80) : null;
  }
  if ('position' in i) {
    patch.position = i.position ? stripTags(i.position).substring(0, 40) : null;
  }
  if ('category_id' in i) {
    patch.category_id = i.category_id ? stripTags(i.category_id).substring(0, 40) : null;
  }

  if (Object.keys(patch).length === 0) {
    return { slug, patch: null, error: 'nada para actualizar' };
  }
  return { slug, patch, error: null };
}

// Detecta dorsales duplicados dentro de un mismo equipo en el lote
// entrante. No bloquea (un club puede tener motivos), pero devuelve los
// conflictos para que la UI avise. clave = team_name||'' + '#' + dorsal.
function findDuplicateDorsals(rows) {
  const seen = new Map();
  const dups = [];
  for (const r of rows) {
    if (!r || r.patch == null || r.patch.dorsal == null) continue;
    // Dorsal único por equipo: preferimos el id de equipo gestionado; si
    // no lo hay, caemos al nombre libre (flujo legacy).
    const key = `${r.patch.team_id || r.patch.team_name || ''}#${r.patch.dorsal}`;
    if (seen.has(key)) dups.push({ team_name: r.patch.team_name || null, dorsal: r.patch.dorsal, slugs: [seen.get(key), r.slug] });
    else seen.set(key, r.slug);
  }
  return dups;
}

module.exports = {
  SLUG_RE,
  buildAssignmentPatch,
  findDuplicateDorsals,
};
