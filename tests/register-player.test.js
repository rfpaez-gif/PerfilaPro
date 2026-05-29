import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler } from '../netlify/functions/register-player.js';
import { signPanelSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

const FUTBOL = [
  { id: 'cat-prebenjamin', code: 'prebenjamin', min_birth_year_offset: -7,  max_birth_year_offset: -6,  sort_order: 10 },
  { id: 'cat-infantil',    code: 'infantil',    min_birth_year_offset: -13, max_birth_year_offset: -12, sort_order: 40 },
  { id: 'cat-cadete',      code: 'cadete',      min_birth_year_offset: -15, max_birth_year_offset: -14, sort_order: 50 },
];

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

function makeDb(opts = {}) {
  const {
    org = { id: 'club-1', slug: 'cd-test', name: 'CD Test', kind: 'sports_club', sport: 'futbol', deleted_at: null },
    orgErr = null,
    slugClash = false,
    categories = FUTBOL,
    cardInsertErr = null,
    seasonInsertErr = null,
    adminInsertErr = null,
  } = opts;

  const inserts = { cards: [], member_club_seasons: [], card_admins: [] };
  const deletes = { cards: [] };

  const orgsTable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: org, error: orgErr }),
  };
  const cardsTable = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: slugClash ? { slug: 'p-clash' } : null, error: null }),
      })),
    })),
    insert: vi.fn((row) => { inserts.cards.push(row); return Promise.resolve({ error: cardInsertErr }); }),
    delete: vi.fn(() => ({ eq: vi.fn((col, val) => { deletes.cards.push(val); return Promise.resolve({ error: null }); }) })),
  };
  const seasonsTable = {
    insert: vi.fn((row) => { inserts.member_club_seasons.push(row); return Promise.resolve({ error: seasonInsertErr }); }),
  };
  const adminsTable = {
    insert: vi.fn((rows) => { inserts.card_admins.push(rows); return Promise.resolve({ error: adminInsertErr }); }),
  };
  const categoriesTable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: categories, error: null }),
  };

  const db = {
    from: vi.fn((t) => {
      if (t === 'organizations') return orgsTable;
      if (t === 'cards') return cardsTable;
      if (t === 'member_club_seasons') return seasonsTable;
      if (t === 'card_admins') return adminsTable;
      if (t === 'sports_categories') return categoriesTable;
      return {};
    }),
  };
  return { db, inserts, deletes };
}

function authHeader(orgId = 'club-1', orgSlug = 'cd-test') {
  return `Bearer ${signPanelSession({ orgId, orgSlug })}`;
}

