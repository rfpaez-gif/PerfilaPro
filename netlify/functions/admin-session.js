'use strict';

// admin-session · intercambia password + TOTP por una sesión admin (JWT)
//
// Motivación: las acciones de /admin-orgs.html (crear org, subir logo,
// asignar leads, invitar agentes) exigen `requireTotp: true`. El código
// TOTP rota cada 30s y aguanta ±1 paso (~90s). Si el admin tarda más de
// 90s en hacer click en "Crear", la petición falla con 401 aunque la
// sesión sea legítima.
//
// Este endpoint resuelve el problema: el admin valida password + TOTP
// UNA vez al inicio y recibe un JWT de sesión (por defecto 60 min).
// Las acciones subsiguientes envían password + JWT (header
// `x-admin-session`). `checkAdminAuth` acepta el JWT como alternativa
// válida al TOTP cuando `requireTotp: true`.
//
// Seguridad: el JWT solo se emite tras un TOTP válido, así que el
// segundo factor sigue presente al inicio. La TTL es configurable vía
// `ADMIN_SESSION_TTL_MINUTES` (mínimo 5 min, default 60).

const {
  checkAdminAuth,
  unauthorizedResponse,
  signAdminSession,
  SESSION_TTL_MIN,
} = require('./admin-auth');

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function makeHandler() {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Exigimos TOTP fresco aquí. Sin TOTP no hay JWT.
    const auth = checkAdminAuth(event, { requireTotp: true });
    if (!auth.authorized) return unauthorizedResponse(auth.blocked);

    const token = signAdminSession();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000).toISOString();

    return jsonResponse(200, {
      ok: true,
      token,
      expires_at: expiresAt,
      ttl_minutes: SESSION_TTL_MIN,
    });
  };
}

exports.handler = makeHandler();
exports.makeHandler = makeHandler;
