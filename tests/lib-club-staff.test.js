import { describe, it, expect } from 'vitest';
import {
  STAFF_ROLES,
  STAFF_ROLE_CODES,
  isValidStaffRole,
  staffRoleLabel,
  normalizeStaffEmail,
  isValidTeamId,
  canStaffRun,
  staffScope,
  filterRosterForScope,
} from '../netlify/functions/lib/club-staff.js';

const TEAM_A = '33333333-3333-3333-3333-333333333333';
const TEAM_B = '44444444-4444-4444-4444-444444444444';

describe('catálogo de roles', () => {
  it('los códigos del catálogo coinciden con el CHECK de la migración 049', () => {
    // Si alguien añade un rol aquí y no en el SQL, el INSERT reventará en
    // producción. Este test es el recordatorio de tocar los dos sitios.
    expect(STAFF_ROLE_CODES).toEqual([
      'direccion_deportiva', 'coordinacion', 'entrenador', 'preparador',
      'fisio', 'medico', 'psicologia', 'nutricion', 'aula_academica',
      'analisis', 'delegado', 'directiva',
    ]);
  });

  it('cada rol tiene etiqueta en castellano', () => {
    for (const r of STAFF_ROLES) expect(r.es.length).toBeGreaterThan(0);
  });

  it('isValidStaffRole rechaza inventados y no-strings', () => {
    expect(isValidStaffRole('fisio')).toBe(true);
    expect(isValidStaffRole('mister_fisico')).toBe(false);
    expect(isValidStaffRole(null)).toBe(false);
    expect(isValidStaffRole(undefined)).toBe(false);
    expect(isValidStaffRole(42)).toBe(false);
  });

  it('staffRoleLabel cae al propio código si no lo conoce', () => {
    expect(staffRoleLabel('fisio')).toBe('Fisioterapia');
    expect(staffRoleLabel('desconocido')).toBe('desconocido');
  });
});

describe('normalizeStaffEmail', () => {
  it('normaliza a minúsculas y recorta', () => {
    expect(normalizeStaffEmail('  Carmen@Example.ORG ')).toBe('carmen@example.org');
  });
  it('devuelve cadena vacía si no es email', () => {
    expect(normalizeStaffEmail('carmen')).toBe('');
    expect(normalizeStaffEmail('')).toBe('');
    expect(normalizeStaffEmail(null)).toBe('');
    expect(normalizeStaffEmail({})).toBe('');
  });
});

describe('isValidTeamId', () => {
  it('acepta uuid y rechaza el resto', () => {
    expect(isValidTeamId(TEAM_A)).toBe(true);
    expect(isValidTeamId('no-uuid')).toBe(false);
    expect(isValidTeamId(null)).toBe(false);
  });
});

describe('canStaffRun — lista blanca', () => {
  it('permite sólo las lecturas de la fase 1', () => {
    for (const a of ['get_org', 'get_roster', 'get_club_stats', 'teams_list']) {
      expect(canStaffRun(a)).toBe(true);
    }
  });

  it('bloquea toda escritura del panel', () => {
    for (const a of [
      'update_branding', 'invite_team', 'team_create', 'team_delete',
      'enrollment_open', 'enrollment_assign', 'update_payment_info',
      'offboard_member', 'download_team_cards',
    ]) {
      expect(canStaffRun(a)).toBe(false);
    }
  });

  it('bloquea acciones desconocidas (lista blanca, no negra)', () => {
    expect(canStaffRun('accion_futura_que_no_existe')).toBe(false);
    expect(canStaffRun(undefined)).toBe(false);
  });
});

