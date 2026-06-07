'use strict';

// Regla "carnet listo" (sección ★ del handoff): un jugador es imprimible
// cuando tiene FOTO + EQUIPO + DORSAL. Antes de eso, el carnet saldría
// incompleto (hueco de foto, sin dorsal/equipo). La usa el roster del Studio
// (chip "carnet listo / falta…") y el filtro del lote de impresión.
//
// Solo aplica a jugadores: el cuerpo técnico (club_staff) no lleva dorsal.
//
// Devuelve { ready, missing } donde missing es la lista de lo que falta
// ('foto'|'equipo'|'dorsal'), [] si está listo. ready=false con missing=[]
// para no-jugadores (no aplica).

function carnetReadiness({ role, foto_url, team_id, team_name, dorsal } = {}) {
  if (role && role !== 'jugador') return { ready: false, missing: [] };
  const missing = [];
  if (!foto_url) missing.push('foto');
  if (!team_id && !team_name) missing.push('equipo');
  if (dorsal == null || dorsal === '') missing.push('dorsal');
  return { ready: missing.length === 0, missing };
}

function isCarnetReady(entry) {
  return carnetReadiness(entry).ready;
}

module.exports = { carnetReadiness, isCarnetReady };
