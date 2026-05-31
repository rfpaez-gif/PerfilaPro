import { describe, it, expect } from 'vitest';
import { buildAssignmentPatch, findDuplicateDorsals } from '../netlify/functions/lib/enrollment-assign.js';

describe('buildAssignmentPatch', () => {
  it('slug inválido → error', () => {
    expect(buildAssignmentPatch({ card_slug: 'nope', dorsal: 10 }).error).toBeTruthy();
    expect(buildAssignmentPatch({ card_slug: 'p-123', dorsal: 10 }).error).toBeTruthy(); // hex corto
  });

  it('dorsal entero 0-999 ok; fuera de rango error', () => {
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: 10 }).patch).toEqual({ dorsal: 10 });
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: 0 }).patch).toEqual({ dorsal: 0 });
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: 1000 }).error).toBeTruthy();
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: 'x' }).error).toBeTruthy();
  });

  it('dorsal null/empty limpia el dorsal', () => {
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: null }).patch).toEqual({ dorsal: null });
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', dorsal: '' }).patch).toEqual({ dorsal: null });
  });

  it('solo incluye campos presentes (no pisa lo no enviado)', () => {
    const r = buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', team_name: 'Alevín A' });
    expect(r.patch).toEqual({ team_name: 'Alevín A' });
    expect(r.patch).not.toHaveProperty('dorsal');
  });

  it('limpia HTML y trunca team_name/position', () => {
    const r = buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', team_name: '<b>A</b>', position: 'DEL' });
    expect(r.patch.team_name).toBe('A');
    expect(r.patch.position).toBe('DEL');
  });

  it('team_name vacío → null', () => {
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa', team_name: '' }).patch).toEqual({ team_name: null });
  });

  it('sin ningún campo → error nada para actualizar', () => {
    expect(buildAssignmentPatch({ card_slug: 'p-aaaaaaaa' }).error).toMatch(/nada/);
  });
});

describe('findDuplicateDorsals', () => {
  const row = (slug, dorsal, team) => ({ slug, patch: { dorsal, team_name: team }, error: null });

  it('detecta mismo dorsal en mismo equipo', () => {
    const dups = findDuplicateDorsals([row('p-1', 10, 'A'), row('p-2', 10, 'A')]);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ dorsal: 10, team_name: 'A' });
  });

  it('mismo dorsal en equipos distintos NO es duplicado', () => {
    expect(findDuplicateDorsals([row('p-1', 10, 'A'), row('p-2', 10, 'B')])).toHaveLength(0);
  });

  it('ignora filas sin dorsal o con error', () => {
    expect(findDuplicateDorsals([row('p-1', null, 'A'), { slug: 'p-2', patch: null, error: 'x' }])).toHaveLength(0);
  });
});
