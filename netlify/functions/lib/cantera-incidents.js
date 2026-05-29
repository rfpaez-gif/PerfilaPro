'use strict';

// Consola de incidencias del founder · carril Cantera.
//
// Lógica de las acciones súper-admin que el founder ejecuta desde
// admin-orgs (password + TOTP) para resolver incidencias que el
// self-serve del club no debe poder tocar. Cuatro familias:
//   1. Traspasos + membresías (editar/cerrar/reasignar).
//   2. Tutores (revocar/añadir admin).
//   3. Consentimiento + visibilidad (ver audit, forzar public_card).
//   4. PII + borrado LOPD (descifrar fecha auditada, soft/hard-delete).
//
// Funciones puras sobre `db` (sin auth: el gate vive en admin-orgs).
// Reusa las RPCs atómicas de la migración 035 para mover jugadores.

const crypto = require('crypto');
const { decryptBirthDate } = require('./pii-crypto');
const { isPlayer } = require('./card-kind');

const ADMIN_ROLES = ['tutor_legal', 'tutor_secundario', 'player_self', 'club_admin'];
const EXIT_REASONS = ['fichaje', 'baja', 'fin_temporada', 'expulsion', 'baja_voluntaria', 'cese_actividad'];
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Familia 1+2+3: vista de investigación de un jugador ──
// Un único read con todo lo que el founder necesita para diagnosticar.
async function playerOverview(db, cardSlug) {
  const { data: card } = await db
    .from('cards')
    .select('slug, nombre, card_kind, idioma, organization_id, public_card, birth_year, gender, status, deleted_at, kit_email_sent_at')
    .eq('slug', cardSlug).maybeSingle();
  if (!card) return null;

  const [memberships, admins, consents, transfers] = await Promise.all([
    db.from('member_club_seasons')
      .select('id, organization_id, season, role, category_id, team_name, dorsal, position, joined_at, left_at, exit_reason, previous_club_name')
      .eq('card_slug', cardSlug).order('joined_at', { ascending: false }),
    db.from('card_admins')
      .select('id, email, role, invited_at, accepted_at, revoked_at')
      .eq('card_slug', cardSlug),
    db.from('card_consents')
      .select('id, consent_type, granted_by_email, granted_by_role, granted_at, related_club_id, related_season')
      .eq('card_slug', cardSlug).order('granted_at', { ascending: false }),
    db.from('club_transfers')
      .select('id, from_org_id, to_org_id, status, season, created_at, resolved_at')
      .eq('card_slug', cardSlug).order('created_at', { ascending: false }),
  ]);

  return {
    card,
    memberships: memberships.data || [],
    admins: admins.data || [],
    consents: consents.data || [],
    transfers: transfers.data || [],
  };
}

// ── Familia 1: editar una membresía abierta ──
// Solo campos operativos; no toca card_slug/organization_id/role.
async function editMembership(db, membershipId, fields = {}) {
  const patch = {};
  if (fields.dorsal !== undefined) {
    if (fields.dorsal !== null && (!Number.isInteger(fields.dorsal) || fields.dorsal < 0 || fields.dorsal > 999)) {
      return { error: { message: 'dorsal inválido' } };
    }
    patch.dorsal = fields.dorsal;
  }
  if (fields.position !== undefined) patch.position = fields.position;
  if (fields.team_name !== undefined) patch.team_name = fields.team_name;
  if (fields.category_id !== undefined) patch.category_id = fields.category_id;
  if (Object.keys(patch).length === 0) return { error: { message: 'nada que actualizar' } };

  const { error } = await db.from('member_club_seasons')
    .update(patch).eq('id', membershipId).is('left_at', null);
  return { error: error || null, patch };
}

// ── Familia 1: cerrar membresía activa (RPC atómica 035) ──
async function closeMembership(db, cardSlug, exitReason, actorEmail = 'founder-override') {
  if (!EXIT_REASONS.includes(exitReason)) return { error: { message: 'exit_reason inválido' } };
  const { data, error } = await db.rpc('cantera_close_membership', {
    p_card_slug: cardSlug, p_exit_reason: exitReason, p_actor_email: actorEmail,
  });
  return { data: data || null, error: error || null };
}

