'use strict';

// CANTERA · alta autoservicio del club: declara su estructura (roles y
// personas) y activa los módulos del expediente que use.
//
// Fase 2 de la fusión CATORZE → CANTERA. Invierte el orden que traía
// CATORZE: allí el módulo llevaba el rol clavado ("Perfil físico → siempre
// preparación física"), lo que en un club sin preparador dejaba todas esas
// obligaciones cayendo en dirección deportiva. Aquí el club declara primero
// SU estructura y los módulos se cuelgan de ella.
//
// Vive en un lib y no dentro de org-panel.js porque org-panel ya pasa de
// 1.800 líneas, y porque las acciones de cuerpo técnico las comparten el
// club (self-serve) y el founder (admin-orgs): una sola implementación.
//
// Cada función devuelve { status, body } en plano; el formateo HTTP lo pone
// el llamador con su propio jsonResponse.

const {
  STAFF_ROLES,
  STAFF_ROLE_CODES,
  isValidStaffRole,
  normalizeStaffEmail,
  isValidTeamId,
} = require('./club-staff');
const {
  PERIODICIDADES,
  buildMatrizRow,
  proyectarObligaciones,
  seasonRange,
} = require('./expediente');
const { currentSeasonStartYear } = require('./sports-categories');

function ok(body) { return { status: 200, body: { ok: true, ...body } }; }
function fail(status, error) { return { status, body: { error } }; }

function cleanLabel(v, max) {
  const s = String(v == null ? '' : v).replace(/<[^>]*>/g, '').trim();
  return s ? s.slice(0, max) : null;
}

// ── Estructura: roles declarados + personas + equipos ─────────

async function getStructure(db, org) {
  const { data: roles, error: rolesErr } = await db
    .from('org_roles')
    .select('id, role_code, label, sort_order')
    .eq('organization_id', org.id)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (rolesErr) return fail(500, rolesErr.message);

  const { data: people, error: peopleErr } = await db
    .from('org_admins')
    .select('id, email, name, invited_at, last_login_at, revoked_at')
    .eq('organization_id', org.id)
    .order('invited_at', { ascending: true });
  if (peopleErr) return fail(500, peopleErr.message);

  const list = Array.isArray(people) ? people : [];
  const ids = list.map((p) => p.id);
  const rolesByPerson = new Map();
  if (ids.length) {
    const { data: rows } = await db
      .from('org_admin_roles')
      .select('org_admin_id, role_code, team_id')
      .in('org_admin_id', ids);
    for (const r of rows || []) {
      if (!rolesByPerson.has(r.org_admin_id)) rolesByPerson.set(r.org_admin_id, []);
      rolesByPerson.get(r.org_admin_id).push({ role_code: r.role_code, team_id: r.team_id });
    }
  }

  const { data: teams } = await db
    .from('club_teams')
    .select('id, name, category_id, sort_order')
    .eq('organization_id', org.id)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  return ok({
    roles: Array.isArray(roles) ? roles : [],
    people: list.map((p) => ({
      ...p,
      active: !p.revoked_at,
      roles: rolesByPerson.get(p.id) || [],
    })),
    teams: Array.isArray(teams) ? teams : [],
    role_catalog: STAFF_ROLES,
  });
}

// Declara un rol o le cambia la etiqueta. El código sale del catálogo
// cerrado; lo único libre es cómo lo llama el club.
async function upsertRole(db, org, body) {
  const code = body && body.role_code;
  if (!isValidStaffRole(code)) return fail(400, `Rol no reconocido: ${code}`);

  const label = cleanLabel(body.label, 60);
  const sortOrder = Number.isInteger(body.sort_order) ? body.sort_order : 0;

  const { data: existing } = await db
    .from('org_roles')
    .select('id')
    .eq('organization_id', org.id)
    .eq('role_code', code)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from('org_roles')
      .update({ label, sort_order: sortOrder })
      .eq('id', existing.id);
    if (error) return fail(500, error.message);
    return ok({ id: existing.id, role_code: code, label, updated: true });
  }

  const { data: inserted, error } = await db
    .from('org_roles')
    .insert({ organization_id: org.id, role_code: code, label, sort_order: sortOrder })
    .select('id')
    .maybeSingle();
  if (error) return fail(500, error.message);
  return ok({ id: inserted && inserted.id, role_code: code, label, created: true });
}

