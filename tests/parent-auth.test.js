import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHandler, buildParentLoginEmail, PARENT_ROLES } from '../netlify/functions/parent-auth.js';
import {
  signParentSession,
  verifyParentSession,
  parentAuthFromEvent,
  signPanelSession,
  verifyPanelSession,
} from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// --- lib: sesión parent-panel -------------------------------------

describe('signParentSession / verifyParentSession', () => {
  beforeEach(() => {
    process.env.PARENT_PANEL_JWT_SECRET = 'test-parent-secret';
  });
  afterEach(() => {
    delete process.env.PARENT_PANEL_JWT_SECRET;
  });

  it('firma y verifica un JWT con email + purpose, normalizando el email', () => {
    const token = signParentSession({ email: '  Padre@Club.ES ' });
    expect(token.split('.').length).toBe(3);
    expect(verifyParentSession(token)).toEqual({ email: 'padre@club.es' });
  });

  it('lanza sin email', () => {
    expect(() => signParentSession({})).toThrow();
    expect(() => signParentSession({ email: '   ' })).toThrow();
  });

  it('verify devuelve null con basura o token de otro secreto', () => {
    expect(verifyParentSession('no-es-jwt')).toBeNull();
    expect(verifyParentSession(null)).toBeNull();
  });
});

describe('aislamiento de purpose org-panel ↔ parent-panel', () => {
  beforeEach(() => {
    // Mismo secreto en ambos para probar que el aislamiento es por el
    // claim `purpose`, no por la firma.
    process.env.ORG_PANEL_JWT_SECRET = 'shared';
    process.env.PARENT_PANEL_JWT_SECRET = 'shared';
  });
  afterEach(() => {
    delete process.env.ORG_PANEL_JWT_SECRET;
    delete process.env.PARENT_PANEL_JWT_SECRET;
  });

  it('un token de org NO verifica como parent', () => {
    const orgToken = signPanelSession({ orgId: 'o1', orgSlug: 'acme' });
    expect(verifyParentSession(orgToken)).toBeNull();
  });

  it('un token de parent NO verifica como org', () => {
    const parentToken = signParentSession({ email: 'p@c.es' });
    expect(verifyPanelSession(parentToken)).toBeNull();
  });
});

describe('parentAuthFromEvent', () => {
  beforeEach(() => { process.env.PARENT_PANEL_JWT_SECRET = 'test-parent-secret'; });
  afterEach(() => { delete process.env.PARENT_PANEL_JWT_SECRET; });

  it('extrae el email de un Bearer válido', () => {
    const token = signParentSession({ email: 'p@c.es' });
    const ev = { headers: { authorization: `Bearer ${token}` } };
    expect(parentAuthFromEvent(ev)).toEqual({ email: 'p@c.es' });
  });
  it('null sin header o sin Bearer', () => {
    expect(parentAuthFromEvent({ headers: {} })).toBeNull();
    expect(parentAuthFromEvent({ headers: { authorization: 'Basic xyz' } })).toBeNull();
  });
});

// --- endpoint parent-auth -----------------------------------------

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

// Chain de card_admins: select().eq().is().in().limit() → {data,error}
function makeDb(adminRows) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: adminRows, error: null }),
  };
  return { from: vi.fn(() => chain), _chain: chain };
}

function buildEvent({ method = 'POST', body = {}, ip = '9.9.9.9' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

describe('parent-auth endpoint', () => {
  beforeEach(() => {
    _resetRateLimit();
    mockEmailSend.mockReset();
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
  });
  afterEach(() => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
  });

  it('410 Gone cuando el carril está apagado', async () => {
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    const handler = makeHandler(makeDb([{ id: 'a1' }]), mockEmail);
    const res = await handler(buildEvent({ body: { email: 'p@c.es' } }));
    expect(res.statusCode).toBe(410);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('405 si no es POST', async () => {
    const handler = makeHandler(makeDb([]), mockEmail);
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('400 con email inválido', async () => {
    const handler = makeHandler(makeDb([]), mockEmail);
    const res = await handler(buildEvent({ body: { email: 'no-es-email' } }));
    expect(res.statusCode).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('200 + envía magic-link cuando hay un tutor activo', async () => {
    const db = makeDb([{ id: 'admin-1' }]);
    const handler = makeHandler(db, mockEmail);
    const res = await handler(buildEvent({ body: { email: 'Padre@Club.es', idioma: 'ca' } }));
    expect(res.statusCode).toBe(200);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.to).toBe('padre@club.es');
    expect(sent.html).toContain('panel.html?session=');
    // filtra por roles tutor/jugador (no club_admin)
    expect(db._chain.in).toHaveBeenCalledWith('role', PARENT_ROLES);
  });

  it('200 SIN enviar cuando el email no es admin (anti-enumeration)', async () => {
    const handler = makeHandler(makeDb([]), mockEmail);
    const res = await handler(buildEvent({ body: { email: 'desconocido@x.es' } }));
    expect(res.statusCode).toBe(200);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('429 al superar el rate-limit por IP', async () => {
    const handler = makeHandler(makeDb([]), mockEmail);
    let last;
    for (let i = 0; i < 7; i++) {
      last = await handler(buildEvent({ body: { email: 'p@c.es' }, ip: '5.5.5.5' }));
    }
    expect(last.statusCode).toBe(429);
  });
});

describe('buildParentLoginEmail', () => {
  it('renderiza es y ca con el panelUrl', () => {
    const es = buildParentLoginEmail({ panelUrl: 'https://x/panel.html?session=abc', idioma: 'es' });
    expect(es).toContain('panel.html?session=abc');
    expect(es).toContain('hijo/a');
    const ca = buildParentLoginEmail({ panelUrl: 'https://x/panel.html?session=abc', idioma: 'ca' });
    expect(ca).toContain('fill/a');
  });
});
