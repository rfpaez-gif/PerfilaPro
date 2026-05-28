'use strict';

// Resolución de categoría deportiva a partir del año de nacimiento
// (migración 033 · sports_categories + cards.birth_year).
//
// El catálogo vive en la tabla sports_categories: cada fila tiene
// min/max_birth_year_offset RELATIVOS al año de inicio de temporada.
// Ejemplo fútbol, temporada 2025-26 (seasonStartYear = 2025):
//   prebenjamín  offset -7..-6  → nacidos 2018-2019
//   cadete       offset -15..-14 → nacidos 2010-2011
//   senior       offset -99..-19 → nacidos hasta 2006
//
// Así el catálogo es independiente del año: la misma fila sirve para
// todas las temporadas, sólo cambia el seasonStartYear que se le suma.

const SEASON_RE = /^(\d{4})(?:[-/]\d{2,4})?$/;

// La temporada española arranca en verano. Cutoff en julio (mes 7):
// de julio a diciembre la temporada es año-año+1; de enero a junio
// pertenece a la temporada que arrancó el verano anterior.
const SEASON_CUTOFF_MONTH = 7;

// Parsea 'YYYY', 'YYYY-YY', 'YYYY-YYYY' o 'YYYY/YY' → año de inicio
// (entero). null si no encaja.
function parseSeasonStartYear(season) {
  if (typeof season !== 'string') return null;
  const m = SEASON_RE.exec(season.trim());
  return m ? parseInt(m[1], 10) : null;
}

// Año de inicio de la temporada vigente para una fecha dada (default
// ahora). Julio→Diciembre 2025 y Enero→Junio 2026 devuelven ambos 2025.
function currentSeasonStartYear(date = new Date()) {
  const y = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12
  return month >= SEASON_CUTOFF_MONTH ? y : y - 1;
}

// Formatea un año de inicio como 'YYYY-YY' (ej. 2025 → '2025-26').
function formatSeason(startYear) {
  if (!Number.isInteger(startYear)) return null;
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${end}`;
}

// Dada la lista de categorías de un deporte, el año de nacimiento y el
// año de inicio de temporada, devuelve la categoría que le corresponde
// (o null si ninguna encaja / faltan offsets). Si varias solapasen
// (no debería con un catálogo bien definido), gana la de menor
// sort_order.
function categoryForBirthYear({ categories, birthYear, seasonStartYear }) {
  if (!Array.isArray(categories) || !Number.isInteger(birthYear)) return null;
  if (!Number.isInteger(seasonStartYear)) return null;

  const matches = categories.filter((c) => {
    if (c == null) return false;
    const min = c.min_birth_year_offset;
    const max = c.max_birth_year_offset;
    if (!Number.isInteger(min) || !Number.isInteger(max)) return false;
    return birthYear >= seasonStartYear + min && birthYear <= seasonStartYear + max;
  });

  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return matches[0];
}

// Carga el catálogo de un deporte ordenado por sort_order. Devuelve []
// ante error o deporte sin categorías (nunca lanza).
async function listSportsCategories(db, sport) {
  if (!sport) return [];
  const { data, error } = await db
    .from('sports_categories')
    .select('id, sport, code, display_name_es, display_name_ca, min_birth_year_offset, max_birth_year_offset, sort_order')
    .eq('sport', sport)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data;
}

module.exports = {
  SEASON_CUTOFF_MONTH,
  parseSeasonStartYear,
  currentSeasonStartYear,
  formatSeason,
  categoryForBirthYear,
  listSportsCategories,
};