// Soft-delete. NO toca las asignaciones de personas ni la matriz: quitar un
// rol del listado no debería borrar en cascada quién lo tenía ni qué módulos
// dependían de él. El club lo vuelve a declarar y lo recupera todo.
async function deleteRole(db, org, body) {
  const code = body && body.role_code;
  if (!isValidStaffRole(code)) return fail(400, 'Rol no reconocido');

  const { data: updated, error } = await db
    .from('org_roles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('organization_id', org.id)
    .eq('role_code', code)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!updated) return fail(404, 'Ese rol no está declarado');

  // Avisamos de lo que queda apuntando al rol para que el front lo diga,
  // en vez de que el club descubra el hueco semanas después en el tablero.
  const { data: huerfanas } = await db
    .from('expediente_matriz')
    .select('modulo_id')
    .eq('organization_id', org.id)
    .eq('role_code', code)
    .eq('aplica', true);

  return ok({
    role_code: code,
    modulos_sin_responsable: [...new Set((huerfanas || []).map((h) => h.modulo_id))],
  });
}

// ── Personas del cuerpo técnico ──────────────────────────────

async function listStaff(db, org) {
  const { data: rows, error } = await db
    .from('org_admins')
    .select('id, email, name, invited_at, last_login_at, revoked_at')
    .eq('organization_id', org.id)
    .order('invited_at', { ascending: true });
  if (error) return fail(500, error.message);

  const list = Array.isArray(rows) ? rows : [];
  const ids = list.map((r) => r.id);
  const byAdmin = new Map();
  if (ids.length) {
    const { data: roleRows } = await db
      .from('org_admin_roles')
      .select('org_admin_id, role_code, team_id')
      .in('org_admin_id', ids);
    for (const r of roleRows || []) {
      if (!byAdmin.has(r.org_admin_id)) byAdmin.set(r.org_admin_id, []);
      byAdmin.get(r.org_admin_id).push({ role_code: r.role_code, team_id: r.team_id });
    }
  }

  return ok({
    staff: list.map((r) => ({ ...r, active: !r.revoked_at, roles: byAdmin.get(r.id) || [] })),
    role_catalog: STAFF_ROLES,
  });
}

// Alta de una persona con sus roles y equipos. Compartida por el club
// (org-panel) y el founder (admin-orgs).
//
// NO manda email: la persona pide su enlace en /panel.html con su email y
// panel-auth se lo manda. Así el acceso sólo funciona si controla el buzón,
// y nadie reparte enlaces de sesión a mano.
async function inviteStaff(db, org, body) {
  const email = normalizeStaffEmail(body && body.email);
  if (!email) return fail(400, 'Email inválido');

  const name = cleanLabel(body.name, 120);

  const rawRoles = Array.isArray(body.roles) ? body.roles : [];
  if (!rawRoles.length) return fail(400, 'Indica al menos un rol');

  // Se validan TODOS antes de insertar nada: un rol inventado en la última
  // fila no debe dejar el alta a medias.
  const roles = [];
  for (const r of rawRoles) {
    const code = r && r.role_code;
    if (!isValidStaffRole(code)) return fail(400, `Rol no reconocido: ${code}`);
    const teamId = r.team_id == null || r.team_id === '' ? null : r.team_id;
    if (teamId !== null && !isValidTeamId(teamId)) return fail(400, 'team_id inválido');
    roles.push({ role_code: code, team_id: teamId });
  }

  // Los equipos tienen que ser DE ESTE club: sin esto, un team_id de otro
  // club colado en el body daría visibilidad cruzada.
  const teamIds = [...new Set(roles.map((r) => r.team_id).filter(Boolean))];
  if (teamIds.length) {
    const { data: teams } = await db
      .from('club_teams')
      .select('id')
      .eq('organization_id', org.id)
      .in('id', teamIds);
    const found = new Set((teams || []).map((t) => t.id));
    if (teamIds.some((id) => !found.has(id))) {
      return fail(400, 'Algún equipo no pertenece a este club');
    }
  }

  const { data: inserted, error: insErr } = await db
    .from('org_admins')
    .insert({ organization_id: org.id, email, name })
    .select('id')
    .maybeSingle();
  if (insErr) {
    const dup = /duplicate key|unique/i.test(insErr.message || '');
    return fail(dup ? 409 : 500, dup ? 'Ese email ya tiene acceso a este club' : insErr.message);
  }

  const adminId = inserted && inserted.id;
  const { error: rolesErr } = await db
    .from('org_admin_roles')
    .insert(roles.map((r) => ({ org_admin_id: adminId, ...r })));
  if (rolesErr) {
    // Compensamos: una persona sin roles entra y no ve nada, que es peor
    // que no existir. La FK es ON DELETE CASCADE.
    await db.from('org_admins').delete().eq('id', adminId);
    return fail(500, rolesErr.message);
  }

  return ok({ id: adminId, email, roles });
}

