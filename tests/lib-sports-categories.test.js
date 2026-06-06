import { describe, it, expect, vi } from 'vitest';
import {
  parseSeasonStartYear,
  currentSeasonStartYear,
  formatSeason,
  categoryForBirthYear,
  listSportsCategories,
} from '../netlify/functions/lib/sports-categories.js';

// Seed de fútbol de la migración 033 (offsets relativos al año de temporada).
const FUTBOL = [
  { code: 'prebenjamin', min_birth_year_offset: -7,  max_birth_year_offset: -6,  sort_order: 10 },
  { code: 'benjamin',    min_birth_year_offset: -9,  max_birth_year_offset: -8,  sort_order: 20 },
  { code: 'alevin',      min_birth_year_offset: -11, max_birth_year_offset: -10, sort_order: 30 },
  { code: 'infantil',    min_birth_year_offset: -13, max_birth_year_offset: -12, sort_order: 40 },
  { code: 'cadete',      min_birth_year_offset: -15, max_birth_year_offset: -14, sort_order: 50 },
  { code: 'juvenil',     min_birth_year_offset: -18, max_birth_year_offset: -16, sort_order: 60 },
  { code: 'senior',      min_birth_year_offset: -99, max_birth_year_offset: -19, sort_order: 70 },
];

describe('parseSeasonStartYear', () => {
  it('acepta varios formatos', () => {
    expect(parseSeasonStartYear('2025')).toBe(2025);
    expect(parseSeasonStartYear('2025-26')).toBe(2025);
    expect(parseSeasonStartYear('2025/26')).toBe(2025);
    expect(parseSeasonStartYear('2025-2026')).toBe(2025);
  });
  it('null con basura', () => {
    expect(parseSeasonStartYear('temporada')).toBeNull();
    expect(parseSeasonStartYear(null)).toBeNull();
  });
});

describe('currentSeasonStartYear · cutoff junio', () => {
  it('agosto 2025 → 2025', () => {
    expect(currentSeasonStartYear(new Date('2025-08-15T00:00:00Z'))).toBe(2025);
  });
  it('marzo 2026 → 2025 (misma temporada)', () => {
    expect(currentSeasonStartYear(new Date('2026-03-01T00:00:00Z'))).toBe(2025);
  });
  it('junio es el corte (inclusive): el club ya trabaja la temporada nueva', () => {
    expect(currentSeasonStartYear(new Date('2026-06-01T00:00:00Z'))).toBe(2026);
    expect(currentSeasonStartYear(new Date('2026-06-06T00:00:00Z'))).toBe(2026);
    expect(currentSeasonStartYear(new Date('2026-05-31T00:00:00Z'))).toBe(2025);
  });
});

describe('formatSeason', () => {
  it('2025 → 2025-26', () => {
    expect(formatSeason(2025)).toBe('2025-26');
    expect(formatSeason(2009)).toBe('2009-10');
  });
  it('null si no es entero', () => {
    expect(formatSeason('2025')).toBeNull();
  });
});

describe('categoryForBirthYear · temporada 2025-26', () => {
  const season = 2025;
  const pick = (birthYear) =>
    (categoryForBirthYear({ categories: FUTBOL, birthYear, seasonStartYear: season }) || {}).code;

  it('asigna las categorías del seed correctamente', () => {
    expect(pick(2018)).toBe('prebenjamin'); // 2025-7
    expect(pick(2016)).toBe('benjamin');    // 2025-9
    expect(pick(2014)).toBe('alevin');      // 2025-11
    expect(pick(2012)).toBe('infantil');    // 2025-13
    expect(pick(2010)).toBe('cadete');      // 2025-15
    expect(pick(2008)).toBe('juvenil');     // 2025-17
    expect(pick(2000)).toBe('senior');      // <= 2006
  });

  it('null si el año no encaja en ninguna (demasiado joven)', () => {
    expect(categoryForBirthYear({ categories: FUTBOL, birthYear: 2024, seasonStartYear: season })).toBeNull();
  });

  it('rechaza inputs inválidos', () => {
    expect(categoryForBirthYear({ categories: null, birthYear: 2012, seasonStartYear: 2025 })).toBeNull();
    expect(categoryForBirthYear({ categories: FUTBOL, birthYear: '2012', seasonStartYear: 2025 })).toBeNull();
    expect(categoryForBirthYear({ categories: FUTBOL, birthYear: 2012, seasonStartYear: null })).toBeNull();
  });

  it('con solapamiento gana el menor sort_order', () => {
    const overlap = [
      { code: 'b', min_birth_year_offset: -10, max_birth_year_offset: -10, sort_order: 20 },
      { code: 'a', min_birth_year_offset: -10, max_birth_year_offset: -10, sort_order: 10 },
    ];
    expect(categoryForBirthYear({ categories: overlap, birthYear: 2015, seasonStartYear: 2025 }).code).toBe('a');
  });
});

describe('listSportsCategories', () => {
  function makeDb(result) {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue(result),
    };
    return { from: vi.fn(() => ({ select: vi.fn(() => chain) })) };
  }

  it('devuelve las filas en éxito', async () => {
    const db = makeDb({ data: FUTBOL, error: null });
    const out = await listSportsCategories(db, 'futbol');
    expect(out).toHaveLength(7);
  });
  it('devuelve [] ante error o sport vacío', async () => {
    expect(await listSportsCategories(makeDb({ data: null, error: { message: 'x' } }), 'futbol')).toEqual([]);
    expect(await listSportsCategories(makeDb({ data: null, error: null }), '')).toEqual([]);
  });
});
