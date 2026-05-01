import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildStatsEmail } from '../netlify/functions/weekly-stats.js';

const mockEmailSend = vi.fn();
const mockEmail = { emails: { send: mockEmailSend } };

const mockSelectCount = vi.fn();
const mockEqCount     = vi.fn();
const mockGteCount    = vi.fn();
const mockNot         = vi.fn();
const mockEqCards     = vi.fn();
const mockSelectCards = vi.fn();
const mockDb = { from: vi.fn() };

function setupDb(proCards = [], weekCount = 5) {
  // Chain para tarjetas Pro: .select().eq().eq().not()
  mockNot.mockResolvedValue({ data: proCards, error: null });
  const mockEqStatus = vi.fn(() => ({ not: mockNot }));
  const mockEqPlan   = vi.fn(() => ({ eq: mockEqStatus }));
  mockSelectCards.mockReturnValue({ eq: mockEqPlan });

  // Chain para conteo: .select('*', {head}).eq().gte()
  mockGteCount.mockResolvedValue({ count: weekCount, error: null });
  mockEqCount.mockReturnValue({ gte: mockGteCount });
  mockSelectCount.mockReturnValue({ eq: mockEqCount });

  mockDb.from.mockImplementation(() => ({
    select: (fields, opts) => opts?.head ? mockSelectCount() : mockSelectCards(),
  }));
}

const handler = makeHandler(mockDb, mockEmail);

describe('weekly-stats handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSend.mockResolvedValue({ id: 'ok' });
    process.env.SITE_URL = 'https://perfilapro.com';
  });

  it('envía email a cada tarjeta Pro activa con email', async () => {
    setupDb([
      { slug: 'ana-pro', nombre: 'Ana López', email: 'ana@test.com' },
      { slug: 'luis-pro', nombre: 'Luis García', email: 'luis@test.com' },
    ]);
    await handler();
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('no envía si no hay tarjetas Pro', async () => {
    setupDb([]);
    await handler();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('no bloquea si el envío falla', async () => {
    setupDb([{ slug: 'ana-pro', nombre: 'Ana', email: 'ana@test.com' }]);
    mockEmailSend.mockRejectedValue(new Error('SMTP error'));
    await expect(handler()).resolves.toBeDefined();
  });

  it('envía desde el dominio canónico hola@perfilapro.es', async () => {
    setupDb([{ slug: 'ana-pro', nombre: 'Ana', email: 'ana@test.com' }]);
    await handler();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'PerfilaPro <hola@perfilapro.es>' })
    );
  });
});

describe('buildStatsEmail', () => {
  const base = {
    nombre: 'María Pérez',
    slug: 'maria-pro',
    visitsWeek: 12,
    visitsMonth: 45,
    siteUrl: 'https://perfilapro.com',
  };

  it('incluye el nombre y las visitas en el subject', () => {
    const { subject } = buildStatsEmail(base);
    expect(subject).toContain('María');
    expect(subject).toContain('12');
  });

  it('incluye las visitas semanales y mensuales en el HTML', () => {
    const { html } = buildStatsEmail(base);
    expect(html).toContain('12');
    expect(html).toContain('45');
  });

  it('incluye el enlace a la tarjeta', () => {
    const { html } = buildStatsEmail(base);
    expect(html).toContain('https://perfilapro.com/c/maria-pro');
  });

  it('muestra mensaje motivador con pocas visitas', () => {
    const { html } = buildStatsEmail({ ...base, visitsWeek: 1 });
    expect(html).toContain('Comparte');
  });

  it('muestra mensaje positivo con muchas visitas', () => {
    const { html } = buildStatsEmail({ ...base, visitsWeek: 15 });
    expect(html).toContain('Gran semana');
  });
});
