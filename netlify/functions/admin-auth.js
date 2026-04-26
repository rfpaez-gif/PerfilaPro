const crypto = require('crypto');

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

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

function checkAdminAuth(event) {
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

  const pwd       = event.headers['x-admin-password'];
  const totpCode  = event.headers['x-admin-totp'];
  const totpSecret = process.env.ADMIN_TOTP_SECRET;

  const validPassword = pwd && pwd === process.env.ADMIN_PASSWORD;
  // Si no hay secreto configurado, TOTP no se exige (compatibilidad hacia atrás)
  const validTotp = !totpSecret || verifyTotp(totpSecret, totpCode);

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

module.exports = { checkAdminAuth, unauthorizedResponse, verifyTotp, base32Decode };
