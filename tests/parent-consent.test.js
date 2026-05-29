import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/parent-consent.js';
import { signParentSession, signPanelSession } from '../netlify/functions/lib/panel-auth.js';
import { verifySecondFactor, buildConsentEvidence, CONSENT_TYPES } from '../netlify/functions/lib/consent.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const resolve = (v) => () => Promise.resolve(v);
const PII_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ───────────── lib/consent · verifySecondFactor ─────────────

describe('verifySecondFactor', () => {
  afterEach(() => { delete process.env.CANTERA_PII_KEY; });

  it('fallback a birth_year cuando no hay PII key', () => {
    delete process.env.CANTERA_PII_KEY;
    const card = { birth_year: 2012, birth_date_encrypted: null };
    expect(verifySecondFactor(card, '2012-05-10')).toBe(true);
    expect(verifySecondFactor(card, '2011-05-10')).toBe(false);
  });

  it('comparación exacta cuando hay fecha cifrada', () => {
    process.env.CANTERA_PII_KEY = PII_KEY;
    const { encryptBirthDate } = require('../netlify/functions/lib/pii-crypto.js');
    const enc = encryptBirthDate('2012-05-10');
    const card = { birth_year: 2012, birth_date_encrypted: enc };
    expect(verifySecondFactor(card, '2012-05-10')).toBe(true);
    expect(verifySecondFactor(card, '2012-05-11')).toBe(false); // mismo año, día distinto → falla
  });

  it('rechaza formatos inválidos y card vacía', () => {
    expect(verifySecondFactor({ birth_year: 2012 }, '10/05/2012')).toBe(false);
    expect(verifySecondFactor(null, '2012-05-10')).toBe(false);
    expect(verifySecondFactor({}, '2012-05-10')).toBe(false);
  });
});

describe('buildConsentEvidence', () => {
  it('incluye versión, hash sha256 y metadatos', () => {
    const ev = buildConsentEvidence({ consentType: 'public_visibility', documentVersion: 'v2', ip: '1.2.3.4', userAgent: 'UA' });
    expect(ev.document_version).toBe('v2');
    expect(ev.document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.second_factor).toBe('birth_date');
    expect(ev.ip_address).toBe('1.2.3.4');
  });
});

// ───────────── endpoint parent-consent ─────────────

function makeDb({ card = { slug: 'p-1', card_kind: 'player', birth_year: 2012, birth_date_encrypted: null, public_card: false, deleted_at: null }, admin = { id: 'a1' }, consentErr = null, updateErr = null } = {}) {
  const updates = [];
  const consents = [];
  return {
    updates,
    consents,
    from: vi.fn((t) => {
      if (t === 'cards') return {
        select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }),
        update: (row) => { updates.push(row); return { eq: resolve({ error: updateErr }) }; },
      };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      if (t === 'card_consents') return { insert: (row) => { consents.push(row); return { select: () => ({ single: resolve(consentErr ? { data: null, error: consentErr } : { data: { id: 'c1' }, error: null }) }) }; } };
      return {};
    }),
  };
}

function ev({ method = 'POST', body = {}, auth, ip = '8.8.8.8' } = {}) {
  const headers = { 'x-forwarded-for': ip, 'user-agent': 'vitest' };
  if (auth) headers.authorization = auth;
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}
const parentBearer = (email = 'tutor@example.com') => `Bearer ${signParentSession({ email })}`;
const VALID = { card_slug: 'p-1', consent_type: 'public_visibility', birth_date: '2012-05-10', accepted: true };

describe('parent-consent endpoint', () => {
  beforeEach(() => {
    _resetRateLimit();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.PARENT_PANEL_JWT_SECRET = 'parent-secret';
    process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
    delete process.env.CANTERA_PII_KEY;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.PARENT_PANEL_JWT_SECRET;
    delete process.env.ORG_PANEL_JWT_SECRET;
  });

  it('410 con el carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeDb())(ev({ auth: parentBearer(), body: VALID }))).statusCode).toBe(410);
  });

  it('401 sin sesión parent', async () => {
    expect((await makeHandler(makeDb())(ev({ body: VALID }))).statusCode).toBe(401);
  });

  it('401 con JWT org (purpose distinto)', async () => {
    const auth = `Bearer ${signPanelSession({ orgId: 'o1', orgSlug: 's1' })}`;
    expect((await makeHandler(makeDb())(ev({ auth, body: VALID }))).statusCode).toBe(401);
  });

  it('400 con consent_type inválido', async () => {
    const res = await makeHandler(makeDb())(ev({ auth: parentBearer(), body: { ...VALID, consent_type: 'whatever' } }));
    expect(res.statusCode).toBe(400);
  });

  it('400 si accepted no es true', async () => {
    const res = await makeHandler(makeDb())(ev({ auth: parentBearer(), body: { ...VALID, accepted: false } }));
    expect(res.statusCode).toBe(400);
  });

  it('403 si el email no es tutor_legal', async () => {
    const res = await makeHandler(makeDb({ admin: null }))(ev({ auth: parentBearer(), body: VALID }));
    expect(res.statusCode).toBe(403);
  });

  it('403 si el 2º factor no coincide', async () => {
    const res = await makeHandler(makeDb())(ev({ auth: parentBearer(), body: { ...VALID, birth_date: '2001-01-01' } }));
    expect(res.statusCode).toBe(403);
  });

  it('200 graba consentimiento y pone public_card=true', async () => {
    const db = makeDb();
    const res = await makeHandler(db)(ev({ auth: parentBearer(), body: VALID }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).public_card).toBe(true);
    expect(db.consents[0]).toMatchObject({ card_slug: 'p-1', consent_type: 'public_visibility', granted_by_role: 'tutor_legal', granted_by_email: 'tutor@example.com' });
    expect(db.consents[0].evidence_jsonb.document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.updates).toEqual([{ public_card: true }]);
  });

  it('image_rights: graba consentimiento sin tocar public_card', async () => {
    const db = makeDb();
    const res = await makeHandler(db)(ev({ auth: parentBearer(), body: { ...VALID, consent_type: 'image_rights' } }));
    expect(res.statusCode).toBe(200);
    expect(db.updates).toHaveLength(0);
    expect(db.consents[0].consent_type).toBe('image_rights');
  });

  it('404 si la card no es player', async () => {
    const db = makeDb({ card: { slug: 'a', card_kind: 'autonomo', deleted_at: null } });
    const res = await makeHandler(db)(ev({ auth: parentBearer(), body: VALID }));
    expect(res.statusCode).toBe(404);
  });

  it('CONSENT_TYPES expone los 4 tipos del tutor', () => {
    expect(CONSENT_TYPES).toEqual(['parental_initial', 'data_processing', 'public_visibility', 'image_rights']);
  });
});
