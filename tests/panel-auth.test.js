import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildPanelLoginEmail } from '../netlify/functions/panel-auth.js';
import {
  signPanelSession,
  verifyPanelSession,
  authFromEvent,
} from '../netlify/functions/lib/panel-auth.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// --- Mocks ---

const mockMaybeSingle = vi.fn();
const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

function makeOrgChain(data) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return chain;
}

let lastOrgChain;
const mockDb = {
  from: vi.fn(() => {
    lastOrgChain = makeOrgChain(mockMaybeSingle.mockResultValue);
    return lastOrgChain;
  }),
};

function buildEvent({ method = 'POST', body = {}, ip = '1.2.3.4' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

describe('signPanelSession / verifyPanelSession', () => {
  beforeEach(() => {
    process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
  });

  it('firma y verifica un JWT con orgId + orgSlug + purpose', () => {
    const token = signPanelSession({ orgId: 'uuid-1', orgSlug: 'acme' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
    const decoded = verifyPanelSession(token);
    expect(decoded).toEqual({ orgId: 'uuid-1', orgSlug: 'acme' });
  });

  it('rechaza token con purpose distinto (no admite reuso de agent-auth)', () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'agent-auth', orgId: 'uuid-1', orgSlug: 'acme' },
      'test-org-panel-secret',
      { expiresIn: '7d' }
    );
    expect(verifyPanelSession(bad)).toBeNull();
  });

  it('rechaza token firmado con otro secreto', () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'org-panel', orgId: 'uuid-1', orgSlug: 'acme' },
      'otro-secreto-distinto',
      { expiresIn: '7d' }
    );
    expect(verifyPanelSession(bad)).toBeNull();
  });

  it('rechaza token expirado', () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'org-panel', orgId: 'uuid-1', orgSlug: 'acme' },
      'test-org-panel-secret',
      { expiresIn: '-1s' }
    );
    expect(verifyPanelSession(bad)).toBeNull();
  });

  it('rechaza token sin orgId u orgSlug aunque purpose sea correcto', () => {
    const jwt = require('jsonwebtoken');
    const bad = jwt.sign(
      { purpose: 'org-panel' },
      'test-org-panel-secret',
      { expiresIn: '7d' }
    );
    expect(verifyPanelSession(bad)).toBeNull();
  });

  it('rechaza inputs no-string', () => {
    expect(verifyPanelSession(null)).toBeNull();
    expect(verifyPanelSession(undefined)).toBeNull();
    expect(verifyPanelSession(123)).toBeNull();
  });

  it('signPanelSession exige orgId y orgSlug', () => {
    expect(() => signPanelSession({})).toThrow();
    expect(() => signPanelSession({ orgId: 'x' })).toThrow();
    expect(() => signPanelSession({ orgSlug: 'y' })).toThrow();
  });
});