describe('staffScope', () => {
  it('un rol de club ve todo aunque tenga equipos concretos asignados', () => {
    const s = staffScope([{ role_code: 'direccion_deportiva', team_id: TEAM_A }]);
    expect(s.allTeams).toBe(true);
    expect(s.roles).toEqual(['direccion_deportiva']);
  });

  it('team_id null significa todos los equipos del club', () => {
    expect(staffScope([{ role_code: 'fisio', team_id: null }]).allTeams).toBe(true);
  });

  it('acota a los equipos asignados', () => {
    const s = staffScope([
      { role_code: 'entrenador', team_id: TEAM_A },
      { role_code: 'preparador', team_id: TEAM_B },
    ]);
    expect(s.allTeams).toBe(false);
    expect(s.teamIds.sort()).toEqual([TEAM_A, TEAM_B].sort());
    expect(s.roles).toEqual(['entrenador', 'preparador']);
  });

  it('sin filas, el alcance es vacío — entra pero no ve jugadoras', () => {
    const s = staffScope([]);
    expect(s.allTeams).toBe(false);
    expect(s.teamIds).toEqual([]);
    expect(s.roles).toEqual([]);
  });

  it('ignora filas basura sin romperse', () => {
    const s = staffScope([null, { role_code: 'inventado', team_id: TEAM_A }, { role_code: 'entrenador', team_id: 'no-uuid' }]);
    expect(s.allTeams).toBe(false);
    expect(s.teamIds).toEqual([]);
  });

  it('no duplica roles ni equipos repetidos', () => {
    const s = staffScope([
      { role_code: 'entrenador', team_id: TEAM_A },
      { role_code: 'entrenador', team_id: TEAM_A },
    ]);
    expect(s.roles).toEqual(['entrenador']);
    expect(s.teamIds).toEqual([TEAM_A]);
  });

  it('acepta entrada no-array sin lanzar', () => {
    expect(staffScope(undefined).allTeams).toBe(false);
    expect(staffScope(null).teamIds).toEqual([]);
  });
});

describe('filterRosterForScope', () => {
  const payload = {
    ok: true,
    categories: [
      { category_id: 'c1', code: 'benjamin', members: [
        { slug: 'p-1', team_id: TEAM_A, carnet_ready: true, payment: { paid: true } },
        { slug: 'p-2', team_id: TEAM_B, carnet_ready: false, payment: { paid: false } },
      ] },
      { category_id: 'c2', code: 'juvenil', members: [
        { slug: 'p-3', team_id: TEAM_B, carnet_ready: true, payment: { paid: true } },
      ] },
    ],
    teams: [{ id: TEAM_A }, { id: TEAM_B }],
    staff: [{ slug: 's-1' }],
    totals: { players: 3, staff: 1, paying: 2, unpaid: 1, carnet_ready: 2 },
  };

  it('devuelve el payload intacto si el alcance es todo el club', () => {
    expect(filterRosterForScope(payload, { allTeams: true })).toBe(payload);
  });

  it('deja sólo las jugadoras de sus equipos', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [TEAM_A] });
    const slugs = out.categories.flatMap((c) => c.members.map((m) => m.slug));
    expect(slugs).toEqual(['p-1']);
  });

  it('descarta categorías que se quedan sin jugadoras', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [TEAM_A] });
    expect(out.categories.map((c) => c.code)).toEqual(['benjamin']);
  });

  it('recalcula los totales — no arrastra los del club entero', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [TEAM_A] });
    expect(out.totals.players).toBe(1);
    expect(out.totals.paying).toBe(1);
    expect(out.totals.unpaid).toBe(0);
    expect(out.totals.carnet_ready).toBe(1);
  });

  it('no expone el listado del resto del cuerpo técnico', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [TEAM_A] });
    expect(out.staff).toEqual([]);
    expect(out.totals.staff).toBe(0);
  });

  it('recorta también la lista de equipos', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [TEAM_A] });
    expect(out.teams).toEqual([{ id: TEAM_A }]);
  });

  it('alcance vacío deja el roster vacío, no el club entero', () => {
    const out = filterRosterForScope(payload, { allTeams: false, teamIds: [] });
    expect(out.categories).toEqual([]);
    expect(out.totals.players).toBe(0);
  });

  it('una jugadora sin equipo no se cuela por alcance acotado', () => {
    const sinEquipo = { ...payload, categories: [
      { category_id: 'c1', members: [{ slug: 'p-9', team_id: null }] },
    ] };
    const out = filterRosterForScope(sinEquipo, { allTeams: false, teamIds: [TEAM_A] });
    expect(out.categories).toEqual([]);
  });
});
