'use strict';

// Auth del panel cliente B2B (/panel.html).
//
// Mismo patrón que agent-auth.js (JWT HS256, 7 días) pero con un claim
// `purpose: 'org-panel'` que IMPIDE que un token de agente o de admin se
// reuse aquí (y viceversa). El secreto reutiliza AGENT_JWT_SECRET para
// no añadir env vars; cuando convivan secretos por entorno, basta con
// exportar ORG_PANEL_JWT_SECRET y este módulo lo prefiere.
//
// El flujo es passwordless: panel-auth.js firma el JWT y lo manda al
// email del cliente como magic-link. El frontend lo guarda en
// localStorage y lo presenta en el header Authorization: Bearer <jwt>
// en las llamadas a /api/org-panel.

const jwt = require('jsonwebtoken');
const { resolveJwtSecret } = require('./jwt-secret');

const TOKEN_TTL = '7d';
const FOUNDER_TOKEN_TTL = '1h';
const PURPOSE = 'org-panel';

// Carril Cantera · sesión del panel del padre/tutor (capa 2).
// Espejo de la sesión org-panel pero scoped al EMAIL del tutor en lugar
// de a una org: un tutor con varios hijos administra todas las cards
// donde aparece en card_admins con ese email. El claim
// `purpose:'parent-panel'` impide que un JWT de org o de agente se
// reuse aquí (y viceversa). Secreto propio PARENT_PANEL_JWT_SECRET con
// fallback a ORG_PANEL_JWT_SECRET → AGENT_JWT_SECRET para no obligar a
// configurar una env var nueva el día 1.
const PARENT_PURPOSE = 'parent-panel';

function panelJwtSecret() {
  return resolveJwtSecret('panel-auth (org)', 'ORG_PANEL_JWT_SECRET', 'AGENT_JWT_SECRET');
}

// Firma un JWT del panel.
//   - actor undefined → flujo normal cliente, TTL 7d.
//   - actor === 'founder' → impersonación de soporte/demo desde admin-orgs,
//     TTL corto (1h) porque es una sesión operativa, no persistente. El claim
//     queda en el JWT (no en query string) para que panel.html lo verifique
//     y pinte una franja "operando como founder".
function signPanelSession({ orgId, orgSlug, actor }) {
  if (!orgId || !orgSlug) {
    throw new Error('signPanelSession: orgId y orgSlug requeridos');
  }
  const payload = { purpose: PURPOSE, orgId, orgSlug };
  const isFounder = actor === 'founder';
  if (isFounder) payload.actor = 'founder';
  return jwt.sign(payload, panelJwtSecret(), {
    expiresIn: isFounder ? FOUNDER_TOKEN_TTL : TOKEN_TTL,
  });
}

// Devuelve { orgId, orgSlug, actor? } si el token es válido + del purpose correcto.
// null en cualquier otro caso (firma inválida, expirado, purpose distinto).
function verifyPanelSession(token) {
  if (!token || typeof token !== 'string') return null;
  let decoded;
  try {
    decoded = jwt.verify(token, panelJwtSecret());
  } catch {
    return null;
  }
  if (!decoded || decoded.purpose !== PURPOSE) return null;
  if (!decoded.orgId || !decoded.orgSlug) return null;
  const out = { orgId: decoded.orgId, orgSlug: decoded.orgSlug };
  if (decoded.actor === 'founder') out.actor = 'founder';
  return out;
}

// Extrae el JWT del header Authorization: Bearer <token>.
// Devuelve null si no hay header, no es Bearer, o el token no verifica.
function authFromEvent(event) {
  const h = (event && event.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  return verifyPanelSession(m[1]);
}

function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Sesión inválida o expirada' }),
  };
}

// --- Parent panel (Cantera) ---------------------------------------

function parentPanelJwtSecret() {
  return resolveJwtSecret(
    'panel-auth (parent)',
    'PARENT_PANEL_JWT_SECRET',
    'ORG_PANEL_JWT_SECRET',
    'AGENT_JWT_SECRET'
  );
}

// Firma un JWT del panel del padre. El email se normaliza (lower+trim)
// para que el claim sea estable; la prueba de control del email es el
// propio magic-link, así que el email es el ancla de identidad.
function signParentSession({ email }) {
  const e = typeof email === 'string' ? email.toLowerCase().trim() : '';
  if (!e) throw new Error('signParentSession: email requerido');
  return jwt.sign({ purpose: PARENT_PURPOSE, email: e }, parentPanelJwtSecret(), {
    expiresIn: TOKEN_TTL,
  });
}

// Devuelve { email } si el token es válido + purpose parent-panel.
// null en cualquier otro caso (firma inválida, expirado, otro purpose).
function verifyParentSession(token) {
  if (!token || typeof token !== 'string') return null;
  let decoded;
  try {
    decoded = jwt.verify(token, parentPanelJwtSecret());
  } catch {
    return null;
  }
  if (!decoded || decoded.purpose !== PARENT_PURPOSE) return null;
  if (!decoded.email) return null;
  return { email: decoded.email };
}

// Extrae y verifica el JWT parent-panel del header Authorization.
function parentAuthFromEvent(event) {
  const h = (event && event.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  return verifyParentSession(m[1]);
}

module.exports = {
  TOKEN_TTL,
  FOUNDER_TOKEN_TTL,
  PURPOSE,
  PARENT_PURPOSE,
  signPanelSession,
  verifyPanelSession,
  authFromEvent,
  unauthorizedResponse,
  signParentSession,
  verifyParentSession,
  parentAuthFromEvent,
};
