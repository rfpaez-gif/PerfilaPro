import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyTotp, base32Decode } from '../netlify/functions/admin-auth.js';

// TOTP secret fijo para tests (base32)
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'; // "Hello!" en base32

describe('base32Decode', () => {
  it('decodifica correctamente un secreto conocido', () => {
    const buf = base32Decode('MFRGG');
    expect(buf[0]).toBe(0x61); // 'a'
  });

  it('ignora espacios y padding', () => {
    const a = base32Decode('JBSWY3DP');
    const b = base32Decode('JBSWY3DP===');
    const c = base32Decode('JB SW Y3 DP');
    expect(a.toString('hex')).toBe(b.toString('hex'));
    expect(a.toString('hex')).toBe(c.toString('hex'));
  });
});

describe('verifyTotp', () => {
  it('retorna false si no hay secreto', () => {
    expect(verifyTotp('', '123456')).toBe(false);
    expect(verifyTotp(null, '123456')).toBe(false);
  });

  it('retorna false si no hay código', () => {
    expect(verifyTotp(TEST_SECRET, '')).toBe(false);
    expect(verifyTotp(TEST_SECRET, null)).toBe(false);
  });

  it('retorna false con código incorrecto', () => {
    expect(verifyTotp(TEST_SECRET, '000000')).toBe(false);
  });

  it('valida el código correcto para el contador actual', () => {
    // Calculamos el OTP actual con el mismo algoritmo
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
    const code = String(otp).padStart(6, '0');

    expect(verifyTotp(TEST_SECRET, code)).toBe(true);
  });

  it('acepta código del paso anterior (tolerancia ±1)', () => {
    const crypto = require('crypto');
    const buf = base32Decode(TEST_SECRET);
    const counter = Math.floor(Date.now() / 1000 / 30) - 1; // paso anterior
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
    const code = String(otp).padStart(6, '0');

    expect(verifyTotp(TEST_SECRET, code)).toBe(true);
  });

  it('acepta código con espacios (ej: "123 456")', () => {
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
    const raw = String(otp).padStart(6, '0');
    const spaced = raw.slice(0, 3) + ' ' + raw.slice(3);

    expect(verifyTotp(TEST_SECRET, spaced)).toBe(true);
  });
});

describe('checkAdminAuth con TOTP', () => {
  const { checkAdminAuth } = require('../netlify/functions/admin-auth.js');

  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'admin123';
  });

  afterEach(() => {
    delete process.env.ADMIN_TOTP_SECRET;
  });

  it('pasa sin TOTP si ADMIN_TOTP_SECRET no está configurado', () => {
    delete process.env.ADMIN_TOTP_SECRET;
    const event = { headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '1.2.3.4' } };
    expect(checkAdminAuth(event).authorized).toBe(true);
  });

  it('rechaza si TOTP configurado pero no enviado (acción destructiva)', () => {
    process.env.ADMIN_TOTP_SECRET = TEST_SECRET;
    const event = { headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '1.2.3.5' } };
    expect(checkAdminAuth(event, { requireTotp: true }).authorized).toBe(false);
  });

  it('rechaza si TOTP incorrecto (acción destructiva)', () => {
    process.env.ADMIN_TOTP_SECRET = TEST_SECRET;
    const event = { headers: { 'x-admin-password': 'admin123', 'x-admin-totp': '000000', 'x-forwarded-for': '1.2.3.6' } };
    expect(checkAdminAuth(event, { requireTotp: true }).authorized).toBe(false);
  });

  it('acepta sin TOTP en lectura aunque TOTP esté configurado', () => {
    process.env.ADMIN_TOTP_SECRET = TEST_SECRET;
    const event = { headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '1.2.3.9' } };
    expect(checkAdminAuth(event).authorized).toBe(true);
  });

  it('acepta con contraseña + TOTP correcto', () => {
    process.env.ADMIN_TOTP_SECRET = TEST_SECRET;
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
    const code = String(otp).padStart(6, '0');

    const event = { headers: { 'x-admin-password': 'admin123', 'x-admin-totp': code, 'x-forwarded-for': '1.2.3.7' } };
    expect(checkAdminAuth(event).authorized).toBe(true);
  });
});