// ── Familia 1: reasignar de club (founder) vía transfer atómico ──
// Crea una solicitud y la ejecuta con la RPC (cierra vieja + abre nueva
// + UPDATE card + consent club_handoff), todo atómico.
async function reassignClub(db, { cardSlug, toOrgId, season, dorsal = null, position = null, teamName = null }) {
  const { data: active } = await db.from('member_club_seasons')
    .select('id, organization_id').eq('card_slug', cardSlug).eq('role', 'jugador').is('left_at', null).maybeSingle();
  if (!active) return { error: { message: 'el jugador no tiene membresía activa' } };
  if (active.organization_id === toOrgId) return { error: { message: 'ya pertenece a ese club' } };

  const { data: created, error: insErr } = await db.from('club_transfers').insert({
    card_slug: cardSlug, from_org_id: active.organization_id, to_org_id: toOrgId,
    requested_by_email: 'founder-override', status: 'pending', season, dorsal, position, team_name: teamName,
  }).select('id').single();
  if (insErr) return { error: insErr };

  const { data, error } = await db.rpc('cantera_execute_transfer', {
    p_transfer_id: created.id, p_actor_email: 'founder-override', p_actor_role: 'founder',
  });
  return { data: data || null, error: error || null };
}

// ── Familia 2: revocar un admin (tutor) ──
async function revokeAdmin(db, adminId) {
  const { error } = await db.from('card_admins')
    .update({ revoked_at: new Date().toISOString() }).eq('id', adminId);
  return { error: error || null };
}

// ── Familia 2: añadir un admin (tutor) con su edit_token ──
async function addAdmin(db, { cardSlug, email, role }) {
  const e = (email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: { message: 'email inválido' } };
  if (!ADMIN_ROLES.includes(role)) return { error: { message: 'role inválido' } };
  const { data, error } = await db.from('card_admins').insert({
    card_slug: cardSlug, email: e, role,
    edit_token: crypto.randomBytes(32).toString('hex'),
    edit_token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  }).select('id').single();
  return { data: data || null, error: error || null };
}

// ── Familia 3: forzar/revocar visibilidad pública del menor ──
async function setVisibility(db, cardSlug, publicCard) {
  const { error } = await db.from('cards').update({ public_card: !!publicCard }).eq('slug', cardSlug);
  return { error: error || null };
}

// ── Familia 4: descifrar fecha de nacimiento (soporte, auditado) ──
async function revealBirthDate(db, cardSlug) {
  const { data: card } = await db.from('cards')
    .select('birth_date_encrypted, birth_year').eq('slug', cardSlug).maybeSingle();
  if (!card) return { error: { message: 'card no encontrada' } };
  return {
    data: {
      birth_date: decryptBirthDate(card.birth_date_encrypted), // null si no hay PII key o blob corrupto
      birth_year: card.birth_year,
    },
    error: null,
  };
}

// ── Familia 4: borrado LOPD (soft por defecto, hard opcional) ──
// soft → deleted_at (recuperable); hard → DELETE (cascade member_club_
// seasons + card_admins; card_consents es RESTRICT → hard falla si hay
// consentimientos, protegiendo el audit trail).
async function deletePlayer(db, cardSlug, { hard = false } = {}) {
  if (hard) {
    const { error } = await db.from('cards').delete().eq('slug', cardSlug);
    return { error: error || null, mode: 'hard' };
  }
  const { error } = await db.from('cards')
    .update({ deleted_at: new Date().toISOString() }).eq('slug', cardSlug);
  return { error: error || null, mode: 'soft' };
}

module.exports = {
  ADMIN_ROLES,
  EXIT_REASONS,
  playerOverview,
  editMembership,
  closeMembership,
  reassignClub,
  revokeAdmin,
  addAdmin,
  setVisibility,
  revealBirthDate,
  deletePlayer,
  isPlayer,
};
