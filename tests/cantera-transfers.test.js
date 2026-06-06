import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler as makeRequest } from '../netlify/functions/request-transfer.js';
import { makeHandler as makeAccept } from '../netlify/functions/accept-transfer.js';
import { makeHandler as makeCancel } from '../netlify/functions/cancel-membership.js';
import { makeHandler as makeAdminOrgs } from '../netlify/functions/admin-orgs.js';
import { signPanelSession, signParentSession } from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// Terminal helpers para construir chains supabase-js de forma compacta.
const resolve = (v) => () => Promise.resolve(v);

beforeEach(() => {
  _resetRateLimit();
  process.env.CANTERA_VERTICAL_ACTIVE = '1';
  process.env.ORG_PANEL_JWT_SECRET = 'org-secret';
  process.env.PARENT_PANEL_JWT_SECRET = 'parent-secret';
});
afterEach(() => {
  delete process.env.CANTERA_VERTICAL_ACTIVE;
  delete process.env.ORG_PANEL_JWT_SECRET;
  delete process.env.PARENT_PANEL_JWT_SECRET;
});

function orgBearer(orgId = 'orgB', orgSlug = 'club-b') {
  return `Bearer ${signPanelSession({ orgId, orgSlug })}`;
}
function parentBearer(email = 'tutor@example.com') {
  return `Bearer ${signParentSession({ email })}`;
}
function ev({ method = 'POST', body = {}, auth, ip = '3.3.3.3' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (auth) headers.authorization = auth;
  return { httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

// ───────────────────────── request-transfer ─────────────────────────

function reqDb({
  toOrg = { id: 'orgB', slug: 'club-b', name: 'CD Bravo', kind: 'sports_club', sport: 'futbol', email: 'b@club.es', deleted_at: null },
  card = { slug: 'p-1', nombre: 'Leo', card_kind: 'player', idioma: 'es', organization_id: 'orgA', deleted_at: null },
  active = { id: 'ms-1', organization_id: 'orgA' },
  pending = null,
  insertErr = null,
  tutor = { email: 'tutor@example.com' },
  fromOrg = { name: 'CD Alfa' },
} = {}) {
  let orgCall = 0;
  return {
    from: vi.fn((t) => {
      if (t === 'organizations') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: orgCall++ === 0 ? toOrg : fromOrg, error: null }) }) }) };
      if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
      if (t === 'member_club_seasons') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: active, error: null }) }) }) }) }) };
      if (t === 'club_transfers') return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: resolve({ data: pending, error: null }) }) }) }),
        insert: () => ({ select: () => ({ single: resolve(insertErr ? { data: null, error: insertErr } : { data: { id: 'tr-1' }, error: null }) }) }),
      };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: tutor, error: null }) }) }) }) }) }) };
      return {};
    }),
  };
}

