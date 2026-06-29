import { describe, it, expect } from 'vitest';
import municipios from '../netlify/functions/lib/inmo/municipios.js';

const { municipioCostero, esCostera, normalizeLoc } = municipios;

describe('inmo · municipios costa de Tarragona', () => {
  it('normaliza acentos, artículos y puntuación', () => {
    expect(normalizeLoc("L'Ametlla de Mar")).toBe('ametlla de mar');
    expect(normalizeLoc('SALOU')).toBe('salou');
    expect(normalizeLoc('Sant Carles de la Rápita')).toBe('sant carles de la rapita');
  });

  it('resuelve municipios costeros y sus variantes', () => {
    expect(municipioCostero('Cambrils')).toBe('Cambrils');
    expect(municipioCostero('CAMBRILS')).toBe('Cambrils');
    expect(municipioCostero("L'Ametlla de Mar")).toBe("L'Ametlla de Mar");
    expect(municipioCostero("AMETLLA DE MAR (L')")).toBe("L'Ametlla de Mar");
    expect(municipioCostero('Segur de Calafell')).toBe('Calafell');
    expect(municipioCostero('Tarragona')).toBe('Tarragona');
  });

  it('mapea pedanías/localidades costeras a su municipio', () => {
    expect(municipioCostero('Miami Platja')).toBe('Mont-roig del Camp');
    expect(municipioCostero('La Pineda')).toBe('Vila-seca');
    expect(municipioCostero('Coma-ruga')).toBe('El Vendrell');
    expect(municipioCostero('Les Cases d\'Alcanar')).toBe('Alcanar');
  });

  it('descarta municipios de interior (no costa)', () => {
    expect(municipioCostero('Reus')).toBeNull();
    expect(municipioCostero('Valls')).toBeNull();
    expect(municipioCostero('Tortosa')).toBeNull();
    expect(municipioCostero('Móra d\'Ebre')).toBeNull();
    expect(esCostera('Reus')).toBe(false);
    expect(esCostera('Salou')).toBe(true);
  });

  it('es robusto con entradas vacías', () => {
    expect(municipioCostero('')).toBeNull();
    expect(municipioCostero(null)).toBeNull();
    expect(municipioCostero(undefined)).toBeNull();
  });
});
