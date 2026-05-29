'use strict';

// Consentimiento parental LOPDGDD (art. 7 LO 3/2018) · carril Cantera 3c.
//
// El audit trail vive en card_consents (append-only por RLS). Este lib
// concentra: (1) la 2ª verificación, (2) la construcción de evidencia
// con hash, (3) el insert defensivo del consentimiento.
//
// 2º FACTOR (decisión MVP): la fecha de nacimiento del menor — el dato
// que el club registró al fichar. Se verifica contra birth_date_encrypted
// (AES, lib/pii-crypto) y, si no hay clave configurada, contra birth_year
// en claro. Es un factor de conocimiento distinto del control del email
// (1er factor = magic-link parent-panel). Cuando se cablee un proveedor
// SMS, un OTP puede sustituir o reforzar esto sin tocar los llamadores
// (solo este helper).

const crypto = require('crypto');
const { decryptBirthDate } = require('./pii-crypto');

// Tipos que pasan por el flujo de doble verificación del tutor.
// club_handoff lo graba la RPC de la capa 3b; transfer_to_player es el
// opt-in del jugador 16+ (futuro). parental_initial/data_processing/
// public_visibility/image_rights los concede el tutor aquí.
const CONSENT_TYPES = ['parental_initial', 'data_processing', 'public_visibility', 'image_rights'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

// Verifica el 2º factor. provided = 'YYYY-MM-DD' que teclea el tutor.
//   - Si hay birth_date_encrypted descifrable → comparación exacta.
//   - Si no (sin CANTERA_PII_KEY) → fallback al año en claro.
// Defensivo: cualquier formato inválido → false.
function verifySecondFactor(card, provided) {
  const p = (provided || '').trim();
  if (!DATE_RE.test(p)) return false;
  if (!card) return false;
  const real = decryptBirthDate(card.birth_date_encrypted);
  if (real) return real === p;
  if (card.birth_year) return parseInt(p.slice(0, 4), 10) === card.birth_year;
  return false;
}

// Extrae una IP limpia del evento para la columna inet (o null si no es
// parseable — evita reventar el INSERT con un valor inválido).
function clientIp(event) {
  const h = (event && event.headers) || {};
  const raw = h['x-forwarded-for'] || h['X-Forwarded-For'] || h['x-nf-client-connection-ip'] || '';
  const first = String(raw).split(',')[0].trim();
  if (IPV4_RE.test(first)) return first;
  if (first.includes(':') && first.length <= 45) return first; // IPv6 grosso modo
  return null;
}

function userAgentOf(event) {
  const h = (event && event.headers) || {};
  return (h['user-agent'] || h['User-Agent'] || '').slice(0, 400) || null;
}

// Construye evidence_jsonb: versión del documento aceptado + su hash +
// metadatos. El hash permite probar QUÉ texto aceptó el tutor sin
// almacenar el documento entero en cada fila.
function buildConsentEvidence({ consentType, documentVersion, ip, userAgent, extra }) {
  const version = documentVersion || 'v1';
  const canonical = `${consentType}|${version}`;
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return {
    document_version: version,
    document_hash: hash,
    second_factor: 'birth_date',
    accepted_at: new Date().toISOString(),
    ip_address: ip || null,
    user_agent: userAgent || null,
    ...(extra || {}),
  };
}

// Inserta el consentimiento (append-only). Devuelve { data, error }.
async function recordConsent(db, {
  cardSlug, consentType, grantedByEmail, grantedByRole,
  ip, userAgent, evidence, relatedClubId, relatedSeason,
}) {
  const row = {
    card_slug: cardSlug,
    consent_type: consentType,
    granted_by_email: grantedByEmail,
    granted_by_role: grantedByRole,
    ip_address: ip || null,
    user_agent: userAgent || null,
    evidence_jsonb: evidence || null,
  };
  if (relatedClubId) row.related_club_id = relatedClubId;
  if (relatedSeason) row.related_season = relatedSeason;
  const { data, error } = await db.from('card_consents').insert(row).select('id').single();
  return { data: data || null, error: error || null };
}

module.exports = {
  CONSENT_TYPES,
  verifySecondFactor,
  clientIp,
  userAgentOf,
  buildConsentEvidence,
  recordConsent,
};
