'use strict';

// Cifrado en reposo de la fecha de nacimiento del menor
// (migración 033 · cards.birth_date_encrypted bytea).
//
// MECANISMO: AES-256-GCM en Node (no pgcrypto DB-side). Decisión de
// implementación sobre la nota original "pgcrypto" del schema:
//   - pgcrypto vía supabase-js exigiría funciones SQL SECURITY DEFINER
//     y pasar la clave a la BD en cada query; aquí la clave nunca sale
//     del entorno Netlify.
//   - AES-256-GCM da confidencialidad + integridad (authTag) y es
//     testeable offline sin tocar Postgres.
// La columna sigue siendo `bytea`: guardamos el ciphertext como string
// hex con prefijo `\x` (formato que PostgREST/supabase-js decodifica a
// bytea en INSERT y devuelve en SELECT).
//
// Layout del blob: [ iv(12B) | authTag(16B) | ciphertext ].
//
// La clave (CANTERA_PII_KEY) se lee LAZY — sólo al cifrar/descifrar —
// para que importar este módulo nunca rompa una función que no toque
// PII aunque la env var no esté configurada.

const crypto = require('crypto');

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve la clave de 32 bytes o null si no está configurada / mal
// formada. CANTERA_PII_KEY debe ser 64 chars hex (32 bytes) — el mismo
// formato que produce `openssl rand -hex 32`.
function loadKey() {
  const hex = process.env.CANTERA_PII_KEY;
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function isPiiCryptoConfigured() {
  return loadKey() !== null;
}

// Normaliza el blob almacenado a Buffer. Acepta:
//   - Buffer (poco común vía supabase-js, pero defensivo).
//   - string '\xDEADBEEF' (formato bytea de PostgREST).
//   - string hex pelado 'deadbeef'.
function toBuffer(stored) {
  if (Buffer.isBuffer(stored)) return stored;
  if (typeof stored !== 'string' || !stored) return null;
  const hex = stored.startsWith('\\x') ? stored.slice(2) : stored;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, 'hex');
}

// Cifra una fecha 'YYYY-MM-DD'. Devuelve el string bytea '\x...' listo
// para asignar a cards.birth_date_encrypted. Lanza si la clave no está
// configurada (el llamador debe gatear con isPiiCryptoConfigured) o si
// la fecha no tiene el formato esperado.
function encryptBirthDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) {
    throw new Error('encryptBirthDate: fecha debe ser YYYY-MM-DD');
  }
  const key = loadKey();
  if (!key) throw new Error('encryptBirthDate: CANTERA_PII_KEY no configurada');

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(dateStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, ct]);
  return '\\x' + blob.toString('hex');
}

// Descifra el blob almacenado y devuelve 'YYYY-MM-DD', o null ante
// cualquier fallo (sin clave, blob corrupto, authTag inválido). No
// lanza: el descifrado defensivo nunca debe tumbar un render.
function decryptBirthDate(stored) {
  const key = loadKey();
  if (!key) return null;
  const blob = toBuffer(stored);
  if (!blob || blob.length <= IV_BYTES + TAG_BYTES) return null;

  try {
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return DATE_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Extrae el año (entero) de una fecha 'YYYY-MM-DD'. Sirve para poblar
// cards.birth_year (en claro, único campo necesario para asignar
// categoría). null si el formato no encaja.
function birthYearFromDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  return parseInt(dateStr.slice(0, 4), 10);
}

module.exports = {
  isPiiCryptoConfigured,
  encryptBirthDate,
  decryptBirthDate,
  birthYearFromDate,
};
