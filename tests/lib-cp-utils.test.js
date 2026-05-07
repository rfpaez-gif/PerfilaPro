'use strict';

import { describe, it, expect, vi } from 'vitest';
import { normalizeCp, isValidCp, lookupCp } from '../netlify/functions/lib/cp-utils.js';

describe('normalizeCp', () => {
  it('devuelve null para input vacío', () => {
    expect(normalizeCp('')).toBeNull();
    expect(normalizeCp(null)).toBeNull();
    expect(normalizeCp(undefined)).toBeNull();
  });

  it('mantiene CP de 5 dígitos tal cual', () => {
    expect(normalizeCp('28820')).toBe('28820');
    expect(normalizeCp('08001')).toBe('08001');
  });

  it('rellena con ceros a la izquierda hasta 5 dígitos', () => {
    expect(normalizeCp('1193')).toBe('01193');  // Álava
    expect(normalizeCp('3690')).toBe('03690');  // Alicante
    expect(normalizeCp('123')).toBe('00123');
  });

  it('limpia espacios al inicio/fin', () => {
    expect(normalizeCp('  28001  ')).toBe('28001');
  });

  it('rechaza input no numérico', () => {
    expect(normalizeCp('28A20')).toBeNull();
    expect(normalizeCp('abc')).toBeNull();
    expect(normalizeCp('28-01')).toBeNull();
  });

  it('rechaza más de 5 dígitos', () => {
    expect(normalizeCp('288201')).toBeNull();
  });
});

describe('isValidCp', () => {
  it('acepta prefijos válidos 01-52', () => {
    expect(isValidCp('01193')).toBe(true);  // Álava
    expect(isValidCp('28001')).toBe(true);  // Madrid
    expect(isValidCp('51001')).toBe(true);  // Ceuta
    expect(isValidCp('52001')).toBe(true);  // Melilla
  });

  it('rechaza prefijo 00', () => {
    expect(isValidCp('00100')).toBe(false);
  });

  it('rechaza prefijos > 52', () => {
    expect(isValidCp('53001')).toBe(false);
    expect(isValidCp('99999')).toBe(false);
  });

  it('acepta entrada con padding implícito (1193 → 01193 válido)', () => {
    expect(isValidCp('1193')).toBe(true);
  });

  it('rechaza inputs no numéricos', () => {
    expect(isValidCp('abc')).toBe(false);
    expect(isValidCp('')).toBe(false);
    expect(isValidCp(null)).toBe(false);
  });
});

describe('lookupCp', () => {
  function makeDb(row) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: row }),
          })),
        })),
      })),
    };
  }

  it('devuelve null para CP inválido sin tocar la BD', async () => {
    const db = makeDb(null);
    const result = await lookupCp(db, 'invalido');
    expect(result).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('devuelve null para CP fuera de rango (53xxx)', async () => {
    const db = makeDb(null);
    const result = await lookupCp(db, '53000');
    expect(result).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('hace lookup con CP normalizado (pad-left)', async () => {
    const expected = { cp: '01193', municipality_name: 'Alegría-Dulantzi', province_slug: 'vitoria' };
    const db = makeDb(expected);
    const result = await lookupCp(db, '1193');
    expect(result).toEqual(expected);
    expect(db.from).toHaveBeenCalledWith('postal_codes');
  });

  it('devuelve null si la BD no encuentra la fila', async () => {
    const db = makeDb(null);
    const result = await lookupCp(db, '28820');
    expect(result).toBeNull();
  });
});
