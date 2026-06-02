const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { resolveJwtSecret } = require('./lib/jwt-secret');

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

// TTL de la sesión admin (cuando se intercambia TOTP por JWT).
// Default 60 min para no interrumpir flujos largos como crear una org,
// subir logo, asignar leads, invitar agentes en una misma sesión.
const SESSION_TTL_MIN = Math.max(5, parseInt(process.env.ADMIN_SESSION_TTL_MINUTES || '60', 10));
const SESSION_PURPOSE = 'admin-session';

function adminJwtSecret() {
  return resolveJwtSecret('admin-auth', 'ADMIN_JWT_SECRET', 'AGENT_JWT_SECRET');
}

function signAdminSession() {
  return jwt.sign(
    { purpose: SESSION_PURPOSE },
    adminJwtSecret(),
    { expiresIn: `${SESSION_TTL_MIN}m` }
  );
}

function verifyAdminSession(token) {
  if (!token || typeof token !== 'string') return false;
  try {
    const decoded = jwt.verify(token, adminJwtSecret());
    return decoded && decoded.purpose === SESSION_PURPOSE;
  } catch {
    return false;
  }
}

const failures = new Map();

// RFC 4648 base32 decode
function base32Decode(str) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = str.toUpperCase().replace(/=|\s/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const idx = alpha.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 6238 TOTP — ventana ±1 paso (30 s) para tolerar desfase de reloj
function verifyTotp(secret, code) {
  if (!secret || !code) return false;
  const key = base32Decode(secret);
  const token = String(code).replace(/\s/g, '').padStart(6, '0');
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let delta = -1; delta <= 1; delta++) {
    const c = counter + delta;
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(c / 0x100000000), 0);
    buf.writeUInt32BE(c >>> 0, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[19] & 0x0f;
    const otp = (
      ((hmac[offset]     & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) <<  8) |
       (hmac[offset + 3] & 0xff)
    ) % 1000000;
    if (String(otp).padStart(6, '0') === token) return true;
  }
  return false;
}

function checkAdminAuth(event, opts = {}) {
  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();

  const record = failures.get(ip);
  if (record && now - record.firstAt > WINDOW_MS) {
    failures.delete(ip);
  }

  const current = failures.get(ip);
  if (current && current.count >= MAX_FAILURES) {
    return { authorized: false, blocked: true };
  }

  const pwd        = event.headers['x-admin-password'];
  const totpCode   = event.headers['x-admin-totp'];
  const session    = event.headers['x-admin-session'];
  const totpSecret = process.env.ADMIN_TOTP_SECRET;

  const validPassword = pwd && pwd === process.env.ADMIN_PASSWORD;
  // opts.requireTotp: true → la función exige TOTP (acciones destructivas: refund, reactivar, etc.)
  // false (default) → solo contraseña; el código TOTP expira en 30s y rompería el auto-refresh
  //
  // Cuando requireTotp=true, aceptamos como alternativa al código TOTP un JWT
  // de sesión emitido por /api/admin-session tras un login con TOTP válido.
  // Esto permite sesiones admin de varios minutos sin que el código TOTP
  // (válido solo ~90s) bloquee acciones legítimas. La sesión JWT solo se emite
  // cuando ya hubo un TOTP válido, así que la propiedad de "segundo factor"
  // se mantiene al inicio de la sesión.
  const sessionValid = opts.requireTotp && session && verifyAdminSession(session);
  const validTotp = !totpSecret || !opts.requireTotp || sessionValid || verifyTotp(totpSecret, totpCode);

  if (!validPassword || !validTotp) {
    const rec = failures.get(ip) || { count: 0, firstAt: now };
    if (rec.count === 0) rec.firstAt = now;
    rec.count++;
    failures.set(ip, rec);
    return { authorized: false, blocked: false };
  }

  failures.delete(ip);
  return { authorized: true, blocked: false };
}

function unauthorizedResponse(blocked) {
  return {
    statusCode: blocked ? 429 : 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: blocked ? 'Demasiados intentos. Espera 15 minutos.' : 'No autorizado',
    }),
  };
}

module.exports = {
  checkAdminAuth,
  unauthorizedResponse,
  verifyTotp,
  base32Decode,
  signAdminSession,
  verifyAdminSession,
  SESSION_TTL_MIN,
};
