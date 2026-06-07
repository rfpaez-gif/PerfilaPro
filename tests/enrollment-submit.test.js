import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/enrollment-submit.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const FUTBOL = [
  { id: 'cat-ale', code: 'alevin', min_birth_year_offset: -11, max_birth_year_offset: -10, sort_order: 30 },
];
const TOKEN = 'a'.repeat(32);
const OPEN_CAMPAIGN = { id: 'camp-1', organization_id: 'club-1', season: '2025-26', status: 'open', matricula_cents: 3500, monthly_fee_cents: 3000 };
const SPORTS_ORG = { id: 'club-1', name: 'EF Universal', kind: 'sports_club', sport: 'futbol', deleted_at: null };

function makeDb(opts = {}) {
  const {
    campaign = OPEN_CAMPAIGN, org = SPORTS_ORG, categories = FUTBOL,
    cardInsertErr = null, slugClash = false,
  } = opts;
  const inserts = { cards: [], member_club_seasons: [], card_admins: [], card_consents: [] };
  const deletes = { cards: [] };
  const updates = { cards: [] };
  const uploads = [];

  return {
    inserts, deletes, updates, uploads,
    storage: {
      from: () => ({
        upload: (name, buf, o) => { uploads.push({ name, len: buf.length, o }); return Promise.resolve({ error: null }); },
        getPublicUrl: (name) => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/Avatars/' + name } }),
      }),
    },
    from: vi.fn((t) => {
      if (t === 'enrollment_campaigns') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: campaign, error: null }) }) }) };
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: org, error: null }) }) }) };
      if (t === 'cards') return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: slugClash ? { slug: 'p-clash' } : null, error: null }) }) }),
        insert: (row) => { inserts.cards.push(row); return Promise.resolve({ error: cardInsertErr }); },
        update: (row) => { updates.cards.push(row); return { eq: () => Promise.resolve({ error: null }) }; },
        delete: () => ({ eq: (c, v) => { deletes.cards.push(v); return Promise.resolve({ error: null }); } }),
      };
      if (t === 'member_club_seasons') return { insert: (row) => { inserts.member_club_seasons.push(row); return Promise.resolve({ error: null }); } };
      if (t === 'card_admins') return { insert: (rows) => { inserts.card_admins.push(rows); return Promise.resolve({ error: null }); } };
      if (t === 'card_consents') return { insert: (row) => { inserts.card_consents.push(row); return { select: () => ({ single: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }) }; } };
      if (t === 'sports_categories') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: categories, error: null }) }) }) };
      return {};
    }),
  };
}
const mockEmail = { emails: { send: vi.fn() } };

function ev(body = {}, ip = '3.3.3.3') {
  return { httpMethod: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) };
}
const VALID = {
  token: TOKEN, nombre: 'Lucía Fernández', birth_date: '2015-04-10',
  tutor_legal_email: 'madre@e.es', tutor_legal_name: 'Ana Fernández',
  consent_data: true, payment_choice: 'club',
};

