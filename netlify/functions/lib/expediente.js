'use strict';

// CANTERA · expediente de desarrollo integral: catálogo de módulos, matriz
// módulo×categoría y motor de hitos. Port del dominio de CATORZE
// (src/dominio/{catalogo,motor}.ts) a CommonJS, sin dependencias de BD para
// que se pueda testear entero offline.
//
// Qué es un módulo aquí: NO es contenido. Es un compromiso de registro
// periódico con un rol responsable y un ritmo que depende de la categoría.
// El motor lee (módulo × categoría) → periodicidad → y produce los hitos
// fechados de la temporada. Eso es todo lo que un módulo *hace*.
//
// Reparto de propiedad (decisión D-F):
//   - El CATÁLOGO de módulos es producto: global, lo mantiene el founder.
//     Si cada club inventa módulos se pierde la comparabilidad entre clubes.
//   - La MATRIZ (aplica + periodicidad + rol responsable por categoría) es
//     metodología del club: la edita el club. "Aula 14 no aplica a amateur"
//     no es un ajuste técnico, es cómo trabaja ese club.

const { STAFF_ROLE_CODES } = require('./club-staff');

// ── Periodicidades ───────────────────────────────────────────
//
// `por-evento` y `continua` NO generan obligaciones programadas: se
// registran cuando ocurren (una lesión) o no tienen hito (videoteca).
const PERIODICIDADES = [
  { code: 'alta',          es: 'Al alta' },
  { code: 'inicial-final', es: 'Inicial + final' },
  { code: 'trimestral',    es: 'Trimestral (inicial + intermedia + final)' },
  { code: 'mensual',       es: 'Mensual' },
  { code: 'por-evento',    es: 'Por evento' },
  { code: 'continua',      es: 'Continua' },
];

const PERIODICIDAD_CODES = PERIODICIDADES.map((p) => p.code);
const PERIODICIDADES_SIN_HITOS = new Set(['por-evento', 'continua']);

function isValidPeriodicidad(code) {
  return typeof code === 'string' && PERIODICIDAD_CODES.includes(code);
}

// ── Márgenes de las fechas límite ────────────────────────────
//
// El brief no los fijaba; son los de CATORZE y quedan aquí a la vista
// porque son la clase de número que un club real querrá discutir.
const MARGEN_ALTA_DIAS = 14;     // desde la incorporación
const MARGEN_INICIAL_DIAS = 30;  // desde el inicio efectivo
const MARGEN_FINAL_DIAS = 14;    // antes del cierre de temporada
const UMBRAL_AMBAR_DIAS = 14;    // semáforo ámbar

// ── Utilidades de fecha (ISO YYYY-MM-DD, UTC) ────────────────

