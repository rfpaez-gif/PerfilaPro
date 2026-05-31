import { describe, it, expect } from 'vitest';
import {
  buildInviteRow,
  validateInviteList,
  buildEnrollInviteEmail,
} from '../netlify/functions/lib/enrollment-invite.js';

describe('buildInviteRow', () => {
  it('email válido, nombre opcional', () => {
    expect(buildInviteRow({ email: 'A@B.com', nombre: ' Ana ' })).toEqual({ row: { email: 'a@b.com', nombre: 'Ana' }, error: null });
    expect(buildInviteRow({ email: 'x@y.es' }).row).toEqual({ email: 'x@y.es', nombre: null });
  });
  it('email inválido → error', () => {
    expect(buildInviteRow({ email: 'nope' }).error).toBeTruthy();
    expect(buildInviteRow({}).error).toBeTruthy();
  });
  it('limpia HTML del nombre', () => {
    expect(buildInviteRow({ email: 'a@b.com', nombre: '<b>Leo</b>' }).row.nombre).toBe('Leo');
  });
});

describe('validateInviteList', () => {
  it('separa válidos de inválidos y deduplica por email', () => {
    const { rows, errors } = validateInviteList([
      { email: 'a@b.com', nombre: 'Ana' },
      { email: 'malo' },
      { email: 'A@B.com' }, // duplicado (case-insensitive)
      { email: 'c@d.es' },
    ]);
    expect(rows.map(r => r.email)).toEqual(['a@b.com', 'c@d.es']);
    expect(errors).toHaveLength(2);
    expect(errors.some(e => /duplicado/.test(e.error))).toBe(true);
  });
  it('no-array → error de lista', () => {
    expect(validateInviteList('x').errors[0].error).toMatch(/array/);
  });
  it('lista vacía → sin filas ni errores', () => {
    expect(validateInviteList([])).toEqual({ rows: [], errors: [] });
  });
});

describe('buildEnrollInviteEmail', () => {
  it('incluye el enlace de la campaña y el nombre del club', () => {
    const { subject, html } = buildEnrollInviteEmail({ clubName: 'EF Universal', nombre: 'Ana', enrollUrl: 'https://pp.es/es/inscripcion/tok123', idioma: 'es' });
    expect(subject).toContain('EF Universal');
    expect(html).toContain('https://pp.es/es/inscripcion/tok123');
    expect(html).toContain('Ana');
  });
  it('catalán traduce el CTA', () => {
    const { html } = buildEnrollInviteEmail({ clubName: 'CF X', enrollUrl: 'https://pp.es/ca/inscripcion/t', idioma: 'ca' });
    expect(html).toContain('Inscriure el meu fill/a');
  });
  it('sin nombre no rompe el saludo', () => {
    const { html } = buildEnrollInviteEmail({ clubName: 'CF X', enrollUrl: 'https://pp.es/es/inscripcion/t' });
    expect(html).toContain('CF X');
  });
});
