import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as cantera from '../netlify/functions/lib/cantera-incidents.js';
import { makeHandler } from '../netlify/functions/admin-orgs.js';

const resolve = (v) => () => Promise.resolve(v);
const PII_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ───────────────────────── lib ─────────────────────────

describe('playerOverview', () => {
  function ovDb({ card, memberships = [], admins = [], consents = [], transfers = [] }) {
    return {
      from: (t) => {
        if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
        if (t === 'member_club_seasons') return { select: () => ({ eq: () => ({ order: resolve({ data: memberships, error: null }) }) }) };
        if (t === 'card_admins') return { select: () => ({ eq: resolve({ data: admins, error: null }) }) };
        if (t === 'card_consents') return { select: () => ({ eq: () => ({ order: resolve({ data: consents, error: null }) }) }) };
        if (t === 'club_transfers') return { select: () => ({ eq: () => ({ order: resolve({ data: transfers, error: null }) }) }) };
        return {};
      },
    };
  }

  it('null si la card no existe', async () => {
    expect(await cantera.playerOverview(ovDb({ card: null }), 'p-x')).toBeNull();
  });

  it('agrega card + memberships + admins + consents + transfers', async () => {
    const db = ovDb({
      card: { slug: 'p-1', nombre: 'Leo' },
      memberships: [{ id: 'm1' }], admins: [{ id: 'a1' }], consents: [{ id: 'c1' }], transfers: [{ id: 't1' }],
    });
    const out = await cantera.playerOverview(db, 'p-1');
    expect(out.card.slug).toBe('p-1');
    expect(out.memberships).toHaveLength(1);
    expect(out.admins).toHaveLength(1);
    expect(out.consents).toHaveLength(1);
    expect(out.transfers).toHaveLength(1);
  });
});

describe('editMembership', () => {
  function db(captureErr = null) {
    const patches = [];
    return {
      patches,
      from: () => ({ update: (p) => { patches.push(p); return { eq: () => ({ is: resolve({ error: captureErr }) }) }; } }),
    };
  }
  it('rechaza dorsal inválido', async () => {
    const { error } = await cantera.editMembership(db(), 'm1', { dorsal: 1000 });
    expect(error.message).toMatch(/dorsal/);
  });
  it('rechaza patch vacío', async () => {
    const { error } = await cantera.editMembership(db(), 'm1', {});
    expect(error.message).toMatch(/nada/);
  });
  it('aplica los campos válidos', async () => {
    const d = db();
    const { error, patch } = await cantera.editMembership(d, 'm1', { dorsal: 9, team_name: 'Cadete A' });
    expect(error).toBeNull();
    expect(patch).toEqual({ dorsal: 9, team_name: 'Cadete A' });
  });
});

describe('closeMembership', () => {
  it('rechaza exit_reason inválido sin tocar BD', async () => {
    const rpc = vi.fn();
    const { error } = await cantera.closeMembership({ rpc }, 'p-1', 'fugado');
    expect(error.message).toMatch(/exit_reason/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('llama a la RPC con reason válido', async () => {
    const rpc = vi.fn(resolve({ data: { ok: true }, error: null }));
    const { error } = await cantera.closeMembership({ rpc }, 'p-1', 'baja');
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledWith('cantera_close_membership', expect.objectContaining({ p_card_slug: 'p-1', p_exit_reason: 'baja' }));
  });
});

describe('reassignClub', () => {
  function db({ active, rpc = { data: { ok: true }, error: null }, insErr = null } = {}) {
    return {
      from: (t) => {
        if (t === 'member_club_seasons') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: active, error: null }) }) }) }) }) };
        if (t === 'club_transfers') return { insert: () => ({ select: () => ({ single: resolve(insErr ? { data: null, error: insErr } : { data: { id: 'tr-x' }, error: null }) }) }) };
        return {};
      },
      rpc: vi.fn(resolve(rpc)),
    };
  }
  it('error si no hay membresía activa', async () => {
    const { error } = await cantera.reassignClub(db({ active: null }), { cardSlug: 'p-1', toOrgId: 'B', season: '2025-26' });
    expect(error.message).toMatch(/activa/);
  });
  it('error si ya pertenece al club destino', async () => {
    const { error } = await cantera.reassignClub(db({ active: { organization_id: 'B' } }), { cardSlug: 'p-1', toOrgId: 'B', season: '2025-26' });
    expect(error.message).toMatch(/ya pertenece/);
  });
  it('crea transfer y ejecuta RPC atómica', async () => {
    const d = db({ active: { organization_id: 'A' } });
    const { error } = await cantera.reassignClub(d, { cardSlug: 'p-1', toOrgId: 'B', season: '2025-26' });
    expect(error).toBeNull();
    expect(d.rpc).toHaveBeenCalledWith('cantera_execute_transfer', expect.objectContaining({ p_actor_role: 'founder' }));
  });
});

describe('addAdmin', () => {
  function db() { return { from: () => ({ insert: () => ({ select: () => ({ single: resolve({ data: { id: 'a-new' }, error: null }) }) }) }) }; }
  it('rechaza email inválido', async () => {
    expect((await cantera.addAdmin(db(), { cardSlug: 'p-1', email: 'x', role: 'tutor_legal' })).error.message).toMatch(/email/);
  });
  it('rechaza role inválido', async () => {
    expect((await cantera.addAdmin(db(), { cardSlug: 'p-1', email: 'a@b.es', role: 'jefe' })).error.message).toMatch(/role/);
  });
  it('inserta con email normalizado', async () => {
    const { data, error } = await cantera.addAdmin(db(), { cardSlug: 'p-1', email: 'A@B.ES', role: 'tutor_secundario' });
    expect(error).toBeNull();
    expect(data.id).toBe('a-new');
  });
});