describe('enrollment-submit', () => {
  beforeEach(() => {
    _resetRateLimit();
    mockEmail.emails.send.mockReset();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.AGENT_JWT_SECRET = 'test-secret';
    delete process.env.CANTERA_PII_KEY;
  });
  afterEach(() => { delete process.env.CANTERA_VERTICAL_ACTIVE; });

  it('410 carril off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect((await makeHandler(makeDb(), mockEmail)(ev(VALID))).statusCode).toBe(410);
  });
  it('405 si no es POST', async () => {
    const res = await makeHandler(makeDb(), mockEmail)({ httpMethod: 'GET', headers: {} });
    expect(res.statusCode).toBe(405);
  });
  it('honeypot: website relleno → 200 sin crear nada', async () => {
    const db = makeDb();
    const res = await makeHandler(db, mockEmail)(ev({ ...VALID, website: 'bot' }));
    expect(res.statusCode).toBe(200);
    expect(db.inserts.cards).toHaveLength(0);
  });
  it('400 token mal formado', async () => {
    expect((await makeHandler(makeDb(), mockEmail)(ev({ ...VALID, token: 'xxx' }))).statusCode).toBe(400);
  });
  it('409 si la campaña está cerrada', async () => {
    const db = makeDb({ campaign: { ...OPEN_CAMPAIGN, status: 'closed' } });
    expect((await makeHandler(db, mockEmail)(ev(VALID))).statusCode).toBe(409);
  });
  it('409 si el club no es sports_club', async () => {
    const db = makeDb({ org: { ...SPORTS_ORG, kind: 'business' } });
    expect((await makeHandler(db, mockEmail)(ev(VALID))).statusCode).toBe(409);
  });
  it('400 si faltan campos obligatorios', async () => {
    const res = await makeHandler(makeDb(), mockEmail)(ev({ token: TOKEN, payment_choice: 'club' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).fields).toContain('nombre');
  });
  it('400 sin consentimiento de datos', async () => {
    const res = await makeHandler(makeDb(), mockEmail)(ev({ ...VALID, consent_data: false }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).fields).toContain('consent_data');
  });

  it('happy path: crea ficha player public_card=false + tutor + consents + email', async () => {
    const db = makeDb();
    const res = await makeHandler(db, mockEmail)(ev(VALID));
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body);
    expect(out.slug).toMatch(/^p-[0-9a-f]{8}$/);
    expect(out.category_id).toBe('cat-ale'); // nacida 2015, temporada 2025 → alevín
    expect(out.payment_choice).toBe('club');
    expect(out.parent_session).toBeTruthy();
    expect(out.campaign_id).toBe('camp-1');

    expect(db.inserts.cards[0].card_kind).toBe('player');
    expect(db.inserts.cards[0].public_card).toBe(false);
    expect(db.inserts.card_admins[0][0]).toMatchObject({ email: 'madre@e.es', role: 'tutor_legal', name: 'Ana Fernández' });
    // parental_initial + data_processing (sin image_rights al no marcarlo)
    expect(db.inserts.card_consents.map(c => c.consent_type).sort()).toEqual(['data_processing', 'parental_initial']);
    expect(db.inserts.card_consents[0].evidence_jsonb.second_factor).toBe('self_service');
    expect(mockEmail.emails.send).toHaveBeenCalledTimes(1);
  });

  it('consent_image marcado → añade image_rights', async () => {
    const db = makeDb();
    await makeHandler(db, mockEmail)(ev({ ...VALID, consent_image: true }));
    expect(db.inserts.card_consents.map(c => c.consent_type)).toContain('image_rights');
  });

  it('con consent_image + foto: sube a storage y escribe foto_url', async () => {
    const db = makeDb();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64').toString('base64');
    const res = await makeHandler(db, mockEmail)(ev({
      ...VALID, consent_image: true, photo_base64: png, photo_content_type: 'image/png',
    }));
    expect(res.statusCode).toBe(201);
    expect(db.uploads).toHaveLength(1);
    expect(db.uploads[0].name).toMatch(/^players\/p-[0-9a-f]{8}-\d+\.png$/);
    expect(db.updates.cards[0].foto_url).toContain('/Avatars/players/');
  });
  it('foto sin consent_image: NO sube nada (gated por derechos de imagen)', async () => {
    const db = makeDb();
    await makeHandler(db, mockEmail)(ev({
      ...VALID, consent_image: false, photo_base64: 'AAAA', photo_content_type: 'image/png',
    }));
    expect(db.uploads).toHaveLength(0);
    expect(db.updates.cards).toHaveLength(0);
  });

  it('payment_choice online se devuelve para que el front encadene el checkout', async () => {
    const db = makeDb();
    const res = await makeHandler(db, mockEmail)(ev({ ...VALID, payment_choice: 'online' }));
    expect(JSON.parse(res.body).payment_choice).toBe('online');
  });

  it('500 + sin slug si falla la creación de la card', async () => {
    const db = makeDb({ cardInsertErr: { message: 'boom' } });
    const res = await makeHandler(db, mockEmail)(ev(VALID));
    expect(res.statusCode).toBe(500);
  });
});
