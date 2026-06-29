import { describe, it, expect } from 'vitest';
import {
  eurosToCents, centsToEuros, parseSpanishDate, slugify,
  normEstado, tipoSubastaFromId, normTipoBien, buildSubastaRow, cierraPronto,
} from '../netlify/functions/lib/inmo/subasta-model.js';

describe('inmo · subasta-model', () => {
  it('eurosToCents parsea formato español', () => {
    expect(eurosToCents('12.345,67 €')).toBe(1234567);
    expect(eurosToCents('1.000 €')).toBe(100000);
    expect(eurosToCents('950,50')).toBe(95050);
    expect(eurosToCents('')).toBeNull();
    expect(eurosToCents(null)).toBeNull();
    expect(eurosToCents(42.5)).toBe(4250);
  });

  it('centsToEuros formatea de vuelta', () => {
    expect(centsToEuros(1234567)).toBe('12.345,67 €');
    expect(centsToEuros(null)).toBeNull();
  });

  it('parseSpanishDate maneja fecha y fecha-hora', () => {
    expect(parseSpanishDate('10-06-2024 18:00:00')).toBe('2024-06-10T18:00:00.000Z');
    expect(parseSpanishDate('05/01/2025')).toBe('2025-01-05T00:00:00.000Z');
    expect(parseSpanishDate('texto')).toBeNull();
  });

  it('slugify deriva slug estable con lote', () => {
    expect(slugify('SUB-JA-2024-123456')).toBe('sub-ja-2024-123456');
    expect(slugify('SUB-JA-2024-123456', 2)).toBe('sub-ja-2024-123456-l2');
  });

  it('normaliza estado, tipo de subasta y tipo de bien', () => {
    expect(normEstado('Celebrándose')).toBe('abierta'); // subasta en curso = activa
    expect(normEstado('Concluida')).toBe('cerrada');
    expect(normEstado('Próxima apertura')).toBe('proxima');
    expect(normEstado('En plazo')).toBe('abierta');
    expect(tipoSubastaFromId('SUB-JA-2024-1')).toBe('judicial');
    expect(tipoSubastaFromId('SUB-AT-2024-1')).toBe('aeat');
    expect(normTipoBien('Vivienda unifamiliar')).toBe('vivienda');
    expect(normTipoBien('Plaza de garaje')).toBe('garaje');
    expect(normTipoBien('Finca rústica')).toBe('finca_rustica');
  });

  it('buildSubastaRow ensambla la fila con municipio costero', () => {
    const row = buildSubastaRow({
      idSubasta: 'SUB-JA-2024-111', lote: 1, estado: 'En plazo',
      tipoBien: 'Vivienda', localidad: 'Cambrils', provincia: 'Tarragona',
      valorSubasta: '120.000,00 €', deposito: '6.000 €',
      fechaFin: '20-07-2024 10:00:00', detalleUrl: 'https://x', fotos: ['u'],
    }, 'Cambrils');
    expect(row.id).toBe('SUB-JA-2024-111-L1');
    expect(row.slug).toBe('sub-ja-2024-111-l1');
    expect(row.municipio).toBe('Cambrils');
    expect(row.tipo_subasta).toBe('judicial');
    expect(row.tipo_bien).toBe('vivienda');
    expect(row.valor_subasta_cents).toBe(12000000);
    expect(row.deposito_cents).toBe(600000);
    expect(row.fotos).toEqual(['u']);
  });

  it('cierraPronto detecta ventana de cierre', () => {
    const now = new Date('2024-07-18T10:00:00Z');
    const abierta = { estado: 'abierta', fecha_fin: '2024-07-20T10:00:00.000Z' };
    const lejana = { estado: 'abierta', fecha_fin: '2024-08-20T10:00:00.000Z' };
    const cerrada = { estado: 'cerrada', fecha_fin: '2024-07-19T10:00:00.000Z' };
    expect(cierraPronto(abierta, 3, now)).toBe(true);
    expect(cierraPronto(lejana, 3, now)).toBe(false);
    expect(cierraPronto(cerrada, 3, now)).toBe(false);
  });
});