describe('revealBirthDate', () => {
  afterEach(() => { delete process.env.CANTERA_PII_KEY; });
  function db(card) { return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) }) }; }

  it('descifra cuando hay PII key', async () => {
    process.env.CANTERA_PII_KEY = PII_KEY;
    const { encryptBirthDate } = require('../netlify/functions/lib/pii-crypto.js');
    const enc = encryptBirthDate('2012-05-10');
    const { data } = await cantera.revealBirthDate(db({ birth_date_encrypted: enc, birth_year: 2012 }), 'p-1');
    expect(data.birth_date).toBe('2012-05-10');
    expect(data.birth_year).toBe(2012);
  });
  it('birth_date null sin PII key, pero devuelve birth_year', async () => {
    delete process.env.CANTERA_PII_KEY;
    const { data } = await cantera.revealBirthDate(db({ birth_date_encrypted: '\\xabcd', birth_year: 2012 }), 'p-1');
    expect(data.birth_date).toBeNull();
    expect(data.birth_year).toBe(2012);
  });
  it('error si la card no existe', async () => {
    expect((await cantera.revealBirthDate(db(null), 'p-x')).error.message).toMatch(/no encontrada/);
  });
});

describe('deletePlayer', () => {
  it('soft → deleted_at via update', async () => {
    const calls = [];
    const db = { from: () => ({ update: (p) => { calls.push(['update', p]); return { eq: resolve({ error: null }) }; }, delete: () => { calls.push(['delete']); return { eq: resolve({ error: null }) }; } }) };
    const { mode } = await cantera.deletePlayer(db, 'p-1');
    expect(mode).toBe('soft');
    expect(calls[0][0]).toBe('update');
    expect(calls[0][1]).toHaveProperty('deleted_at');
  });
  it('hard → delete', async () => {
    const calls = [];
    const db = { from: () => ({ update: () => ({ eq: resolve({ error: null }) }), delete: () => { calls.push('delete'); return { eq: resolve({ error: null }) }; } }) };
    const { mode } = await cantera.deletePlayer(db, 'p-1', { hard: true });
    expect(mode).toBe('hard');
    expect(calls).toContain('delete');
  });
});

// ─────────────────── admin-orgs wiring (auth founder) ───────────────────

describe('admin-orgs · acciones cantera_ (wiring)', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;
  });

  function adminEvent(body) {
    return { httpMethod: 'POST', headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify(body) };
  }

  it('cantera_set_visibility actualiza public_card y audita', async () => {
    const audits = [];
    const db = {
      from: (t) => {
        if (t === 'admin_audit_log') return { insert: (row) => { audits.push(row); return Promise.resolve({ error: null }); } };
        if (t === 'cards') return { update: () => ({ eq: resolve({ error: null }) }) };
        return {};
      },
    };
    const res = await makeHandler(db)(adminEvent({ action: 'cantera_set_visibility', card_slug: 'p-1', public_card: true }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).public_card).toBe(true);
    expect(audits[0].action).toBe('cantera_set_visibility');
  });

  it('cantera_delete_player soft devuelve mode soft', async () => {
    const db = {
      from: (t) => {
        if (t === 'admin_audit_log') return { insert: () => Promise.resolve({ error: null }) };
        if (t === 'cards') return { update: () => ({ eq: resolve({ error: null }) }) };
        return {};
      },
    };
    const res = await makeHandler(db)(adminEvent({ action: 'cantera_delete_player', card_slug: 'p-1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).mode).toBe('soft');
  });

  it('cantera_player_overview 404 si no existe', async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: resolve({ data: null, error: null }) }) }) }) };
    const res = await makeHandler(db)(adminEvent({ action: 'cantera_player_overview', card_slug: 'p-x' }));
    expect(res.statusCode).toBe(404);
  });

  it('cantera_edit_membership 400 sin membership_id', async () => {
    const res = await makeHandler({ from: () => ({}) })(adminEvent({ action: 'cantera_edit_membership' }));
    expect(res.statusCode).toBe(400);
  });

  it('401 sin auth admin', async () => {
    const res = await makeHandler({ from: () => ({}) })({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'cantera_set_visibility', card_slug: 'p-1' }) });
    expect(res.statusCode).toBe(401);
  });

  it('cantera_close_membership (baja) cierra y desconecta el cobro del jugador', async () => {
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    const subsUpdateEq = vi.fn(resolve({ error: null }));
    const db = {
      from: (t) => {
        if (t === 'admin_audit_log') return { insert: () => Promise.resolve({ error: null }) };
        if (t === 'member_club_seasons') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: { organization_id: 'orgZ' }, error: null }) }) }) }) }) };
        if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: { stripe_connect_account_id: 'acct_z' }, error: null }) }) }) };
        if (t === 'enrollment_charges') return { update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: resolve({ data: [{ id: 'c1' }], error: null }) }) }) }) }) };
        if (t === 'parent_subscriptions') return {
          select: () => ({ eq: () => ({ eq: () => ({ in: resolve({ data: [{ id: 's1', stripe_subscription_id: 'sub_z', status: 'active' }], error: null }) }) }) }),
          update: () => ({ eq: subsUpdateEq }),
        };
        return {};
      },
      rpc: resolve({ data: { ok: true }, error: null }),
    };
    const stripe = { subscriptions: { cancel: vi.fn(() => Promise.resolve({ status: 'canceled' })) } };
    const res = await makeHandler(db, null, stripe)(adminEvent({ action: 'cantera_close_membership', card_slug: 'p-1', exit_reason: 'baja_voluntaria' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).billing).toEqual({ charges_canceled: 1, subs_canceled: 1, sub_errors: 0 });
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_z', { stripeAccount: 'acct_z' });
    delete process.env.CANTERA_VERTICAL_ACTIVE;
  });
});
