'use strict';

import { describe, it, expect } from 'vitest';
import { normalizeSpanishPhone } from '../netlify/functions/lib/phone-utils.js';

describe('normalizeSpanishPhone', () => {
  describe('inputs válidos', () => {
    it('acepta 9 dígitos sin prefijo (móvil 6)', () => {
      expect(normalizeSpanishPhone('612345678')).toEqual({
        ok: true, local: '612345678', e164: '34612345678',
      });
    });

    it('acepta 9 dígitos sin prefijo (móvil 7)', () => {
      expect(normalizeSpanishPhone('712345678').ok).toBe(true);
    });

    it('acepta 9 dígitos sin prefijo (fijo 9)', () => {
      expect(normalizeSpanishPhone('912345678').ok).toBe(true);
    });

    it('acepta input con espacios', () => {
      expect(normalizeSpanishPhone('612 345 678').e164).toBe('34612345678');
    });

    it('acepta input con guiones', () => {
      expect(normalizeSpanishPhone('612-345-678').e164).toBe('34612345678');
    });

    it('quita prefijo 34 con +', () => {
      expect(normalizeSpanishPhone('+34 612 345 678').e164).toBe('34612345678');
    });

    it('quita prefijo 34 sin +', () => {
      expect(normalizeSpanishPhone('34612345678').e164).toBe('34612345678');
    });

    it('quita prefijo 0034', () => {
      expect(normalizeSpanishPhone('0034612345678').e164).toBe('34612345678');
    });

    it('quita prefijo 0034 con espacios', () => {
      expect(normalizeSpanishPhone('00 34 612 345 678').e164).toBe('34612345678');
    });
  });

  describe('inputs inválidos', () => {
    it('rechaza null', () => {
      expect(normalizeSpanishPhone(null).ok).toBe(false);
    });

    it('rechaza undefined', () => {
      expect(normalizeSpanishPhone(undefined).ok).toBe(false);
    });

    it('rechaza string vacío', () => {
      expect(normalizeSpanishPhone('').ok).toBe(false);
    });

    it('rechaza solo espacios', () => {
      expect(normalizeSpanishPhone('   ').ok).toBe(false);
    });

    it('rechaza número de 9 dígitos que empieza por 1-5 (no es móvil ni fijo español)', () => {
      expect(normalizeSpanishPhone('123456789').ok).toBe(false);
      expect(normalizeSpanishPhone('346077832').ok).toBe(false); // ojo: este era el bug
    });

    it('rechaza número de menos de 9 dígitos', () => {
      expect(normalizeSpanishPhone('61234567').ok).toBe(false);
    });

    it('rechaza número de más de 9 dígitos sin prefijo válido', () => {
      expect(normalizeSpanishPhone('6123456789').ok).toBe(false);
    });

    it('rechaza prefijo internacional no español', () => {
      expect(normalizeSpanishPhone('+1 234 567 8900').ok).toBe(false);
    });

    it('devuelve error con motivo', () => {
      expect(normalizeSpanishPhone('123').error).toBe('phone_invalid_format');
      expect(normalizeSpanishPhone('').error).toBe('phone_required');
    });
  });

  describe('regresión del bug 343460...', () => {
    it('un teléfono que empieza por 34 con prefijo no se duplica', () => {
      // Caso real: usuario escribe +34 612 345 678
      const r = normalizeSpanishPhone('+34 612 345 678');
      expect(r.e164).toBe('34612345678');
      expect(r.e164.startsWith('3434')).toBe(false);
    });

    it('input ya prefijado no genera doble prefijo', () => {
      const r = normalizeSpanishPhone('34612345678');
      expect(r.e164).toBe('34612345678');
      expect(r.e164.length).toBe(11);
    });
  });
});