// Nunca borra la fila: marca `revoked_at`. El rastro de quién tuvo acceso y
// hasta cuándo es justo lo que hay que poder demostrar.
async function revokeStaff(db, org, body) {
  const staffId = body && body.staff_id;
  if (!isValidTeamId(staffId)) return fail(400, 'staff_id inválido');

  const { data: updated, error } = await db
    .from('org_admins')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', staffId)
    .eq('organization_id', org.id)
    .is('revoked_at', null)
    .select('id, email')
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!updated) return fail(404, 'Acceso no encontrado o ya revocado');
  return ok({ id: updated.id, email: updated.email });
}


// ── Expediente: catálogo, matriz y proyección ────────────────

// Categorías en juego en ESTE club: las de sus equipos. No tiene sentido
// pedirle que configure Prebenjamín si no tiene prebenjamines.
async function clubCategories(db, org) {
  const { data: teams } = await db
    .from('club_teams')
    .select('category_id')
    .eq('organization_id', org.id)
    .is('deleted_at', null);

  const ids = [...new Set((teams || []).map((t) => t.category_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data: cats } = await db
    .from('sports_categories')
    .select('id, code, display_name_es, sort_order')
    .in('id', ids)
    .order('sort_order', { ascending: true });
  return Array.isArray(cats) ? cats : [];
}

async function getExpediente(db, org) {
  const { data: modulos, error: modErr } = await db
    .from('expediente_modulos')
    .select('id, orden, nombre_es, default_role_code, activo')
    .eq('activo', true)
    .order('orden', { ascending: true });
  if (modErr) return fail(500, modErr.message);

  const { data: matriz, error: matErr } = await db
    .from('expediente_matriz')
    .select('modulo_id, category_id, aplica, periodicidad, role_code, variante_notas, activated_at')
    .eq('organization_id', org.id);
  if (matErr) return fail(500, matErr.message);

  const categories = await clubCategories(db, org);

  const { data: roles } = await db
    .from('org_roles')
    .select('role_code, label')
    .eq('organization_id', org.id)
    .is('deleted_at', null);

  return ok({
    modulos: Array.isArray(modulos) ? modulos : [],
    matriz: Array.isArray(matriz) ? matriz : [],
    categories,
    roles: Array.isArray(roles) ? roles : [],
    periodicidades: PERIODICIDADES,
    configurado: Array.isArray(matriz) && matriz.length > 0,
  });
}

// Jugadoras activas del club con su categoría y fecha de incorporación.
// Alimenta la proyección: sin esto el club vería un número inventado.
async function activePlayers(db, org) {
  const { data } = await db
    .from('member_club_seasons')
    .select('card_slug, category_id, joined_at, role')
    .eq('organization_id', org.id)
    .is('left_at', null);
  return (data || []).filter((m) => m.role === 'jugador');
}

function normalizeSeleccion(body, moduloIds, categoryIds) {
  const raw = Array.isArray(body && body.seleccion) ? body.seleccion : null;
  if (!raw) return { rows: null, error: 'seleccion requerida' };
  if (raw.length > 500) return { rows: null, error: 'Selección demasiado grande' };

  const rows = [];
  for (const item of raw) {
    const { row, error } = buildMatrizRow(item, { moduloIds, categoryIds });
    if (error) return { rows: null, error };
    rows.push(row);
  }
  return { rows, error: null };
}

// Cuántas obligaciones generaría esta configuración, y a quién le caerían.
//
// Es el paso de "enseñar el precio antes de confirmar": activar los diez
// módulos y asignárselos todos a una sola persona es legítimo y debe poder
// hacerse, pero con el coste a la vista. En los datos de prueba de CATORZE,
// 62 jugadoras con 7 módulos activos daban 960 obligaciones; si esas 960
// apuntan a una persona, su panel es un muro rojo que no informa de nada.
async function previewExpediente(db, org, body) {
  const { data: modulos } = await db
    .from('expediente_modulos').select('id').eq('activo', true);
  const moduloIds = (modulos || []).map((m) => m.id);
  const categories = await clubCategories(db, org);
  const categoryIds = categories.map((c) => c.id);

  const { rows, error } = normalizeSeleccion(body, moduloIds, categoryIds);
  if (error) return fail(400, error);

  const jugadoras = await activePlayers(db, org);
  const temporada = seasonRange(currentSeasonStartYear());

  // Suelo de generación: hoy. Es la regla "activar genera hacia delante" —
  // encender un módulo en marzo no debe inventar los hitos ya vencidos.
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = hoy > temporada.inicio ? hoy : temporada.inicio;

  // rol → nombre de quien lo cubre, para decir "480 para Carmen" en vez de
  // "480 para preparador".
  const { data: people } = await db
    .from('org_admins')
    .select('id, name, email')
    .eq('organization_id', org.id)
    .is('revoked_at', null);
  const personas = people || [];
  const responsablePorRol = {};
  if (personas.length) {
    const { data: asign } = await db
      .from('org_admin_roles')
      .select('org_admin_id, role_code')
      .in('org_admin_id', personas.map((p) => p.id));
    const byId = new Map(personas.map((p) => [p.id, p.name || p.email]));
    for (const a of asign || []) {
      if (!responsablePorRol[a.role_code]) responsablePorRol[a.role_code] = byId.get(a.org_admin_id);
    }
  }

  const proyeccion = proyectarObligaciones({
    seleccion: rows, jugadoras, temporada, desde, responsablePorRol,
  });

  return ok({ proyeccion, temporada, desde, jugadoras: jugadoras.length });
}

// Persiste la matriz. Upsert por (club, módulo, categoría): la fila se
// guarda incluso con aplica=false para conservar la decisión y la
// periodicidad elegida por si el club reactiva el módulo más adelante.
//
// `activated_at` se sella la primera vez que un módulo pasa a activo y NO
// se vuelve a tocar en guardados posteriores: es el suelo desde el que se
// generan hitos, y moverlo cada vez que el club edita una nota borraría el
// historial de lo que ya se exigía.
async function saveExpediente(db, org, body) {
  const { data: modulos } = await db
    .from('expediente_modulos').select('id').eq('activo', true);
  const moduloIds = (modulos || []).map((m) => m.id);
  const categories = await clubCategories(db, org);
  const categoryIds = categories.map((c) => c.id);
  if (!categoryIds.length) {
    return fail(409, 'Crea primero los equipos del club: el expediente se configura por categoría');
  }

  const { rows, error } = normalizeSeleccion(body, moduloIds, categoryIds);
  if (error) return fail(400, error);

  const { data: previas } = await db
    .from('expediente_matriz')
    .select('modulo_id, category_id, aplica, activated_at')
    .eq('organization_id', org.id);
  const previaPor = new Map(
    (previas || []).map((p) => [`${p.modulo_id}|${p.category_id}`, p])
  );

  const hoy = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const payload = rows.map((r) => {
    const prev = previaPor.get(`${r.modulo_id}|${r.category_id}`);
    let activatedAt = prev ? prev.activated_at : null;
    if (r.aplica && !activatedAt) activatedAt = hoy;
    return {
      organization_id: org.id,
      ...r,
      activated_at: activatedAt,
      updated_at: now,
    };
  });

  const { error: upErr } = await db
    .from('expediente_matriz')
    .upsert(payload, { onConflict: 'organization_id,modulo_id,category_id' });
  if (upErr) return fail(500, upErr.message);

  const activos = payload.filter((p) => p.aplica);
  return ok({
    guardadas: payload.length,
    activas: activos.length,
    modulos_activos: [...new Set(activos.map((a) => a.modulo_id))],
  });
}

module.exports = {
  getStructure,
  upsertRole,
  deleteRole,
  listStaff,
  inviteStaff,
  revokeStaff,
  getExpediente,
  previewExpediente,
  saveExpediente,
  clubCategories,
  // Reexportados para que el llamador arme respuestas sin importar dos libs.
  STAFF_ROLES,
  STAFF_ROLE_CODES,
  PERIODICIDADES,
};