function sumarDias(iso, dias) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desdeIso, hastaIso) {
  const a = new Date(desdeIso + 'T00:00:00Z').getTime();
  const b = new Date(hastaIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function finDeMes(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

// La temporada española arranca en verano. CANTERA ya usa cutoff julio en
// lib/sports-categories (`currentSeasonStartYear`); aquí se materializan las
// fechas concretas a partir de ese mismo año de inicio.
function seasonRange(startYear) {
  return { inicio: `${startYear}-07-01`, fin: `${startYear + 1}-06-30` };
}

// ── Hitos ────────────────────────────────────────────────────
//
// Devuelve [{ etiqueta, fechaLimite }] para una periodicidad dada.
//
// `desde` es el suelo de la generación y es lo que implementa la regla
// "activar un módulo genera hacia delante": si el club enciende un módulo en
// marzo, se pasa la fecha de activación y no se inventan los hitos que ya
// vencieron. Sin eso, activar a mitad de curso pintaría de golpe una
// obligación vencida por jugadora, que es la forma más rápida de que un club
// deje de mirar el tablero.
function hitosDe(periodicidad, temporada, fechaIncorporacion, desde) {
  if (PERIODICIDADES_SIN_HITOS.has(periodicidad)) return [];

  const inicioEfectivo = fechaIncorporacion > temporada.inicio
    ? fechaIncorporacion
    : temporada.inicio;

  let hitos;
  switch (periodicidad) {
    case 'alta':
      hitos = [{ etiqueta: 'Alta', fechaLimite: sumarDias(inicioEfectivo, MARGEN_ALTA_DIAS) }];
      break;
    case 'inicial-final':
      hitos = [
        { etiqueta: 'Evaluación inicial', fechaLimite: sumarDias(inicioEfectivo, MARGEN_INICIAL_DIAS) },
        { etiqueta: 'Evaluación final', fechaLimite: sumarDias(temporada.fin, -MARGEN_FINAL_DIAS) },
      ];
      break;
    case 'trimestral': {
      const mitad = sumarDias(
        temporada.inicio,
        Math.round(diasEntre(temporada.inicio, temporada.fin) / 2)
      );
      hitos = [
        { etiqueta: 'Evaluación inicial', fechaLimite: sumarDias(inicioEfectivo, MARGEN_INICIAL_DIAS) },
        { etiqueta: 'Evaluación intermedia', fechaLimite: mitad },
        { etiqueta: 'Evaluación final', fechaLimite: sumarDias(temporada.fin, -MARGEN_FINAL_DIAS) },
      ];
      break;
    }
    case 'mensual': {
      hitos = [];
      let cursor = finDeMes(inicioEfectivo);
      // Tope defensivo: una temporada son ~12 meses; si alguien mete fechas
      // absurdas no queremos un bucle que no termina.
      let guard = 0;
      while (cursor <= temporada.fin && guard++ < 24) {
        hitos.push({ etiqueta: `Registro mensual (${cursor.slice(0, 7)})`, fechaLimite: cursor });
        cursor = finDeMes(sumarDias(cursor, 1));
      }
      break;
    }
    default:
      return [];
  }

  return desde ? hitos.filter((h) => h.fechaLimite >= desde) : hitos;
}

// ── Proyección ───────────────────────────────────────────────
//
// Cuántas obligaciones generaría una selección de módulos, y a quién le
// caerían. Es lo que el club ve ANTES de confirmar el alta: activar los diez
// módulos con una sola responsable es legítimo, pero conviene que vea que
// eso son cientos de obligaciones para una persona antes de decir que sí.
//
// No toca BD: recibe la selección, las jugadoras (con su categoría) y el
// mapa rol→persona ya resueltos por el llamador.
function proyectarObligaciones({ seleccion, jugadoras, temporada, desde, responsablePorRol }) {
  const filas = Array.isArray(seleccion) ? seleccion.filter((s) => s && s.aplica) : [];
  const players = Array.isArray(jugadoras) ? jugadoras : [];
  const porRol = responsablePorRol || {};

  // Índice (modulo, categoria) → fila, para no recorrer la selección entera
  // por cada jugadora.
  const porCatModulo = new Map();
  for (const f of filas) {
    if (!isValidPeriodicidad(f.periodicidad)) continue;
    const key = `${f.category_id || ''}`;
    if (!porCatModulo.has(key)) porCatModulo.set(key, []);
    porCatModulo.get(key).push(f);
  }

  let total = 0;
  const porModulo = {};
  const porResponsable = {};
  let sinResponsable = 0;

  for (const j of players) {
    const filasCat = porCatModulo.get(`${j.category_id || ''}`) || [];
    for (const f of filasCat) {
      const n = hitosDe(f.periodicidad, temporada, j.joined_at || temporada.inicio, desde).length;
      if (!n) continue;
      total += n;
      porModulo[f.modulo_id] = (porModulo[f.modulo_id] || 0) + n;

      const persona = f.role_code ? porRol[f.role_code] : null;
      if (persona) porResponsable[persona] = (porResponsable[persona] || 0) + n;
      else sinResponsable += n;
    }
  }

  return {
    total,
    por_modulo: porModulo,
    por_responsable: porResponsable,
    sin_responsable: sinResponsable,
    jugadoras: players.length,
  };
}

// ── Validación de una fila de la matriz ──────────────────────
//
// Devuelve { row, error }: valida y normaliza sin tocar BD, mismo patrón que
// lib/external-payments.buildPaymentRow.
function buildMatrizRow(input, { moduloIds, categoryIds }) {
  const i = input || {};
  if (!moduloIds.includes(i.modulo_id)) {
    return { row: null, error: `Módulo no reconocido: ${i.modulo_id}` };
  }
  if (!categoryIds.includes(i.category_id)) {
    return { row: null, error: 'Categoría no reconocida' };
  }
  if (!isValidPeriodicidad(i.periodicidad)) {
    return { row: null, error: `Periodicidad no reconocida: ${i.periodicidad}` };
  }
  // El rol es opcional: un módulo puede activarse sin responsable asignado
  // todavía. Sus obligaciones caen en "sin responsable" y el tablero lo
  // enseña, que es mejor que impedir avanzar en el alta.
  if (i.role_code != null && i.role_code !== '' && !STAFF_ROLE_CODES.includes(i.role_code)) {
    return { row: null, error: `Rol no reconocido: ${i.role_code}` };
  }
  return {
    row: {
      modulo_id: i.modulo_id,
      category_id: i.category_id,
      aplica: i.aplica === true,
      periodicidad: i.periodicidad,
      role_code: i.role_code || null,
      variante_notas: String(i.variante_notas == null ? '' : i.variante_notas)
        .replace(/<[^>]*>/g, '').trim().slice(0, 300),
    },
    error: null,
  };
}

module.exports = {
  PERIODICIDADES,
  PERIODICIDAD_CODES,
  PERIODICIDADES_SIN_HITOS,
  MARGEN_ALTA_DIAS,
  MARGEN_INICIAL_DIAS,
  MARGEN_FINAL_DIAS,
  UMBRAL_AMBAR_DIAS,
  isValidPeriodicidad,
  sumarDias,
  diasEntre,
  finDeMes,
  seasonRange,
  hitosDe,
  proyectarObligaciones,
  buildMatrizRow,
};
