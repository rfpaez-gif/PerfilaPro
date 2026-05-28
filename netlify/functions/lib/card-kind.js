'use strict';

// Discriminador de tipo de card (migración 033 · cards.card_kind).
//
//   'autonomo'   = profesional individual (carril legacy). Default en
//                  BD, así que una card sin card_kind explícito ES
//                  autónomo — los helpers tratan undefined/null igual.
//   'player'     = jugador de un club deportivo (menor o adulto).
//   'club_staff' = entrenador/delegado/médico/directivo del club.
//
// El carril autónomo y el B2B genérico nunca tocan player/club_staff,
// así que estos guards son el filtro que usan card.js, edit-card.js y
// los endpoints Cantera para ramificar comportamiento (visibilidad
// pública, multi-admin, PII del menor) sin colarse en el carril legacy.

const CARD_KINDS = Object.freeze({
  AUTONOMO: 'autonomo',
  PLAYER: 'player',
  CLUB_STAFF: 'club_staff',
});

const VALID_KINDS = Object.freeze([
  CARD_KINDS.AUTONOMO,
  CARD_KINDS.PLAYER,
  CARD_KINDS.CLUB_STAFF,
]);

function isValidCardKind(kind) {
  return VALID_KINDS.includes(kind);
}

// Normaliza: undefined/null/'' → 'autonomo' (default de BD). Un valor
// desconocido se devuelve tal cual para que isValidCardKind lo cace.
function cardKindOf(card) {
  const k = card && card.card_kind;
  return k == null || k === '' ? CARD_KINDS.AUTONOMO : k;
}

function isAutonomo(card) {
  return cardKindOf(card) === CARD_KINDS.AUTONOMO;
}

function isPlayer(card) {
  return cardKindOf(card) === CARD_KINDS.PLAYER;
}

function isClubStaff(card) {
  return cardKindOf(card) === CARD_KINDS.CLUB_STAFF;
}

// player y club_staff son las cards que viven dentro de un club. Útil
// para el Studio deportivo y los guards de panel padre/club.
function isClubMember(card) {
  return isPlayer(card) || isClubStaff(card);
}

module.exports = {
  CARD_KINDS,
  VALID_KINDS,
  isValidCardKind,
  cardKindOf,
  isAutonomo,
  isPlayer,
  isClubStaff,
  isClubMember,
};
