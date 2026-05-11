import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler, buildReminderEmail, reminderField } from '../netlify/functions/remind-expiry.js';

// --- Mocks ---

const mockUpdate  = vi.fn();
const mockEqUpdate = vi.fn();
const mockSelect  = vi.fn();
const mockEq      = vi.fn();
const mockEq2     = vi.fn();
const mockNeq     = vi.fn();
const mockIs      = vi.fn();
const mockGte     = vi.fn();
const mockLte     = vi.fn();
const mockEmailSend = vi.fn();

const mockDb = { from: vi.fn() };
const mockEmail = { emails: { send: mockEmailSend } };

const handler = makeHandler(mockDb, mockEmail);

function cardExpiringInDays(days, overrides = {}) {
  const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return {
    slug: 'test-slug',
    nombre: 'Ana López',
    email: 'ana@test.com',
    expires_at,
    ...overrides,
  };
}

function setupDbMock(cards = []) {
  mockLte.mockResolvedValue({ data: cards, error: null });
  mockGte.mockReturnValue({ lte: mockLte });
  mockIs.mockReturnValue({ gte: mockGte });
  mockNeq.mockReturnValue({ is: mockIs });
  mockEq2.mockReturnValue({ neq: mockNeq });
  mockEq.mockReturnValue({ eq: mockEq2 });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEqUpdate.mockResolvedValue({ error: null });
  mockUpdate.mockReturnValue({ eq: mockEqUpdate });
  mockDb.from.mockReturnValue({ select: mockSelect, update: mockUpdate });
}

describe('remind-expiry handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSend.mockResolvedValue({ id: 'email-ok' });
    process.env.SITE_URL = 'https://perfilapro.com';
  });

  it('envía recordatorio y marca el campo en Supabase', async () => {
    setupDbMock([cardExpiringInDays(30)]);
    await handler();

    expect(mockEmailSend).toHaveBeenCalled();
    const emailArgs = mockEmailSend.mock.calls[0][0];
    expect(emailArgs.to).toBe('ana@test.com');
    expect(emailArgs.subject).toContain('30');

    expect(mockUpdate).toHaveBeenCalledWith({ reminder_30_sent: true });
  });

  it('excluye explícitamente perfiles del carril B2B (plan=b2b)', async () => {
    // Defensivo: aunque los perfiles B2B no tienen expires_at y deberían
    // quedar fuera por la ventana de fechas, añadimos un neq('plan','b2b')
    // para garantizar que un B2B con expires_at heredado nunca recibe el
    // email de "tu plan caduca en 7 días".
    setupDbMock([]);
    await handler();
    expect(mockNeq).toHaveBeenCalledWith('plan', 'b2b');
  });

  it('no envía email si la tarjeta no tiene email', async () => {
    setupDbMock([cardExpiringInDays(30, { email: null })]);
    await handler();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('no bloquea si el envío de email falla', async () => {
    setupDbMock([cardExpiringInDays(15)]);
    mockEmailSend.mockRejectedValue(new Error('SMTP error'));
    await expect(handler()).resolves.toBeDefined();
  });

  it('procesa los tres umbrales (30, 15, 7 días)', async () => {
    setupDbMock([]);
    await handler();
    expect(mockDb.from).toHaveBeenCalledTimes(3);
  });
});

describe('reminderField', () => {
  it('devuelve el nombre de campo correcto', () => {
    expect(reminderField(30)).toBe('reminder_30_sent');
    expect(reminderField(15)).toBe('reminder_15_sent');
    expect(reminderField(7)).toBe('reminder_7_sent');
  });
});

describe('buildReminderEmail', () => {
  const base = {
    nombre: 'Carlos Pérez',
    slug: 'carlos-electricista',
    daysLeft: 7,
    expiresAt: new Date('2026-07-20').toISOString(),
    siteUrl: 'https://perfilapro.com',
  };

  it('incluye el nombre y los días en el subject', () => {
    const { subject } = buildReminderEmail(base);
    expect(subject).toContain('Carlos');
    expect(subject).toContain('7');
  });

  it('incluye el enlace a la tarjeta', () => {
    const { html } = buildReminderEmail(base);
    expect(html).toContain('https://perfilapro.com/c/carlos-electricista');
  });

  it('usa color coral para urgencia de 7 días', () => {
    const { html } = buildReminderEmail({ ...base, daysLeft: 7 });
    expect(html).toContain('#E5484D');
  });

  it('usa color warning para urgencia de 15 días', () => {
    const { html } = buildReminderEmail({ ...base, daysLeft: 15 });
    expect(html).toContain('#D97706');
  });

  it('usa verde match para 30 días', () => {
    const { html } = buildReminderEmail({ ...base, daysLeft: 30 });
    expect(html).toContain('#00C277');
  });

  it('renderiza en catalán cuando idioma=ca', () => {
    const { subject, html } = buildReminderEmail({ ...base, daysLeft: 7, idioma: 'ca' });
    expect(subject).toMatch(/caduca en 7 dies$/);
    expect(html).toContain('Només queden 7 dies');
    expect(html).toContain('Renovar la meva targeta');
    expect(html).toContain('lang="ca"');
    expect(html).toContain('/ca/terminos');
  });

  it('default a español cuando idioma falta', () => {
    const { subject, html } = buildReminderEmail({ ...base, daysLeft: 7 });
    expect(subject).toMatch(/caduca en 7 días$/);
    expect(html).toContain('Renovar mi tarjeta');
    expect(html).toContain('lang="es"');
  });
});

describe('remind-expiry · idioma desde DB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailSend.mockResolvedValue({ id: 'email-ok' });
    process.env.SITE_URL = 'https://perfilapro.es';
  });

  it('envía email en catalán para tarjetas con idioma=ca', async () => {
    setupDbMock([cardExpiringInDays(30, { idioma: 'ca' })]);
    await handler();
    const args = mockEmailSend.mock.calls[0][0];
    expect(args.subject).toMatch(/caduca en 30 dies$/);
    expect(args.html).toContain('/ca/terminos');
  });

  it('envía email en español cuando idioma=es', async () => {
    setupDbMock([cardExpiringInDays(30, { idioma: 'es' })]);
    await handler();
    const args = mockEmailSend.mock.calls[0][0];
    expect(args.subject).toMatch(/caduca en 30 días$/);
    expect(args.html).toContain('/es/terminos');
  });
});