describe('authFromEvent', () => {
  beforeEach(() => {
    process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
  });

  it('extrae sesión válida desde "Authorization: Bearer <jwt>"', () => {
    const token = signPanelSession({ orgId: 'uuid-1', orgSlug: 'acme' });
    const result = authFromEvent({ headers: { authorization: `Bearer ${token}` } });
    expect(result).toEqual({ orgId: 'uuid-1', orgSlug: 'acme' });
  });

  it('acepta el header con capitalización "Authorization"', () => {
    const token = signPanelSession({ orgId: 'uuid-1', orgSlug: 'acme' });
    const result = authFromEvent({ headers: { Authorization: `Bearer ${token}` } });
    expect(result).toEqual({ orgId: 'uuid-1', orgSlug: 'acme' });
  });

  it('devuelve null si no hay header', () => {
    expect(authFromEvent({ headers: {} })).toBeNull();
    expect(authFromEvent({})).toBeNull();
  });

  it('devuelve null si el header no es Bearer', () => {
    expect(authFromEvent({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(authFromEvent({ headers: { authorization: 'token123' } })).toBeNull();
  });

  it('devuelve null si el JWT es inválido', () => {
    expect(authFromEvent({ headers: { authorization: 'Bearer not-a-jwt' } })).toBeNull();
  });
});

describe('panel-auth handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.ORG_PANEL_JWT_SECRET = 'test-org-panel-secret';
    process.env.SITE_URL = 'https://perfilapro.es';

    mockEmailSend.mockResolvedValue({ id: 'msg-1' });
    mockMaybeSingle.mockResultValue = null;
    mockDb.from.mockImplementation(() => {
      lastOrgChain = makeOrgChain(mockMaybeSingle.mockResultValue);
      return lastOrgChain;
    });

    handler = makeHandler(mockDb, mockEmail);
  });

  it('rechaza GET con 405', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('rechaza body no-JSON con 400', async () => {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-forwarded-for': '1.2.3.4' },
      body: 'not-json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza email vacío con 400', async () => {
    const res = await handler(buildEvent({ body: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('rechaza email con formato inválido con 400', async () => {
    const res = await handler(buildEvent({ body: { email: 'no-es-email' } }));
    expect(res.statusCode).toBe(400);
  });

  it('envía email y devuelve 200 cuando la org existe', async () => {
    mockMaybeSingle.mockResultValue = { id: 'uuid-1', slug: 'acme', name: 'Acme' };
    const res = await handler(buildEvent({ body: { email: 'admin@acme.com' }, ip: '1.2.3.5' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();

    const callArgs = mockEmailSend.mock.calls[0][0];
    expect(callArgs.to).toBe('admin@acme.com');
    expect(callArgs.subject).toContain('Acme');
    expect(callArgs.html).toContain('/panel.html?session=');
    // El JWT en la URL debe verificar correctamente
    const match = /session=([^"&]+)/.exec(callArgs.html);
    expect(match).not.toBeNull();
    const decoded = verifyPanelSession(match[1]);
    expect(decoded).toEqual({ orgId: 'uuid-1', orgSlug: 'acme' });
  });

  it('devuelve 200 sin enviar email si la org NO existe (anti-enumeration)', async () => {
    mockMaybeSingle.mockResultValue = null;
    const res = await handler(buildEvent({ body: { email: 'fantasma@nadie.com' }, ip: '1.2.3.6' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('normaliza email a lowercase + trim antes del lookup', async () => {
    mockMaybeSingle.mockResultValue = { id: 'uuid-1', slug: 'acme', name: 'Acme' };
    await handler(buildEvent({ body: { email: '  ADMIN@ACME.COM  ' }, ip: '1.2.3.7' }));
    expect(lastOrgChain.eq).toHaveBeenCalledWith('email', 'admin@acme.com');
  });

  it('respeta idioma=ca en el subject y el body', async () => {
    mockMaybeSingle.mockResultValue = { id: 'uuid-1', slug: 'acme', name: 'Acme' };
    await handler(buildEvent({ body: { email: 'admin@acme.com', idioma: 'ca' }, ip: '1.2.3.8' }));
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.subject).toContain('panell');
    expect(call.html).toContain('Entrar al panell');
  });

  it('default idioma es español', async () => {
    mockMaybeSingle.mockResultValue = { id: 'uuid-1', slug: 'acme', name: 'Acme' };
    await handler(buildEvent({ body: { email: 'admin@acme.com' }, ip: '1.2.3.9' }));
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.subject).toContain('panel');
    expect(call.html).toContain('Entrar al panel');
  });

  it('devuelve 200 aunque Resend falle (no expone error al cliente)', async () => {
    mockMaybeSingle.mockResultValue = { id: 'uuid-1', slug: 'acme', name: 'Acme' };
    mockEmailSend.mockRejectedValue(new Error('Resend down'));
    const res = await handler(buildEvent({ body: { email: 'admin@acme.com' }, ip: '1.2.3.10' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('rate-limita después de 5 requests en 10min desde la misma IP', async () => {
    mockMaybeSingle.mockResultValue = null;
    const ip = '5.5.5.5';
    for (let i = 0; i < 5; i++) {
      const res = await handler(buildEvent({ body: { email: `t${i}@test.com` }, ip }));
      expect(res.statusCode).toBe(200);
    }
    const res = await handler(buildEvent({ body: { email: 't6@test.com' }, ip }));
    expect(res.statusCode).toBe(429);
  });
});

describe('buildPanelLoginEmail', () => {
  it('genera HTML con la URL del panel + nombre de org', () => {
    const html = buildPanelLoginEmail({
      orgName: 'Acme S.A.',
      panelUrl: 'https://perfilapro.es/panel.html?session=eyJabc',
      idioma: 'es',
    });
    expect(html).toContain('Acme S.A.');
    expect(html).toContain('https://perfilapro.es/panel.html?session=eyJabc');
    expect(html).toContain('Entrar al panel');
  });

  it('traduce a catalán cuando idioma=ca', () => {
    const html = buildPanelLoginEmail({
      orgName: 'Acme',
      panelUrl: 'https://perfilapro.es/panel.html?session=x',
      idioma: 'ca',
    });
    expect(html).toContain('Entrar al panell');
    expect(html).toContain('vàlid');
  });
});
