import { describe, it, expect } from 'vitest';
import {
  DOC_KINDS,
  GENDERS,
  PAYMENT_CHOICES,
  isValidBirthDate,
  validateEnrollment,
} from '../netlify/functions/lib/enrollment.js';

const VALID = {
  nombre: 'Lucía Fernández',
  birth_date: '2014-03-20',
  tutor_legal_email: 'madre@example.com',
  tutor_legal_name: 'Ana Fernández',
  consent_data: true,
};

describe('isValidBirthDate', () => {
  it('acepta fechas reales en rango', () => {
    expect(isValidBirthDate('2014-03-20')).toBe(true);
    expect(isValidBirthDate('2000-12-31')).toBe(true);
  });
  it('rechaza formato/mes/día inválidos', () => {
    expect(isValidBirthDate('2014-13-01')).toBe(false);
    expect(isValidBirthDate('2014-02-30')).toBe(false);
    expect(isValidBirthDate('14-03-20')).toBe(false);
    expect(isValidBirthDate('2014/03/20')).toBe(false);
    expect(isValidBirthDate('')).toBe(false);
  });
  it('rechaza año fuera de rango', () => {
    expect(isValidBirthDate('1899-01-01')).toBe(false);
    expect(isValidBirthDate('2999-01-01')).toBe(false);
  });
});

describe('validateEnrollment · caso feliz', () => {
  it('normaliza el payload mínimo válido', () => {
    const { data, errors } = validateEnrollment(VALID);
    expect(errors).toEqual([]);
    expect(data.nombre).toBe('Lucía Fernández');
    expect(data.birth_date).toBe('2014-03-20');
    expect(data.tutor_legal.email).toBe('madre@example.com');
    expect(data.tutor_legal.name).toBe('Ana Fernández');
    expect(data.consent_data).toBe(true);
    expect(data.consent_image).toBe(false);
    expect(data.payment_choice).toBe('club'); // default
    expect(data.idioma).toBe('es');
  });

  it('limpia HTML del nombre y baja el email a minúsculas', () => {
    const { data } = validateEnrollment({ ...VALID, nombre: '<b>Leo</b> Pérez', tutor_legal_email: 'MADRE@Example.COM' });
    expect(data.nombre).toBe('Leo Pérez');
    expect(data.tutor_legal.email).toBe('madre@example.com');
  });

  it('acepta consentimiento como string "on"/"true"', () => {
    expect(validateEnrollment({ ...VALID, consent_data: 'on' }).errors).toEqual([]);
    expect(validateEnrollment({ ...VALID, consent_data: 'true', consent_image: 'on' }).data.consent_image).toBe(true);
  });
});

describe('validateEnrollment · validación', () => {
  it('exige nombre, fecha, email y nombre de tutor, y consentimiento de datos', () => {
    const { errors } = validateEnrollment({});
    expect(errors).toContain('nombre');
    expect(errors).toContain('birth_date');
    expect(errors).toContain('tutor_legal_email');
    expect(errors).toContain('tutor_legal_name');
    expect(errors).toContain('consent_data');
  });

  it('rechaza email de tutor inválido', () => {
    expect(validateEnrollment({ ...VALID, tutor_legal_email: 'no-email' }).errors).toContain('tutor_legal_email');
  });

  it('rechaza gender / doc_kind / payment_choice fuera de enum', () => {
    expect(validateEnrollment({ ...VALID, gender: 'Z' }).errors).toContain('gender');
    expect(validateEnrollment({ ...VALID, doc_kind: 'carnet' }).errors).toContain('doc_kind');
    expect(validateEnrollment({ ...VALID, payment_choice: 'cripto' }).errors).toContain('payment_choice');
  });

  it('consent_data ausente o falso es error', () => {
    expect(validateEnrollment({ ...VALID, consent_data: false }).errors).toContain('consent_data');
    const { consent_data, ...sinConsent } = VALID;
    expect(validateEnrollment(sinConsent).errors).toContain('consent_data');
  });
});

describe('validateEnrollment · tutor secundario y puente federativo', () => {
  it('incluye tutor secundario distinto', () => {
    const { data } = validateEnrollment({ ...VALID, tutor_secundario_email: 'padre@example.com', tutor_secundario_name: 'Juan' });
    expect(data.tutor_secundario).toMatchObject({ email: 'padre@example.com', name: 'Juan' });
  });

  it('ignora tutor secundario igual al legal', () => {
    const { data } = validateEnrollment({ ...VALID, tutor_secundario_email: 'madre@example.com' });
    expect(data.tutor_secundario).toBeNull();
  });

  it('persiste doc_kind/doc_number/nationality válidos', () => {
    const { data } = validateEnrollment({ ...VALID, doc_kind: 'libro_familia', doc_number: 'LF-123', nationality: 'Española' });
    expect(data.doc_kind).toBe('libro_familia');
    expect(data.doc_number).toBe('LF-123');
    expect(data.nationality).toBe('Española');
  });

  it('payment_choice online se respeta', () => {
    expect(validateEnrollment({ ...VALID, payment_choice: 'online' }).data.payment_choice).toBe('online');
  });
});

describe('enums exportados', () => {
  it('coinciden con el CHECK de la migración 037', () => {
    expect(DOC_KINDS).toEqual(['dni', 'nie', 'pasaporte', 'libro_familia']);
    expect(GENDERS).toEqual(['M', 'F', 'X']);
    expect(PAYMENT_CHOICES).toEqual(['online', 'club']);
  });
});