function buildEvent({ method = 'POST', body = {}, auth = true, ip = '7.7.7.7' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = authHeader();
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

const VALID_BODY = {
  nombre: 'Leo Pérez',
  birth_date: '2012-05-10',
  tutor_legal_email: 'madre@example.com',
  season: '2025-26',
  dorsal: 10,
  position: 'Delantero',
  team_name: 'Infantil A',
};

describe('register-player', () => {
  beforeEach(() => {
    _resetRateLimit();
    mockEmailSend.mockReset();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    process.env.ORG_PANEL_JWT_SECRET = 'test-org-secret';
    delete process.env.CANTERA_PII_KEY;
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    delete process.env.ORG_PANEL_JWT_SECRET;
    delete process.env.CANTERA_PII_KEY;
  });

  it('410 cuando el carril está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const { db } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }));
    expect(res.statusCode).toBe(410);
  });

  it('405 si no es POST', async () => {
    const { db } = makeDb();
    expect((await makeHandler(db, mockEmail)(buildEvent({ method: 'GET' }))).statusCode).toBe(405);
  });

  it('401 sin JWT', async () => {
    const { db } = makeDb();
    expect((await makeHandler(db, mockEmail)(buildEvent({ auth: false, body: VALID_BODY }))).statusCode).toBe(401);
  });

  it('401 si la org está soft-deleted', async () => {
    const { db } = makeDb({ org: { id: 'club-1', kind: 'sports_club', deleted_at: '2026-01-01' } });
    expect((await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }))).statusCode).toBe(401);
  });

  it('403 si la org no es sports_club', async () => {
    const { db } = makeDb({ org: { id: 'club-1', name: 'Asesoría X', kind: 'business', sport: null, deleted_at: null } });
    expect((await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }))).statusCode).toBe(403);
  });

  it('400 sin nombre', async () => {
    const { db } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: { ...VALID_BODY, nombre: '' } }));
    expect(res.statusCode).toBe(400);
  });

  it('400 con email de tutor inválido', async () => {
    const { db } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: { ...VALID_BODY, tutor_legal_email: 'no-email' } }));
    expect(res.statusCode).toBe(400);
  });

  it('400 jugador sin fecha de nacimiento', async () => {
    const { db } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: { ...VALID_BODY, birth_date: '' } }));
    expect(res.statusCode).toBe(400);
  });

  it('happy path jugador: 201, card player + membership + tutor + email', async () => {
    const { db, inserts } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }));
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body);
    expect(out.slug).toMatch(/^p-[0-9a-f]{8}$/);
    expect(out.card_kind).toBe('player');
    expect(out.season).toBe('2025-26');
    expect(out.category_id).toBe('cat-infantil'); // nacido 2012, temporada 2025 → infantil

    const card = inserts.cards[0];
    expect(card.card_kind).toBe('player');
    expect(card.public_card).toBe(false);
    expect(card.birth_year).toBe(2012);
    expect(card.organization_id).toBe('club-1');
    expect(card.birth_date_encrypted).toBeNull(); // sin CANTERA_PII_KEY

    const ms = inserts.member_club_seasons[0];
    expect(ms).toMatchObject({ card_slug: out.slug, organization_id: 'club-1', role: 'jugador', dorsal: 10, category_id: 'cat-infantil', season: '2025-26' });

    expect(inserts.card_admins[0]).toHaveLength(1);
    expect(inserts.card_admins[0][0]).toMatchObject({ email: 'madre@example.com', role: 'tutor_legal' });
    expect(inserts.card_admins[0][0].edit_token).toMatch(/^[0-9a-f]{64}$/);

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.mock.calls[0][0].to).toBe('madre@example.com');
  });

  it('camino off-platform: persiste previous_club_name', async () => {
    const { db, inserts } = makeDb();
    await makeHandler(db, mockEmail)(buildEvent({ body: { ...VALID_BODY, previous_club_name: 'EF La Cantera' } }));
    expect(inserts.member_club_seasons[0].previous_club_name).toBe('EF La Cantera');
  });

  it('tutor secundario se inserta como segundo admin', async () => {
    const { db, inserts } = makeDb();
    await makeHandler(db, mockEmail)(buildEvent({ body: { ...VALID_BODY, tutor_secundario_email: 'padre@example.com' } }));
    const adminRows = inserts.card_admins[0];
    expect(adminRows).toHaveLength(2);
    expect(adminRows[1]).toMatchObject({ email: 'padre@example.com', role: 'tutor_secundario' });
  });

  it('staff: card_kind club_staff, sin dorsal ni categoría, fecha opcional', async () => {
    const { db, inserts } = makeDb();
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: {
      nombre: 'Ana Coach', role: 'entrenador', tutor_legal_email: 'ana@example.com', season: '2025-26',
    } }));
    expect(res.statusCode).toBe(201);
    expect(inserts.cards[0].card_kind).toBe('club_staff');
    const ms = inserts.member_club_seasons[0];
    expect(ms.role).toBe('entrenador');
    expect(ms.dorsal).toBeNull();
    expect(ms.category_id).toBeNull();
  });

  it('rollback: si falla la membership, borra la card y devuelve 500', async () => {
    const { db, deletes } = makeDb({ seasonInsertErr: { message: 'boom' } });
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }));
    expect(res.statusCode).toBe(500);
    expect(deletes.cards).toHaveLength(1);
  });

  it('rollback: si falla card_admins, borra la card y devuelve 500', async () => {
    const { db, deletes } = makeDb({ adminInsertErr: { message: 'dup' } });
    const res = await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }));
    expect(res.statusCode).toBe(500);
    expect(deletes.cards).toHaveLength(1);
  });

  it('cifra birth_date cuando CANTERA_PII_KEY está configurada', async () => {
    process.env.CANTERA_PII_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const { db, inserts } = makeDb();
    await makeHandler(db, mockEmail)(buildEvent({ body: VALID_BODY }));
    expect(inserts.cards[0].birth_date_encrypted).toMatch(/^\\x[0-9a-f]+$/);
  });
});
