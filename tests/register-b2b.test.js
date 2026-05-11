import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildB2BWelcomeEmail } from '../netlify/functions/register-b2b.js';
const { _resetRateLimit } = require('../netlify/functions/lib/rate-limit.js');

// --- Mocks ---

const mockCardSlugMaybeSingle = vi.fn();
const mockPostalMaybeSingle   = vi.fn();
const mockLeadMaybeSingle     = vi.fn();
const mockOrgMaybeSingle      = vi.fn();
const mockLeadUpdateIs        = vi.fn();
const mockInsert              = vi.fn();
const mockFrom                = vi.fn();

const mockEmailSend = vi.fn();
const mockEmail    = { emails: { send: mockEmailSend } };

const validToken = 'a'.repeat(48);
const validOrgId = '11111111-2222-3333-4444-555555555555';

function selectChain(maybeSingle) {
  const b = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle };
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.is.mockReturnValue(b);
  return b;
}
function updateChain(finalIs) {
  const b = { update: vi.fn(), eq: vi.fn(), is: finalIs };
  b.update.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  return b;
}

function buildEvent({ method = 'POST', body = {}, ip = '5.5.5.5' } = {}) {
  return {
    httpMethod: method,
    body:       typeof body === 'string' ? body : JSON.stringify(body),
    headers:    { 'x-forwarded-for': ip },
  };
}

const validBody = {
  nombre: 'Carlos García',
  whatsapp: '600111222',
  cp: '03001',
  email: 'carlos@empresa.com',
  redeemed_token: validToken,
};

