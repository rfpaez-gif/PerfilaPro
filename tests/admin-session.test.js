import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/admin-session.js';
import { verifyAdminSession, base32Decode } from '../netlify/functions/admin-auth.js';

const TEST_SECRET = 'JBSWY3DPEHPK3PXP';
const handler = makeHandler();

function currentTotp() {
  const crypto = require('crypto');
  const buf = base32Decode(TEST_SECRET);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const cbuf = Buffer.alloc(8);
  cbuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  cbuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', buf).update(cbuf).digest();
  const offset = hmac[19] & 0x0f;
  const otp = (
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) <<  8) |
     (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return String(otp).padStart(6, '0');
}

describe('admin-session', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'admin123';
    process.env.ADMIN_TOTP_SECRET = TEST_SECRET;
    process.env.ADMIN_JWT_SECRET = 'test-jwt-secret-session';
  });

  afterEach(() => {
    delete process.env.ADMIN_TOTP_SECRET;
    delete process.env.ADMIN_JWT_SECRET;
  });

  function buildEvent({ method = 'POST', password = 'admin123', totp = null, ip = '9.9.9.1' } = {}) {
    const headers = { 'x-admin-password': password, 'x-forwarded-for': ip };
    if (totp !== null) headers['x-admin-totp'] = totp;
    return { httpMethod: method, headers };
  }

  it('rechaza GET con 405', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza sin password con 401', async () => {
    const res = await handler(buildEvent({ password: '', totp: currentTotp() }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza sin TOTP con 401', async () => {
    const res = await handler(buildEvent({ ip: '9.9.9.10' }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza TOTP incorrecto con 401', async () => {
    const res = await handler(buildEvent({ totp: '000000', ip: '9.9.9.11' }));
    expect(res.statusCode).toBe(401);
  });

  it('emite un JWT válido con password + TOTP correctos', async () => {
    const res = await handler(buildEvent({ totp: currentTotp(), ip: '9.9.9.20' }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(typeof json.token).toBe('string');
    expect(json.token.split('.').length).toBe(3);
    expect(verifyAdminSession(json.token)).toBe(true);
    expect(typeof json.expires_at).toBe('string');
    expect(json.ttl_minutes).toBe(60);
  });

  it('expires_at está en el futuro', async () => {
    const res = await handler(buildEvent({ totp: currentTotp(), ip: '9.9.9.21' }));
    const json = JSON.parse(res.body);
    const exp = new Date(json.expires_at).getTime();
    expect(exp).toBeGreaterThan(Date.now());
    // Debe estar cerca de "ahora + 60 min" (tolerancia ±5s)
    const expected = Date.now() + 60 * 60 * 1000;
    expect(Math.abs(exp - expected)).toBeLessThan(5000);
  });
});
