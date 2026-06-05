import { describe, it, expect } from 'vitest';
import { normalizeTeamName, normalizeTeamColor, isValidTeamId, TEAM_NAME_MAX } from '../netlify/functions/lib/club-teams.js';

describe('club-teams · normalizeTeamName', () => {
  it('vacío → error', () => {
    expect(normalizeTeamName('').error).toBeTruthy();
    expect(normalizeTeamName('   ').error).toBeTruthy();
    expect(normalizeTeamName(null).error).toBeTruthy();
  });
  it('limpia tags y recorta', () => {
    expect(normalizeTeamName('  <b>Cadete A</b> ').value).toBe('Cadete A');
  });
  it('máximo de longitud', () => {
    expect(normalizeTeamName('x'.repeat(TEAM_NAME_MAX)).error).toBeNull();
    expect(normalizeTeamName('x'.repeat(TEAM_NAME_MAX + 1)).error).toBeTruthy();
  });
});

describe('club-teams · normalizeTeamColor', () => {
  it('vacío → null sin error', () => {
    expect(normalizeTeamColor('')).toEqual({ value: null, error: null });
    expect(normalizeTeamColor(null)).toEqual({ value: null, error: null });
  });
  it('hex válido pasa, inválido error', () => {
    expect(normalizeTeamColor('#00C277').value).toBe('#00C277');
    expect(normalizeTeamColor('rojo').error).toBeTruthy();
    expect(normalizeTeamColor('#FFF').error).toBeTruthy();
  });
});

describe('club-teams · isValidTeamId', () => {
  it('uuid v4-ish ok', () => {
    expect(isValidTeamId('33333333-3333-4333-8333-333333333333')).toBe(true);
  });
  it('no uuid → false', () => {
    expect(isValidTeamId('cat-ale')).toBe(false);
    expect(isValidTeamId('')).toBe(false);
    expect(isValidTeamId(null)).toBe(false);
  });
});
