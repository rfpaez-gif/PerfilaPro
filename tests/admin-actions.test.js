import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/admin-actions.js';

// --- Mocks ---

const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ eq: mockEqSelect }));
const mockEqSelect = vi.fn(() => ({ single: mockSingle }));
const mockEqUpdate = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn(() => Promise.resolve({ error: null }));

const mockMaybeSingle = vi.fn();
const mockCatEq2 = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockCatEq1 = vi.fn(() => ({ eq: mockCatEq2 }));
const mockCatSelect = vi.fn(() => ({ eq: mockCatEq1 }));

const mockRetrieve = vi.fn();
const mockRefundCreate = vi.fn();

const mockStripe = {
  checkout: { sessions: { retrieve: mockRetrieve } },
  refunds: { create: mockRefundCreate },
};
const mockDb = { from: mockFrom };

const handler = makeHandler(mockStripe, mockDb);

// --- Helpers ---

function buildEvent({ method = 'POST', body = {}, password = 'admin123' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password },
    body: JSON.stringify(body),
  };
}

const baseCard = {
  slug: 'ana-electricista',
  nombre: 'Ana López',
  plan: 'base',
  status: 'active',
  expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  stripe_session_id: 'cs_test_abc',
};

// --- Tests ---

describe('admin-actions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    delete process.env.ADMIN_TOTP_SECRET;

    mockUpdate.mockReturnValue({ eq: mockEqUpdate });
    mockEqUpdate.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ data: baseCard, error: null });
    mockFrom.mockImplementation((table) => {
      if (table === 'cards')           return { select: mockSelect, update: mockUpdate };
      if (table === 'admin_audit_log') return { insert: mockInsert };
      if (table === 'categories')      return { select: mockCatSelect };
      return {};
    });
  });

  it('devuelve 405 para métodos que no sean POST', async () => {
    const res = await handler(buildEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('devuelve 401 sin contraseña', async () => {
    const res = await handler(buildEvent({ password: '' }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 401 con contraseña incorrecta', async () => {
    const res = await handler(buildEvent({ password: 'wrongpass' }));
    expect(res.statusCode).toBe(401);
  });

  it('devuelve 400 si falta el slug', async () => {
    const res = await handler(buildEvent({ body: { action: 'reactivate' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('slug');
  });

  it('devuelve 404 si la tarjeta no existe', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await handler(buildEvent({ body: { action: 'reactivate', slug: 'inexistente' } }));
    expect(res.statusCode).toBe(404);
  });

  it('devuelve 400 para acción desconocida', async () => {
    const res = await handler(buildEvent({ body: { action: 'borrar', slug: 'ana-electricista' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('borrar');
  });

  // ── Reactivar ──

  describe('reactivate', () => {
    it('actualiza status y expires_at y devuelve 200', async () => {
      const res = await handler(buildEvent({ body: { action: 'reactivate', slug: 'ana-electricista' } }));
      expect(res.statusCode).toBe(200);

      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.status).toBe('active');
      expect(updated.expires_at).toBeDefined();

      const days90 = 90 * 24 * 60 * 60 * 1000;
      const expiresMs = new Date(updated.expires_at).getTime();
      expect(expiresMs).toBeGreaterThan(Date.now() + days90 - 5000);
    });

    it('usa 365 días para plan pro', async () => {
      mockSingle.mockResolvedValue({ data: { ...baseCard, plan: 'pro' }, error: null });
      await handler(buildEvent({ body: { action: 'reactivate', slug: 'ana-electricista' } }));

      const updated = mockUpdate.mock.calls[0][0];
      const days365 = 365 * 24 * 60 * 60 * 1000;
      expect(new Date(updated.expires_at).getTime()).toBeGreaterThan(Date.now() + days365 - 5000);
    });
  });

  // ── Extender ──

  describe('extend', () => {
    it('añade 30 días a una tarjeta activa y devuelve 200', async () => {
      const currentExpiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      mockSingle.mockResolvedValue({ data: { ...baseCard, expires_at: currentExpiry.toISOString() }, error: null });

      const res = await handler(buildEvent({ body: { action: 'extend', slug: 'ana-electricista' } }));
      expect(res.statusCode).toBe(200);

      const updated = mockUpdate.mock.calls[0][0];
      const expected = currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(new Date(updated.expires_at).getTime()).toBeCloseTo(expected, -3);
    });

    it('cuenta los 30 días desde hoy si la tarjeta está expirada', async () => {
      const pastExpiry = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      mockSingle.mockResolvedValue({ data: { ...baseCard, expires_at: pastExpiry.toISOString() }, error: null });

      const before = Date.now();
      const res = await handler(buildEvent({ body: { action: 'extend', slug: 'ana-electricista' } }));
      expect(res.statusCode).toBe(200);

      const updated = mockUpdate.mock.calls[0][0];
      const days30 = 30 * 24 * 60 * 60 * 1000;
      expect(new Date(updated.expires_at).getTime()).toBeGreaterThanOrEqual(before + days30);
    });
  });

  // ── Reembolsar ──

  describe('refund', () => {
    beforeEach(() => {
      mockRetrieve.mockResolvedValue({ payment_intent: 'pi_test_xyz' });
      mockRefundCreate.mockResolvedValue({ id: 're_test_123' });
    });

    it('crea el reembolso en Stripe y desactiva la tarjeta', async () => {
      const res = await handler(buildEvent({ body: { action: 'refund', slug: 'ana-electricista', reason: 'Doble pago' } }));
      expect(res.statusCode).toBe(200);

      expect(mockRetrieve).toHaveBeenCalledWith('cs_test_abc');
      expect(mockRefundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_test_xyz' });

      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.status).toBe('inactive');
      expect(updated.refund_reason).toBe('Doble pago');
      expect(updated.refunded_at).toBeDefined();
    });

    it('devuelve 400 si la tarjeta no tiene sesión de Stripe', async () => {
      mockSingle.mockResolvedValue({ data: { ...baseCard, stripe_session_id: null }, error: null });
      const res = await handler(buildEvent({ body: { action: 'refund', slug: 'ana-electricista' } }));
      expect(res.statusCode).toBe(400);
    });

    it('devuelve 502 si Stripe rechaza el reembolso', async () => {
      mockRetrieve.mockRejectedValue(new Error('No such payment'));
      const res = await handler(buildEvent({ body: { action: 'refund', slug: 'ana-electricista' } }));
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).error).toContain('No such payment');
    });
  });

  // ── toggle_directory ──

  describe('toggle_directory', () => {
    const fullCard = { ...baseCard, category_id: 'cat-uuid', city_slug: 'madrid', directory_visible: false, directory_featured: false };

    beforeEach(() => {
      mockSingle.mockResolvedValue({ data: fullCard, error: null });
    });

    it('activa directory_visible en un perfil completo y devuelve 200', async () => {
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'directory_visible', value: true },
      }));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.directory_visible).toBe(true);
    });

    it('activa directory_featured independientemente de category_id', async () => {
      mockSingle.mockResolvedValue({ data: { ...fullCard, category_id: null }, error: null });
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'directory_featured', value: true },
      }));
      expect(res.statusCode).toBe(200);
      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.directory_featured).toBe(true);
    });

    it('devuelve 400 si se intenta activar directory_visible sin category_id', async () => {
      mockSingle.mockResolvedValue({ data: { ...fullCard, category_id: null }, error: null });
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'directory_visible', value: true },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Perfil incompleto');
    });

    it('devuelve 400 si se intenta activar directory_visible sin city_slug', async () => {
      mockSingle.mockResolvedValue({ data: { ...fullCard, city_slug: null }, error: null });
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'directory_visible', value: true },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Perfil incompleto');
    });

    it('permite desactivar directory_visible aunque el perfil esté incompleto', async () => {
      mockSingle.mockResolvedValue({ data: { ...fullCard, category_id: null, city_slug: null, directory_visible: true }, error: null });
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'directory_visible', value: false },
      }));
      expect(res.statusCode).toBe(200);
      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.directory_visible).toBe(false);
    });

    it('devuelve 400 para un campo no permitido', async () => {
      const res = await handler(buildEvent({
        body: { action: 'toggle_directory', slug: 'ana-electricista', field: 'status', value: true },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Campo no permitido');
    });
  });

  // ── set_category ──

  describe('set_category', () => {
    beforeEach(() => {
      mockMaybeSingle.mockResolvedValue({ data: { id: 'cat-uuid-123' }, error: null });
    });

    it('asigna category_id y city_slug y devuelve 200', async () => {
      const res = await handler(buildEvent({
        body: { action: 'set_category', slug: 'ana-electricista', sector: 'construccion', specialty: 'electricista', city_slug: 'madrid' },
      }));
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.ok).toBe(true);
      expect(data.category_id).toBe('cat-uuid-123');
      expect(data.city_slug).toBe('madrid');
      const updated = mockUpdate.mock.calls[0][0];
      expect(updated.category_id).toBe('cat-uuid-123');
      expect(updated.city_slug).toBe('madrid');
      expect(updated.directory_visible).toBe(false);
    });

    it('devuelve 400 si faltan campos', async () => {
      const res = await handler(buildEvent({
        body: { action: 'set_category', slug: 'ana-electricista', sector: 'construccion' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Faltan campos');
    });

    it('devuelve 400 si la categoría no existe en la BD', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      const res = await handler(buildEvent({
        body: { action: 'set_category', slug: 'ana-electricista', sector: 'foo', specialty: 'bar', city_slug: 'madrid' },
      }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Categoría no encontrada');
    });
  });
});