describe('request-transfer', () => {
  it('410 si el carril está off', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const res = await makeRequest(reqDb(), null)(ev({ auth: orgBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(410);
  });

  it('401 sin JWT', async () => {
    const res = await makeRequest(reqDb(), null)(ev({ body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('404 si la card no es player', async () => {
    const db = reqDb({ card: { slug: 'x', card_kind: 'autonomo', deleted_at: null } });
    const res = await makeRequest(db, null)(ev({ auth: orgBearer(), body: { card_slug: 'x' } }));
    expect(res.statusCode).toBe(404);
  });

  it('409 si el jugador no tiene club activo', async () => {
    const db = reqDb({ active: null });
    const res = await makeRequest(db, null)(ev({ auth: orgBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(409);
  });

  it('409 si el jugador ya es de mi club', async () => {
    const db = reqDb({ active: { id: 'ms', organization_id: 'orgB' } });
    const res = await makeRequest(db, null)(ev({ auth: orgBearer('orgB'), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(409);
  });

  it('409 si ya hay un traspaso pendiente', async () => {
    const db = reqDb({ pending: { id: 'tr-old' } });
    const res = await makeRequest(db, null)(ev({ auth: orgBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(409);
  });

  it('201 crea la solicitud pending', async () => {
    const db = reqDb();
    const res = await makeRequest(db, null)(ev({ auth: orgBearer(), body: { card_slug: 'p-1', season: '2025-26', dorsal: 9 } }));
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body);
    expect(out).toMatchObject({ ok: true, transfer_id: 'tr-1', status: 'pending', season: '2025-26' });
  });

  it('201 y avisa al tutor por email', async () => {
    const send = vi.fn();
    const db = reqDb();
    const res = await makeRequest(db, { emails: { send } })(ev({ auth: orgBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(201);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('tutor@example.com');
  });
});

// ───────────────────────── accept-transfer ─────────────────────────

function acceptDb({ transfer = { id: 'tr-1', card_slug: 'p-1', status: 'pending' }, admin = { id: 'a1' }, card = { birth_year: 2012, birth_date_encrypted: null }, rpc = { data: { ok: true, new_membership_id: 'ms-new', category_id: 'cat-x' }, error: null } } = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'club_transfers') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: transfer, error: null }) }) }) };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      if (t === 'cards') return { select: () => ({ eq: () => ({ maybeSingle: resolve({ data: card, error: null }) }) }) };
      return {};
    }),
    rpc: vi.fn(resolve(rpc)),
  };
}

// 2º factor por defecto (año coincide con birth_year del mock).
const BD = '2012-05-10';

describe('accept-transfer', () => {
  it('401 sin JWT parent', async () => {
    const res = await makeAccept(acceptDb(), null)(ev({ body: { transfer_id: 'tr-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('rechaza JWT org (purpose distinto) → 401', async () => {
    const res = await makeAccept(acceptDb(), null)(ev({ auth: orgBearer(), body: { transfer_id: 'tr-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('409 si el traspaso no está pendiente', async () => {
    const db = acceptDb({ transfer: { id: 'tr-1', card_slug: 'p-1', status: 'accepted' } });
    const res = await makeAccept(db, null)(ev({ auth: parentBearer(), body: { transfer_id: 'tr-1' } }));
    expect(res.statusCode).toBe(409);
  });

  it('403 si el email no es tutor_legal de la card', async () => {
    const db = acceptDb({ admin: null });
    const res = await makeAccept(db, null)(ev({ auth: parentBearer(), body: { transfer_id: 'tr-1' } }));
    expect(res.statusCode).toBe(403);
  });

  it('403 si la fecha de nacimiento (2º factor) no coincide', async () => {
    const db = acceptDb();
    const res = await makeAccept(db, null)(ev({ auth: parentBearer(), body: { transfer_id: 'tr-1', birth_date: '2000-01-01' } }));
    expect(res.statusCode).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('200 ejecuta la RPC atómica y devuelve la nueva membresía', async () => {
    const db = acceptDb();
    const res = await makeAccept(db, null)(ev({ auth: parentBearer(), body: { transfer_id: 'tr-1', birth_date: BD } }));
    expect(res.statusCode).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('cantera_execute_transfer', expect.objectContaining({ p_transfer_id: 'tr-1', p_actor_role: 'tutor_legal', p_actor_email: 'tutor@example.com' }));
    expect(JSON.parse(res.body).new_membership_id).toBe('ms-new');
  });

  it('mapea error de RPC transfer_not_pending → 409', async () => {
    const db = acceptDb({ rpc: { data: null, error: { message: 'transfer_not_pending' } } });
    const res = await makeAccept(db, null)(ev({ auth: parentBearer(), body: { transfer_id: 'tr-1', birth_date: BD } }));
    expect(res.statusCode).toBe(409);
  });
});

// ─────────────────────── cancel-membership ───────────────────────

function cancelDb({ active = { id: 'ms-1', role: 'jugador', organization_id: 'orgA' }, admin = { id: 'a1' }, rpc = { data: { ok: true }, error: null }, msUpdateErr = null } = {}) {
  const msUpdateEq = vi.fn(resolve({ error: msUpdateErr }));
  const cardsUpdateEq = vi.fn(resolve({ error: null }));
  const db = {
    from: vi.fn((t) => {
      if (t === 'member_club_seasons') return {
        select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: resolve({ data: active, error: null }) }) }) }) }),
        update: () => ({ eq: msUpdateEq }),
      };
      if (t === 'cards') return { update: () => ({ eq: cardsUpdateEq }) };
      if (t === 'card_admins') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: resolve({ data: admin, error: null }) }) }) }) }) }) }) };
      return {};
    }),
    rpc: vi.fn(resolve(rpc)),
  };
  db._msUpdateEq = msUpdateEq;
  db._cardsUpdateEq = cardsUpdateEq;
  return db;
}

