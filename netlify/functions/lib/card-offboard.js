'use strict';

// Lógica compartida del offboard de un miembro B2B. Lo usan dos endpoints:
//
//   - admin-orgs.js → action 'offboard_card' (founder dispara desde Studio)
//   - org-panel.js  → action 'offboard_member' (cliente dispara desde su panel)
//
// Semántica humana del offboard (consciente, no es un soft-delete oculto):
//   1. organization_id = NULL → la card sale del equipo de la org.
//   2. plan = 'base', expires_at = NOW + 90 días → cortesía gratis para que
//      el trabajador no pierda su tarjeta de golpe; puede decidir pagar
//      Pro/Base o dejar que expire.
//   3. reset reminders → el cron remind-expiry vuelve a avisar a 30/15/7d.
//   4. edit_token vigente → el trabajador puede editar y exportar antes
//      de que caduque.
//   5. previous_organization_id, offboarded_at, offboarded_by → trail para
//      que el founder pueda restaurar dentro de 90d si fue por error.
//
// La función NO manda el email del offboard. El caller lo hace porque
// cada uno tiene su propio buildOffboardEmail import y branding.
//
// Retorna:
//   { ok: true, card, orgName, editToken, expiresAt, courtesyDays }
//   { ok: false, status, error }

const crypto = require('crypto');

const COURTESY_DAYS = 90;
const EDIT_TOKEN_DAYS = 30;

async function offboardCard(db, { cardSlug, actor }) {
  if (typeof cardSlug !== 'string' || !cardSlug) {
    return { ok: false, status: 400, error: 'card_slug requerido' };
  }
  if (actor !== 'client' && actor !== 'founder') {
    return { ok: false, status: 400, error: 'actor inválido (client|founder)' };
  }

  // Cargamos la card. Solo se permite offboard de cards no soft-deleted
  // y que estén actualmente asignadas a una org (no tiene sentido
  // "darse de baja" de algo a lo que no perteneces).
  const { data: card, error: selErr } = await db
    .from('cards')
    .select('slug, nombre, email, idioma, organization_id, expires_at, edit_token, edit_token_expires_at')
    .eq('slug', cardSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (selErr) return { ok: false, status: 500, error: selErr.message };
  if (!card)  return { ok: false, status: 404, error: 'card no encontrada' };
  if (!card.organization_id) {
    return { ok: false, status: 400, error: 'la card no está asignada a ninguna organización' };
  }

  // Nombre de la org para el email del trabajador (caller lo usa).
  const { data: org } = await db
    .from('organizations')
    .select('name')
    .eq('id', card.organization_id)
    .maybeSingle();
  const orgName = org?.name || 'la empresa';

  // Calculamos expires_at: cortesía 90d, preservando un expires_at más
  // generoso si existía (caso edge: el trabajador ya tenía Pro pagado
  // hasta más adelante; no le quitamos ese plazo).
  const courtesyEnd = new Date(Date.now() + COURTESY_DAYS * 24 * 60 * 60 * 1000);
  const existingExpires = card.expires_at ? new Date(card.expires_at) : null;
  const expiresAt = existingExpires && existingExpires > courtesyEnd
    ? existingExpires.toISOString()
    : courtesyEnd.toISOString();

  // Garantizamos edit_token vigente. Si está caducado o no existe, lo
  // regeneramos con TTL 30d para que el trabajador pueda editar su
  // tarjeta tras la baja.
  let editToken = card.edit_token;
  const tokenExpired = !card.edit_token_expires_at || new Date(card.edit_token_expires_at) < new Date();
  const tokenUpdate = {};
  if (!editToken || tokenExpired) {
    editToken = crypto.randomBytes(32).toString('hex');
    tokenUpdate.edit_token = editToken;
    tokenUpdate.edit_token_expires_at = new Date(Date.now() + EDIT_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  const { error: updErr } = await db
    .from('cards')
    .update({
      previous_organization_id: card.organization_id,
      offboarded_at: new Date().toISOString(),
      offboarded_by: actor,
      organization_id: null,
      plan: 'base',
      expires_at: expiresAt,
      reminder_30_sent: false,
      reminder_15_sent: false,
      reminder_7_sent: false,
      ...tokenUpdate,
    })
    .eq('slug', cardSlug);
  if (updErr) return { ok: false, status: 500, error: updErr.message };

  return {
    ok: true,
    card,
    orgName,
    editToken,
    expiresAt,
    courtesyDays: COURTESY_DAYS,
  };
}

// Restore: pone la card de vuelta en la org de la que salió. Solo
// admin-orgs (founder) lo invoca — el cliente NO tiene esta acción
// porque (a) si el cliente offboardó por error, el restore solo lo puede
// disparar founder con criterio comercial, y (b) si la card ya pertenece
// a otra org tras el offboard, restaurar pisaría sin pedir permiso.
//
// Validaciones:
//   - La card debe estar offboarded (offboarded_at NOT NULL).
//   - previous_organization_id debe seguir apuntando a una org activa
//     (si la org fue soft-deleted entretanto, no podemos restaurar).
//   - La card NO debe haberse re-asignado a otra org tras el offboard
//     (si organization_id no es NULL ya, alguien la movió a otro sitio).
async function restoreCard(db, { cardSlug }) {
  if (typeof cardSlug !== 'string' || !cardSlug) {
    return { ok: false, status: 400, error: 'card_slug requerido' };
  }

  const { data: card, error: selErr } = await db
    .from('cards')
    .select('slug, nombre, email, idioma, organization_id, previous_organization_id, offboarded_at')
    .eq('slug', cardSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (selErr) return { ok: false, status: 500, error: selErr.message };
  if (!card)  return { ok: false, status: 404, error: 'card no encontrada' };

  if (!card.offboarded_at || !card.previous_organization_id) {
    return { ok: false, status: 400, error: 'esta card no está dada de baja' };
  }
  if (card.organization_id) {
    return {
      ok: false,
      status: 409,
      error: 'la card ya pertenece a una org distinta — no se puede restaurar sin reasignarla manualmente primero',
    };
  }

  const { data: org } = await db
    .from('organizations')
    .select('id, name')
    .eq('id', card.previous_organization_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) {
    return {
      ok: false,
      status: 404,
      error: 'la org original ya no existe (fue eliminada). Asigna la card a otra org manualmente si quieres reactivarla.',
    };
  }

  const { error: updErr } = await db
    .from('cards')
    .update({
      organization_id: card.previous_organization_id,
      plan: 'b2b',
      expires_at: null,
      previous_organization_id: null,
      offboarded_at: null,
      offboarded_by: null,
      reminder_30_sent: false,
      reminder_15_sent: false,
      reminder_7_sent: false,
    })
    .eq('slug', cardSlug);
  if (updErr) return { ok: false, status: 500, error: updErr.message };

  return { ok: true, card, orgName: org.name };
}

module.exports = {
  COURTESY_DAYS,
  EDIT_TOKEN_DAYS,
  offboardCard,
  restoreCard,
};
