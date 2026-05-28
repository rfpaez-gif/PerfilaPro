import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isPiiCryptoConfigured,
  encryptBirthDate,
  decryptBirthDate,
  birthYearFromDate,
} from '../netlify/functions/lib/pii-crypto.js';

// Clave fija de test: 64 chars hex (32 bytes), como `openssl rand -hex 32`.
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ORIGINAL = process.env.CANTERA_PII_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CANTERA_PII_KEY;
  else process.env.CANTERA_PII_KEY = ORIGINAL;
});

describe('isPiiCryptoConfigured', () => {
  it('true con clave hex de 64 chars', () => {
    process.env.CANTERA_PII_KEY = TEST_KEY;
    expect(isPiiCryptoConfigured()).toBe(true);
  });
  it('false sin clave o con clave mal formada', () => {
    delete process.env.CANTERA_PII_KEY;
    expect(isPiiCryptoConfigured()).toBe(false);
    process.env.CANTERA_PII_KEY = 'tooshort';
    expect(isPiiCryptoConfigured()).toBe(false);
    process.env.CANTERA_PII_KEY = 'z'.repeat(64); // no-hex
    expect(isPiiCryptoConfigured()).toBe(false);
  });
});

describe('round-trip encrypt/decrypt', () => {
  beforeEach(() => { process.env.CANTERA_PII_KEY = TEST_KEY; });

  it('descifra lo que cifró', () => {
    const enc = encryptBirthDate('2012-04-23');
    expect(enc.startsWith('\\x')).toBe(true);
    expect(decryptBirthDate(enc)).toBe('2012-04-23');
  });

  it('cada cifrado usa un IV distinto (no determinista)', () => {
    const a = encryptBirthDate('2012-04-23');
    const b = encryptBirthDate('2012-04-23');
    expect(a).not.toBe(b);
    expect(decryptBirthDate(a)).toBe('2012-04-23');
    expect(decryptBirthDate(b)).toBe('2012-04-23');
  });

  it('acepta el blob como Buffer además de string \\x', () => {
    const enc = encryptBirthDate('2010-12-31');
    const buf = Buffer.from(enc.slice(2), 'hex');
    expect(decryptBirthDate(buf)).toBe('2010-12-31');
  });
});

describe('encryptBirthDate · errores', () => {
  it('lanza con formato de fecha inválido', () => {
    process.env.CANTERA_PII_KEY = TEST_KEY;
    expect(() => encryptBirthDate('23/04/2012')).toThrow();
    expect(() => encryptBirthDate('2012-4-3')).toThrow();
    expect(() => encryptBirthDate(null)).toThrow();
  });
  it('lanza si la clave no está configurada', () => {
    delete process.env.CANTERA_PII_KEY;
    expect(() => encryptBirthDate('2012-04-23')).toThrow();
  });
});

describe('decryptBirthDate · defensivo (no lanza)', () => {
  it('null sin clave', () => {
    delete process.env.CANTERA_PII_KEY;
    expect(decryptBirthDate('\\xdeadbeef')).toBeNull();
  });
  it('null con blob corrupto o demasiado corto', () => {
    process.env.CANTERA_PII_KEY = TEST_KEY;
    expect(decryptBirthDate('\\xdead')).toBeNull();
    expect(decryptBirthDate('no-es-hex')).toBeNull();
    expect(decryptBirthDate(null)).toBeNull();
  });
  it('null si la clave no coincide (authTag inválido)', () => {
    process.env.CANTERA_PII_KEY = TEST_KEY;
    const enc = encryptBirthDate('2012-04-23');
    process.env.CANTERA_PII_KEY = 'f'.repeat(64);
    expect(decryptBirthDate(enc)).toBeNull();
  });
});

describe('birthYearFromDate', () => {
  it('extrae el año', () => {
    expect(birthYearFromDate('2012-04-23')).toBe(2012);
  });
  it('null con formato inválido', () => {
    expect(birthYearFromDate('12-04-2012')).toBeNull();
    expect(birthYearFromDate(null)).toBeNull();
  });
});
