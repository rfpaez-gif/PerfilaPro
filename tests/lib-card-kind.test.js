import { describe, it, expect } from 'vitest';
import {
  CARD_KINDS,
  isValidCardKind,
  cardKindOf,
  isAutonomo,
  isPlayer,
  isClubStaff,
  isClubMember,
} from '../netlify/functions/lib/card-kind.js';

describe('isValidCardKind', () => {
  it('acepta los tres kinds', () => {
    expect(isValidCardKind('autonomo')).toBe(true);
    expect(isValidCardKind('player')).toBe(true);
    expect(isValidCardKind('club_staff')).toBe(true);
  });
  it('rechaza desconocidos y no-string', () => {
    expect(isValidCardKind('jugador')).toBe(false);
    expect(isValidCardKind('')).toBe(false);
    expect(isValidCardKind(null)).toBe(false);
    expect(isValidCardKind(undefined)).toBe(false);
  });
});

describe('cardKindOf · default autónomo', () => {
  it('undefined/null/"" → autonomo (default de BD)', () => {
    expect(cardKindOf({})).toBe('autonomo');
    expect(cardKindOf({ card_kind: null })).toBe('autonomo');
    expect(cardKindOf({ card_kind: '' })).toBe('autonomo');
    expect(cardKindOf(null)).toBe('autonomo');
  });
  it('devuelve el kind explícito tal cual', () => {
    expect(cardKindOf({ card_kind: 'player' })).toBe('player');
    expect(cardKindOf({ card_kind: 'club_staff' })).toBe('club_staff');
  });
});

describe('guards por tipo', () => {
  const player = { card_kind: 'player' };
  const staff = { card_kind: 'club_staff' };
  const legacy = {}; // sin card_kind → autónomo

  it('isAutonomo trata la card legacy como autónomo', () => {
    expect(isAutonomo(legacy)).toBe(true);
    expect(isAutonomo(player)).toBe(false);
  });
  it('isPlayer / isClubStaff discriminan', () => {
    expect(isPlayer(player)).toBe(true);
    expect(isPlayer(staff)).toBe(false);
    expect(isClubStaff(staff)).toBe(true);
    expect(isClubStaff(player)).toBe(false);
  });
  it('isClubMember cubre player + club_staff, no autónomo', () => {
    expect(isClubMember(player)).toBe(true);
    expect(isClubMember(staff)).toBe(true);
    expect(isClubMember(legacy)).toBe(false);
  });
});

describe('CARD_KINDS constante', () => {
  it('está congelada', () => {
    expect(Object.isFrozen(CARD_KINDS)).toBe(true);
    expect(CARD_KINDS.AUTONOMO).toBe('autonomo');
  });
});
