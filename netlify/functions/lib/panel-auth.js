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

const TOKEN_TTL = '7d';
const PURPOSE = 'org-panel';

function panelJwtSecret() {
  return process.env.ORG_PANEL_JWT_SECRET
    || process.env.AGENT_JWT_SECRET
    || 'changeme';
}

function signPanelSession({ orgId, orgSlug }) {
  if (!orgId || !orgSlug) {
    throw new Error('signPanelSession: orgId y orgSlug requeridos');
  }
  return jwt.sign(
    { purpose: PURPOSE, orgId, orgSlug },
    panelJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

// Devuelve { orgId, orgSlug } si el token es válido + del purpose correcto.
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
  return { orgId: decoded.orgId, orgSlug: decoded.orgSlug };
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

module.exports = {
  TOKEN_TTL,
  PURPOSE,
  signPanelSession,
  verifyPanelSession,
  authFromEvent,
  unauthorizedResponse,
};
