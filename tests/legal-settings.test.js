import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/legal-settings.js';

const mockUpsert = vi.fn();
const mockIn     = vi.fn();
const mockSelect = vi.fn(() => ({ in: mockIn }));
const mockFrom   = vi.fn(() => ({ select: mockSelect, upsert: mockUpsert }));
const mockDb     = { from: mockFrom };

const handler = makeHandler(mockDb);

function buildEvent({ method = 'GET', body = {}, password = '' } = {}) {
  return {
    httpMethod: method,
    headers: { 'x-admin-password': password },
    body: JSON.stringify(body),
  };
}

describe('legal-settings handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_PASSWORD = 'admin123';
    mockIn.mockResolvedValue({ data: [], error: null });
    mockUpsert.mockResolvedValue({ error: null });
  });

  describe('GET', () => {
    it('devuelve los valores por defecto si no hay datos', async () => {
      const res = await handler(buildEvent());
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.legal_name).toBe('Rafael Páez Manso');
      expect(body.legal_email).toBe('hola@perfilapro.es');
    });

    it('mezcla los datos de Supabase con los defaults', async () => {
      mockIn.mockResolvedValue({
        data: [
          { key: 'legal_name', value: 'Juan García' },
          { key: 'legal_nif',  value: '12345678A' },
        ],
        error: null,
      });
      const res = await handler(buildEvent());
      const body = JSON.parse(res.body);
      expect(body.legal_name).toBe('Juan García');
      expect(body.legal_nif).toBe('12345678A');
      expect(body.legal_address).toBe('Orihuela, Alicante, España');
    });
  });

  describe('POST', () => {
    it('devuelve 401 sin contraseña', async () => {
      const res = await handler(buildEvent({ method: 'POST', body: { legal_name: 'Test' } }));
      expect(res.statusCode).toBe(401);
    });

    it('devuelve 401 con contraseña incorrecta', async () => {
      const res = await handler(buildEvent({ method: 'POST', password: 'wrongpass', body: { legal_name: 'Test' } }));
      expect(res.statusCode).toBe(401);
    });

    it('guarda los campos válidos y devuelve 200', async () => {
      const res = await handler(buildEvent({
        method: 'POST',
        password: 'admin123',
        body: { legal_name: 'Juan García', legal_nif: '12345678A', legal_address: 'Calle Mayor 1' },
      }));
      expect(res.statusCode).toBe(200);

      const rows = mockUpsert.mock.calls[0][0];
      expect(rows).toContainEqual({ key: 'legal_name', value: 'Juan García' });
      expect(rows).toContainEqual({ key: 'legal_nif',  value: '12345678A' });
    });

    it('ignora campos no permitidos', async () => {
      await handler(buildEvent({
        method: 'POST',
        password: 'admin123',
        body: { legal_name: 'Test', admin_password: 'hack', stripe_key: 'sk_live_xxx' },
      }));
      const rows = mockUpsert.mock.calls[0][0];
      expect(rows.map(r => r.key)).not.toContain('admin_password');
      expect(rows.map(r => r.key)).not.toContain('stripe_key');
    });

    it('devuelve 400 si no hay campos válidos', async () => {
      const res = await handler(buildEvent({
        method: 'POST',
        password: 'admin123',
        body: { campo_falso: 'valor' },
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  it('devuelve 405 para métodos no permitidos', async () => {
    const res = await handler(buildEvent({ method: 'DELETE' }));
    expect(res.statusCode).toBe(405);
  });
});
