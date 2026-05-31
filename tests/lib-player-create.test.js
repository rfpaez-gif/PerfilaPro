import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePlayerSlug, createPlayerCard } from '../netlify/functions/lib/player-create.js';

const FUTBOL = [
  { id: 'cat-prebenjamin', code: 'prebenjamin', min_birth_year_offset: -7,  max_birth_year_offset: -6,  sort_order: 10 },
  { id: 'cat-infantil',    code: 'infantil',    min_birth_year_offset: -13, max_birth_year_offset: -12, sort_order: 40 },
];

function makeDb(opts = {}) {
  const { slugClash = false, categories = FUTBOL, cardInsertErr = null, seasonInsertErr = null, adminInsertErr = null } = opts;
  const inserts = { cards: [], member_club_seasons: [], card_admins: [] };
  const deletes = { cards: [] };

  const cardsTable = {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: slugClash ? { slug: 'p-clash' } : null, error: null }) })) })),
    insert: vi.fn((row) => { inserts.cards.push(row); return Promise.resolve({ error: cardInsertErr }); }),
    delete: vi.fn(() => ({ eq: vi.fn((c, v) => { deletes.cards.push(v); return Promise.resolve({ error: null }); }) })),
  };
  const seasonsTable = { insert: vi.fn((row) => { inserts.member_club_seasons.push(row); return Promise.resolve({ error: seasonInsertErr }); }) };
  const adminsTable = { insert: vi.fn((rows) => { inserts.card_admins.push(rows); return Promise.resolve({ error: adminInsertErr }); }) };
  const categoriesTable = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: categories, error: null }) };

  const db = { from: vi.fn((t) => {
    if (t === 'cards') return cardsTable;
    if (t === 'member_club_seasons') return seasonsTable;
    if (t === 'card_admins') return adminsTable;
    if (t === 'sports_categories') return categoriesTable;
    return {};
  }) };
  return { db, inserts, deletes };
}

const ORG = { id: 'club-1', sport: 'futbol' };
const BASE = { nombre: 'Leo Pérez', birthDate: '2012-05-10', season: '2025-26', tutors: [{ email: 'madre@example.com' }] };

describe('makePlayerSlug', () => {
  it('formato opaco p-xxxxxxxx', () => {
    expect(makePlayerSlug()).toMatch(/^p-[0-9a-f]{8}$/);
  });
});

describe('createPlayerCard · happy path', () => {
  beforeEach(() => { delete process.env.CANTERA_PII_KEY; });
  afterEach(() => { delete process.env.CANTERA_PII_KEY; });

  it('crea card player + membership + tutor con categoría resuelta', async () => {
    const { db, inserts } = makeDb();
    const r = await createPlayerCard(db, ORG, { ...BASE, dorsal: 10, position: 'Delantero', teamName: 'Infantil A' });
    expect(r.ok).toBe(true);
    expect(r.slug).toMatch(/^p-[0-9a-f]{8}$/);
    expect(r.card_kind).toBe('player');
    expect(r.season).toBe('2025-26');
    expect(r.category_id).toBe('cat-infantil');

    const card = inserts.cards[0];
    expect(card.card_kind).toBe('player');
    expect(card.public_card).toBe(false);
    expect(card.birth_year).toBe(2012);
    expect(card.organization_id).toBe('club-1');

    const ms = inserts.member_club_seasons[0];
    expect(ms).toMatchObject({ card_slug: r.slug, role: 'jugador', dorsal: 10, category_id: 'cat-infantil', season: '2025-26' });

    expect(inserts.card_admins[0]).toHaveLength(1);
    expect(inserts.card_admins[0][0]).toMatchObject({ email: 'madre@example.com', role: 'tutor_legal' });
    expect(inserts.card_admins[0][0].edit_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persiste puente federativo y direccion cuando vienen', async () => {
    const { db, inserts } = makeDb();
    await createPlayerCard(db, ORG, { ...BASE, docKind: 'libro_familia', docNumber: 'LF-9', nationality: 'Española', direccion: 'Calle X 1' });
    expect(inserts.cards[0]).toMatchObject({ doc_kind: 'libro_familia', doc_number: 'LF-9', nationality: 'Española', direccion: 'Calle X 1' });
  });

  it('publicCard:true se respeta (self-service con consentimiento)', async () => {
    const { db, inserts } = makeDb();
    await createPlayerCard(db, ORG, { ...BASE, publicCard: true });
    expect(inserts.cards[0].public_card).toBe(true);
  });

  it('dos tutores → tutor_legal + tutor_secundario con datos', async () => {
    const { db, inserts } = makeDb();
    await createPlayerCard(db, ORG, { ...BASE, tutors: [
      { email: 'madre@example.com', name: 'Ana', dni: '11111111H', phone: '600100200' },
      { email: 'padre@example.com', role: 'tutor_secundario' },
    ] });
    const rows = inserts.card_admins[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'tutor_legal', name: 'Ana', dni: '11111111H', phone: '600100200' });
    expect(rows[1]).toMatchObject({ email: 'padre@example.com', role: 'tutor_secundario' });
  });

  it('staff: club_staff, sin dorsal ni categoría', async () => {
    const { db, inserts } = makeDb();
    const r = await createPlayerCard(db, ORG, { nombre: 'Ana Coach', role: 'entrenador', season: '2025-26', tutors: [{ email: 'ana@example.com' }] });
    expect(r.card_kind).toBe('club_staff');
    expect(inserts.cards[0].card_kind).toBe('club_staff');
    expect(inserts.member_club_seasons[0].dorsal).toBeNull();
    expect(inserts.member_club_seasons[0].category_id).toBeNull();
  });

  it('deduplica tutores con el mismo email', async () => {
    const { db, inserts } = makeDb();
    await createPlayerCard(db, ORG, { ...BASE, tutors: [{ email: 'm@e.com' }, { email: 'm@e.com' }] });
    expect(inserts.card_admins[0]).toHaveLength(1);
  });
});

describe('createPlayerCard · compensación', () => {
  it('falla card → ok:false stage card, no borra', async () => {
    const { db, deletes } = makeDb({ cardInsertErr: { message: 'boom' } });
    const r = await createPlayerCard(db, ORG, BASE);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('card');
    expect(deletes.cards).toHaveLength(0);
  });
  it('falla membership → borra la card, stage membership', async () => {
    const { db, deletes } = makeDb({ seasonInsertErr: { message: 'boom' } });
    const r = await createPlayerCard(db, ORG, BASE);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('membership');
    expect(deletes.cards).toHaveLength(1);
  });
  it('falla admins → borra la card, stage admins', async () => {
    const { db, deletes } = makeDb({ adminInsertErr: { message: 'dup' } });
    const r = await createPlayerCard(db, ORG, BASE);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('admins');
    expect(deletes.cards).toHaveLength(1);
  });
});
