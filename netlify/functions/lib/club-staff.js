'use strict';

// CANTERA · cuerpo técnico con acceso al Studio del club (fase 1 CATORZE).
//
// Hasta ahora un club = un email = un admin: `panel-auth` buscaba el email
// en `organizations.email` y quien lo tuviera entraba con permisos totales.
// Eso basta para un despacho B2B, pero no para un club de cantera, donde la
// preparadora física, la fisio, la psicóloga y el docente necesitan entrar
// cada uno a ver LO SUYO — y sólo lo suyo.
//
// Este módulo es la parte pura de esa capa: catálogo de roles, validación,
// permisos y resolución del alcance por equipos. Sin acceso a BD, para que
// se pueda testear entero offline (tests/lib-club-staff.test.js).
//
// Modelo (migración 049):
//   org_admins       — la PERSONA: email + club + estado.
//   org_admin_roles  — la relación (persona, rol, equipo). Una persona puede
//                      tener varios roles, y un rol puede tener distinta
//                      persona según el equipo. `team_id NULL` = todos los
//                      equipos del club.
//
// El código del rol es un identificador INTERNO y cerrado: es lo que permite
// comparar entre clubes y ofrecer una matriz por defecto. La etiqueta que ve
// el club ("Mister físico") se añade en la fase 2 sin tocar estos códigos —
// mismo patrón que `club_teams` (competición del catálogo + label libre).

// `defaultScope` es sólo la sugerencia que ofrece el formulario de alta al
// elegir el rol; el alcance REAL sale siempre de las filas de
// org_admin_roles. Un club puede tener una fisio por equipo si quiere.
const STAFF_ROLES = [
  { code: 'direccion_deportiva', es: 'Dirección deportiva', defaultScope: 'club' },
  { code: 'coordinacion',        es: 'Coordinación',        defaultScope: 'club' },
  { code: 'entrenador',          es: 'Entrenador/a',        defaultScope: 'team' },
  { code: 'preparador',          es: 'Preparación física',  defaultScope: 'team' },
  { code: 'fisio',               es: 'Fisioterapia',        defaultScope: 'team' },
  { code: 'medico',              es: 'Servicio médico',     defaultScope: 'club' },
  { code: 'psicologia',          es: 'Psicología',          defaultScope: 'club' },
  { code: 'nutricion',           es: 'Nutrición',           defaultScope: 'club' },
  { code: 'aula_academica',      es: 'Aula académica',      defaultScope: 'club' },
  { code: 'analisis',            es: 'Análisis / vídeo',    defaultScope: 'club' },
  { code: 'delegado',            es: 'Delegado/a',          defaultScope: 'team' },
  { code: 'directiva',           es: 'Directiva',           defaultScope: 'club' },
];

const STAFF_ROLE_CODES = STAFF_ROLES.map((r) => r.code);

// Roles que ven el club entero por definición del cargo, tengan o no equipos
// asignados. No es un permiso de escritura: sólo alcance de lectura.
const CLUB_WIDE_ROLES = new Set(['direccion_deportiva', 'coordinacion', 'directiva']);

// Acciones de org-panel que un miembro del cuerpo técnico puede ejecutar.
// Fase 1 es deliberadamente SOLO LECTURA: el objetivo es "entra y ve lo
// suyo". El registro de obligaciones (que es escritura) llega en su fase,
// cuando exista qué registrar. Todo lo que no esté aquí devuelve 403 —
// lista blanca, no lista negra: si mañana se añade una acción nueva al
// panel, el cuerpo técnico NO la hereda por accidente.
const STAFF_ALLOWED_ACTIONS = new Set([
  'get_org',
  'get_roster',
  'get_club_stats',
  'teams_list',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidStaffRole(code) {
  return typeof code === 'string' && STAFF_ROLE_CODES.includes(code);
}

function staffRoleLabel(code) {
  const r = STAFF_ROLES.find((x) => x.code === code);
  return r ? r.es : code;
}

// Normaliza el email igual que panel-auth para que el lookup case.
// Devuelve '' si no es un email válido — el llamador decide qué hacer.
function normalizeStaffEmail(email) {
  const e = String(email == null ? '' : email).toLowerCase().trim();
  return EMAIL_RE.test(e) ? e : '';
}

function isValidTeamId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

function canStaffRun(action) {
  return STAFF_ALLOWED_ACTIONS.has(action);
}

// Alcance de lectura a partir de las filas de org_admin_roles.
//
//   { allTeams: true }            → ve todo el club
//   { allTeams: false, teamIds }  → ve sólo esos equipos
//
// Tres caminos a allTeams: un rol de club (dirección, coordinación,
// directiva), o una fila con team_id NULL (= "esta fisio cubre todo el
// club"). Sin filas, el alcance es vacío: la persona entra pero no ve
// jugadoras. Es intencionado — es más seguro que enseñar de más, y en el
// panel se traduce en un aviso de "pide que te asignen equipos".
function staffScope(roleRows) {
  const rows = Array.isArray(roleRows) ? roleRows : [];
  const roles = [];
  const teamIds = new Set();
  let allTeams = false;

  for (const row of rows) {
    if (!row || !isValidStaffRole(row.role_code)) continue;
    if (!roles.includes(row.role_code)) roles.push(row.role_code);
    if (CLUB_WIDE_ROLES.has(row.role_code)) { allTeams = true; continue; }
    if (row.team_id == null) { allTeams = true; continue; }
    if (isValidTeamId(row.team_id)) teamIds.add(row.team_id);
  }

  return {
    roles,
    allTeams,
    teamIds: allTeams ? [] : [...teamIds],
  };
}

// Recorta la respuesta de get_roster al alcance del cuerpo técnico.
//
// Se filtra la RESPUESTA en vez de la query a propósito: getRoster es la
// función que ya usa la dueña del club y no queremos tocarla (ni arriesgar
// a romperle el panel) para añadir un caso que sólo aplica al cuerpo
// técnico. Todo el recorte vive aquí, en un sitio, y es testeable con un
// objeto plano.
function filterRosterForScope(payload, scope) {
  if (!payload || !scope || scope.allTeams) return payload;
  const allowed = new Set(scope.teamIds || []);

  const categories = (payload.categories || [])
    .map((cat) => ({
      ...cat,
      members: (cat.members || []).filter((m) => m.team_id && allowed.has(m.team_id)),
    }))
    .filter((cat) => cat.members.length > 0);

  const teams = (payload.teams || []).filter((t) => allowed.has(t.id));
  const players = categories.reduce((n, c) => n + c.members.length, 0);

  // El cuerpo técnico no ve la lista del resto de técnicos del club: es su
  // panel de trabajo, no un directorio de personal.
  return {
    ...payload,
    categories,
    teams,
    staff: [],
    totals: {
      ...(payload.totals || {}),
      players,
      staff: 0,
      paying: categories.reduce(
        (n, c) => n + c.members.filter((m) => m.payment && m.payment.paid).length, 0),
      unpaid: players - categories.reduce(
        (n, c) => n + c.members.filter((m) => m.payment && m.payment.paid).length, 0),
      carnet_ready: categories.reduce(
        (n, c) => n + c.members.filter((m) => m.carnet_ready).length, 0),
    },
    scope: { all_teams: false, team_ids: [...allowed] },
  };
}

module.exports = {
  STAFF_ROLES,
  STAFF_ROLE_CODES,
  CLUB_WIDE_ROLES,
  STAFF_ALLOWED_ACTIONS,
  isValidStaffRole,
  staffRoleLabel,
  normalizeStaffEmail,
  isValidTeamId,
  canStaffRun,
  staffScope,
  filterRosterForScope,
};