describe('cancel-membership', () => {
  it('401 sin ninguna sesión', async () => {
    const res = await makeCancel(cancelDb())(ev({ body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('club: 401 si intenta cerrar a un jugador de otro club', async () => {
    const db = cancelDb({ active: { id: 'ms', organization_id: 'orgA' } });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('club: 200 cierra a su propio jugador vía RPC', async () => {
    const db = cancelDb({ active: { id: 'ms', role: 'jugador', organization_id: 'orgB' } });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 'p-1', exit_reason: 'fichaje' } }));
    expect(res.statusCode).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('cantera_close_membership', expect.objectContaining({ p_card_slug: 'p-1', p_exit_reason: 'fichaje' }));
  });

  it('tutor: 401 — el padre ya no puede dar de baja (lo tramita el club)', async () => {
    const db = cancelDb();
    const res = await makeCancel(db)(ev({ auth: parentBearer(), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('400 con exit_reason inválido', async () => {
    const res = await makeCancel(cancelDb())(ev({ auth: orgBearer('orgB'), body: { card_slug: 'p-1', exit_reason: 'fugado' } }));
    expect(res.statusCode).toBe(400);
  });

  it('409 si no hay membresía activa', async () => {
    const db = cancelDb({ active: null });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 'p-1' } }));
    expect(res.statusCode).toBe(409);
  });

  it('staff: 200 cierra al cuerpo técnico app-side (sin RPC)', async () => {
    const db = cancelDb({ active: { id: 'ms-s', role: 'entrenador', organization_id: 'orgB', season: '2025-26' } });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 's-1', exit_reason: 'cese_actividad' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).role).toBe('entrenador');
    // No pasa por la RPC (player-only); cierra la fila + limpia la card.
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db._msUpdateEq).toHaveBeenCalledWith('id', 'ms-s');
    expect(db._cardsUpdateEq).toHaveBeenCalledWith('slug', 's-1');
  });

  it('staff: 401 si intenta cerrar a un staff de otro club', async () => {
    const db = cancelDb({ active: { id: 'ms-s', role: 'delegado', organization_id: 'orgA' } });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 's-1' } }));
    expect(res.statusCode).toBe(401);
  });

  it('staff: 500 si el cierre de la fila falla', async () => {
    const db = cancelDb({ active: { id: 'ms-s', role: 'fisio', organization_id: 'orgB' }, msUpdateErr: { message: 'boom' } });
    const res = await makeCancel(db)(ev({ auth: orgBearer('orgB'), body: { card_slug: 's-1' } }));
    expect(res.statusCode).toBe(500);
  });
});

// ──────────────────── admin-orgs transfer_resolve ────────────────────

function adminEvent(body) {
  return { httpMethod: 'POST', headers: { 'x-admin-password': 'admin123', 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify(body) };
}
function adminDb({ transfer = { id: 'tr-1', status: 'pending' }, updateErr = null, rpc = { data: { ok: true, new_membership_id: 'ms-new' }, error: null } } = {}) {
  return {
    from: vi.fn((t) => {
      if (t === 'club_transfers') return {
        select: () => ({ eq: () => ({ maybeSingle: resolve({ data: transfer, error: null }) }) }),
        update: () => ({ eq: resolve({ error: updateErr }) }),
      };
      return {};
    }),
    rpc: vi.fn(resolve(rpc)),
  };
}

describe('admin-orgs · transfer_resolve (override founder)', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;
  });

  it('cancel marca el traspaso cancelado', async () => {
    const db = adminDb();
    const res = await makeAdminOrgs(db)(adminEvent({ action: 'transfer_resolve', transfer_id: 'tr-1', decision: 'cancel' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('cancelled');
  });

  it('force_accept ejecuta la RPC con rol founder', async () => {
    const db = adminDb();
    const res = await makeAdminOrgs(db)(adminEvent({ action: 'transfer_resolve', transfer_id: 'tr-1', decision: 'force_accept' }));
    expect(res.statusCode).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('cantera_execute_transfer', expect.objectContaining({ p_actor_role: 'founder' }));
  });

  it('400 con decision inválida', async () => {
    const res = await makeAdminOrgs(adminDb())(adminEvent({ action: 'transfer_resolve', transfer_id: 'tr-1', decision: 'maybe' }));
    expect(res.statusCode).toBe(400);
  });

  it('409 si el traspaso ya no está pendiente', async () => {
    const db = adminDb({ transfer: { id: 'tr-1', status: 'accepted' } });
    const res = await makeAdminOrgs(db)(adminEvent({ action: 'transfer_resolve', transfer_id: 'tr-1', decision: 'cancel' }));
    expect(res.statusCode).toBe(409);
  });
});