describe('register-b2b handler', () => {
  let handler;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRateLimit();
    process.env.SITE_URL = 'https://perfilapro.es';

    // Lead pendiente sin org pre-asignada (caso por defecto).
    mockLeadMaybeSingle.mockResolvedValue({
      data: { id: 'lead-1', organization_id: null, redeemed_at: null },
      error: null,
    });
    mockOrgMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCardSlugMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPostalMaybeSingle.mockResolvedValue({
      data: { cp: '03001', municipality_name: 'Alicante', province_slug: 'alicante' },
      error: null,
    });
    mockInsert.mockResolvedValue({ error: null });
    mockLeadUpdateIs.mockResolvedValue({ error: null });
    mockEmailSend.mockResolvedValue({ id: 'm1' });

    mockFrom.mockImplementation((table) => {
      if (table === 'cards') {
        const c = selectChain(mockCardSlugMaybeSingle);
        c.insert = mockInsert;
        return c;
      }
      if (table === 'postal_codes')   return selectChain(mockPostalMaybeSingle);
      if (table === 'organizations')  return selectChain(mockOrgMaybeSingle);
      if (table === 'b2b_leads') {
        // El handler hace tanto SELECT (verificar token) como UPDATE (marcar
        // redimido) sobre la misma tabla. Devolvemos un builder hibrido que
        // expone ambos verbos.
        const sel = selectChain(mockLeadMaybeSingle);
        const upd = updateChain(mockLeadUpdateIs);
        return {
          select: sel.select,
          update: upd.update,
          // estos eq/is/maybeSingle se comparten — los pre-pegados al chain
          // anterior se invocan según la ruta (select vs update).
          eq: function(...args) {
            // Si la última operación fue update(), enrutamos al chain de update.
            return upd.update.mock.calls.length > sel.select.mock.calls.length
              ? upd.eq(...args)
              : sel.eq(...args);
          },
        };
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    handler = makeHandler({ from: mockFrom }, mockEmail);
  });

  // ── Validación de input ──────────────────────────────────────────
  it('405 si no es POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('400 si faltan campos obligatorios', async () => {
    const res = await handler(buildEvent({ body: { nombre: 'X' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/obligatorios/);
  });

  it('400 si falta redeemed_token (carril B2B siempre exige token)', async () => {
    const { redeemed_token, ...noToken } = validBody;
    const res = await handler(buildEvent({ body: noToken }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/token de invitación/i);
  });

  it('400 si redeemed_token tiene formato inválido', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, redeemed_token: 'no-hex' } }));
    expect(res.statusCode).toBe(400);
  });

  it('400 si CP fuera de rango', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, cp: '53000' } }));
    expect(res.statusCode).toBe(400);
  });

  it('400 si WhatsApp no es móvil español válido', async () => {
    const res = await handler(buildEvent({ body: { ...validBody, whatsapp: '12345' } }));
    expect(res.statusCode).toBe(400);
  });

  // ── Validación del lead ──────────────────────────────────────────
  it('404 si el lead no existe', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('410 si el lead ya está redimido', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({
      data: { id: 'lead-1', organization_id: null, redeemed_at: '2026-01-01T00:00:00Z' },
      error: null,
    });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(410);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('500 si la consulta del lead falla', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(500);
  });

  // ── Felicidad ────────────────────────────────────────────────────
  it('crea el perfil con plan=b2b, sin expires_at y devuelve slug + urls', async () => {
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.slug).toBe('carlos-garcia');
    expect(json.card_url).toContain('/c/carlos-garcia');
    expect(json.edit_url).toContain('/es/editar?slug=carlos-garcia&token=');

    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.plan).toBe('b2b');
    expect(insertCall.status).toBe('active');
    expect(insertCall.expires_at).toBeUndefined(); // sin expires_at, lo gestiona la suscripción
    expect(insertCall.email).toBe('carlos@empresa.com');
    expect(insertCall.edit_token).toHaveLength(64);
  });

  it('marca el lead como redimido tras crear la card', async () => {
    await handler(buildEvent({ body: validBody }));
    expect(mockLeadUpdateIs).toHaveBeenCalledWith('redeemed_at', null);
  });

  it('hereda organization_id del lead si el body no lo trae', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({
      data: { id: 'lead-1', organization_id: validOrgId, redeemed_at: null },
      error: null,
    });
    mockOrgMaybeSingle.mockResolvedValueOnce({ data: { id: validOrgId, name: 'Allianz' }, error: null });
    await handler(buildEvent({ body: validBody }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.organization_id).toBe(validOrgId);
  });

  it('el body puede pisar organization_id (admin override)', async () => {
    const otherOrgId = '22222222-3333-4444-5555-666666666666';
    mockLeadMaybeSingle.mockResolvedValueOnce({
      data: { id: 'lead-1', organization_id: validOrgId, redeemed_at: null },
      error: null,
    });
    mockOrgMaybeSingle.mockResolvedValueOnce({ data: { id: otherOrgId, name: 'Override Inc' }, error: null });
    await handler(buildEvent({ body: { ...validBody, organization_id: otherOrgId } }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.organization_id).toBe(otherOrgId);
  });

  it('omite organization_id si la org no existe o está soft-deleted', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({
      data: { id: 'lead-1', organization_id: validOrgId, redeemed_at: null },
      error: null,
    });
    mockOrgMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await handler(buildEvent({ body: validBody }));
    const insertCall = mockInsert.mock.calls[0][0];
    expect(insertCall.organization_id).toBeUndefined();
  });

  it('envía welcome email B2B (no autónomo) con copy adaptado a la org', async () => {
    mockLeadMaybeSingle.mockResolvedValueOnce({
      data: { id: 'lead-1', organization_id: validOrgId, redeemed_at: null },
      error: null,
    });
    mockOrgMaybeSingle.mockResolvedValueOnce({ data: { id: validOrgId, name: 'Allianz España' }, error: null });
    await handler(buildEvent({ body: validBody }));
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.to).toBe('carlos@empresa.com');
    expect(call.subject).toContain('Allianz España');
    expect(call.subject).not.toMatch(/9€/); // sin upsell del carril autónomo
    expect(call.html).toContain('Allianz España');
  });

  it('si la org no resuelve, el email sigue saliendo en versión neutra', async () => {
    await handler(buildEvent({ body: validBody }));
    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledOnce());
    const call = mockEmailSend.mock.calls[0][0];
    expect(call.subject).toMatch(/tu perfil profesional ya está activo/i);
  });

  it('500 si Supabase falla insertando la card', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'unique violation' } });
    const res = await handler(buildEvent({ body: validBody }));
    expect(res.statusCode).toBe(500);
    expect(mockLeadUpdateIs).not.toHaveBeenCalled(); // NO redimimos si la card falló
  });

  it('rate limit por IP (5 / 10 min)', async () => {
    for (let i = 0; i < 5; i++) {
      mockLeadMaybeSingle.mockResolvedValueOnce({
        data: { id: 'lead-' + i, organization_id: null, redeemed_at: null },
        error: null,
      });
      await handler(buildEvent({ body: { ...validBody, nombre: `Carlos ${i}` }, ip: '4.4.4.4' }));
    }
    const blocked = await handler(buildEvent({ body: validBody, ip: '4.4.4.4' }));
    expect(blocked.statusCode).toBe(429);
  });
});

describe('buildB2BWelcomeEmail', () => {
  it('copy ES con org', () => {
    const { subject, html } = buildB2BWelcomeEmail({
      nombre: 'Ana López', slug: 'ana-lopez', siteUrl: 'https://perfilapro.es',
      editToken: 'abc', orgName: 'Despacho X',
    });
    expect(subject).toContain('Despacho X');
    expect(html).toContain('Despacho X');
    expect(html).toContain('https://perfilapro.es/c/ana-lopez');
    expect(html).toContain('/es/editar?slug=ana-lopez&token=abc');
  });

  it('copy ES neutro cuando no hay org asignada', () => {
    const { subject } = buildB2BWelcomeEmail({
      nombre: 'Ana', slug: 'ana', siteUrl: 'https://perfilapro.es', editToken: 'abc',
    });
    expect(subject).toMatch(/tu perfil profesional/i);
  });

  it('copy CA respeta idioma', () => {
    const { subject, html } = buildB2BWelcomeEmail({
      nombre: 'Marta', slug: 'marta', siteUrl: 'https://perfilapro.es',
      editToken: 'abc', idioma: 'ca', orgName: 'Despatx Y',
    });
    expect(subject).toMatch(/dins de Despatx Y/);
    expect(html).toContain('/ca/editar?slug=marta&token=abc');
  });
});
