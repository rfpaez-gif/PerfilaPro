import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildTeamKitEmail, sendTeamKit } from '../netlify/functions/lib/team-kit.js';

const baseCard = {
  slug: 'ana-lopez-responsable-de-operaciones',
  nombre: 'Ana López',
  tagline: 'Responsable de Operaciones',
  email: 'ana@iris-energia.com',
  whatsapp: '34611222333',
  idioma: 'es',
  organization_id: 'org-1',
};

const baseOrg = {
  slug: 'iris-energia',
  name: 'IRIS energía',
  logo_url: 'https://supabase.co/storage/v1/object/public/Avatars/org-logos/iris.png',
  color_primary: '#003781',
  address: 'Calle Mayor 1, Madrid',
  phone: '910000000',
};

describe('buildTeamKitEmail', () => {
  it('genera subject + html en español por defecto con saludo personal', () => {
    const { subject, html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64), idioma: 'es',
    });
    expect(subject).toContain('Ana');
    expect(subject).toContain('equipo');
    expect(html).toContain('Tu perfil ya está vivo');
    expect(html).toContain('https://perfilapro.es/c/ana-lopez-responsable-de-operaciones');
  });

  it('en idioma=ca traduce subject + cuerpo', () => {
    const { subject, html } = buildTeamKitEmail({
      card: { ...baseCard, idioma: 'ca' }, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64), idioma: 'ca',
    });
    expect(subject).toMatch(/equip/i);
    expect(html).toMatch(/perfil ja és viu/);
    expect(html).toContain('https://perfilapro.es/ca/editar?slug=');
  });

  it('pinta el banner branded de la org con color_primary + nombre', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    expect(html).toContain('background:#003781');
    expect(html).toContain('IRIS energía');
    expect(html).toContain('Equipo de');
  });

  it('incluye el logo de la org en el banner cuando logo_url está presente', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    expect(html).toContain('iris.png');
    expect(html).toMatch(/<img[^>]+src="https:\/\/supabase\.co/);
  });

  it('color_primary inválido → no pinta banner (no inyecta CSS)', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard,
      org: { ...baseOrg, color_primary: 'red; background:url(evil)' },
      siteUrl: 'https://perfilapro.es',
      editToken: 't'.repeat(64),
    });
    expect(html).not.toContain('Equipo de');
    expect(html).not.toContain('evil');
  });

  it('incluye el download-card link cuando hay editToken', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 'abc',
    });
    // El `&` del query string se escapa a `&amp;` en HTML válido.
    expect(html).toContain('/api/download-card?slug=ana-lopez-responsable-de-operaciones&amp;token=abc');
  });

  it('sin editToken NO incluye sección kit ni edit-link', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: null,
    });
    expect(html).not.toContain('/api/download-card');
    expect(html).not.toContain('/editar?');
  });

  it('NO menciona factura en el cuerpo (B2B no factura al miembro)', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    expect(html).not.toMatch(/factura/i);
    expect(html).not.toMatch(/invoice/i);
  });

  it('NO incluye sección QR PNG separado (el QR va en la tarjeta)', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    // El kit autónomo tiene "Código QR (PNG alta resolución)" — aquí no.
    expect(html).not.toContain('Código QR');
    expect(html).not.toContain('/api/qr/');
  });

  it('NO incluye "plan / activa hasta" (el miembro no tiene plan)', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: baseOrg, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    expect(html).not.toMatch(/Activa hasta/);
    expect(html).not.toMatch(/Lo que has contratado/);
  });

  it('escapa HTML en el nombre de la org para evitar inyección', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard,
      org: { ...baseOrg, name: '<script>alert(1)</script>' },
      siteUrl: 'https://perfilapro.es',
      editToken: 't'.repeat(64),
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sin org renderiza solo identidad PerfilaPro genérica', () => {
    const { html } = buildTeamKitEmail({
      card: baseCard, org: null, siteUrl: 'https://perfilapro.es', editToken: 't'.repeat(64),
    });
    expect(html).not.toContain('Equipo de');
    expect(html).not.toContain('IRIS');
  });
});

describe('sendTeamKit', () => {
  // Mocks inyectables vía DI — patrón del codebase. Evita tocar PDFKit
  // real (lento) y la red (fetchLogo). Los tests de buildBusinessCardPDF
  // real viven en printable-card-utils.test.js.
  const mockBuildPdf  = vi.fn();
  const mockFetchLogo = vi.fn();

  const mockSend = vi.fn();
  const mockEmailClient = { emails: { send: mockSend } };

  const mockEqUpdate = vi.fn();
  const mockUpdate   = vi.fn(() => ({ eq: mockEqUpdate }));
  const mockFrom     = vi.fn();
  const mockDb       = { from: mockFrom };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildPdf.mockResolvedValue(Buffer.from('PDF-DUMMY'));
    mockFetchLogo.mockResolvedValue(Buffer.from('LOGO-DUMMY'));
    mockSend.mockResolvedValue({ id: 'msg_1' });
    mockEqUpdate.mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table) => {
      if (table === 'cards') return { update: mockUpdate };
      return {};
    });
  });

  function call(overrides = {}) {
    return sendTeamKit({
      db: mockDb,
      emailClient: mockEmailClient,
      card: baseCard,
      org: baseOrg,
      siteUrl: 'https://perfilapro.es',
      editToken: 't'.repeat(64),
      buildPdf: mockBuildPdf,
      fetchLogo: mockFetchLogo,
      ...overrides,
    });
  }

  it('envía email con tarjeta de visita adjunta + marca kit_email_sent_at', async () => {
    const ok = await call();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
    const sent = mockSend.mock.calls[0][0];
    expect(sent.to).toBe('ana@iris-energia.com');
    expect(sent.subject).toContain('Ana');
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].filename).toBe('tarjeta-ana-lopez-responsable-de-operaciones.pdf');
    // No factura, no QR PNG suelto
    expect(sent.attachments.find(a => /factura/.test(a.filename))).toBeUndefined();
    expect(sent.attachments.find(a => /qr\.png$/.test(a.filename))).toBeUndefined();

    // Marca kit_email_sent_at en la card
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ kit_email_sent_at: expect.any(String) })
    );
  });

  it('si el PDF falla, manda el email sin adjunto y sigue siendo true', async () => {
    mockBuildPdf.mockRejectedValue(new Error('PDFKit died'));
    const ok = await call();
    expect(ok).toBe(true);
    const sent = mockSend.mock.calls[0][0];
    expect(sent.attachments).toBeUndefined();
  });

  it('si Resend falla, NO marca kit_email_sent_at y devuelve false', async () => {
    mockSend.mockRejectedValue(new Error('Resend down'));
    const ok = await call();
    expect(ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('si el logo no carga, sigue adelante y manda con PDF sin logo', async () => {
    mockFetchLogo.mockResolvedValue(null);
    const ok = await call();
    expect(ok).toBe(true);
    expect(mockBuildPdf).toHaveBeenCalledWith(
      expect.objectContaining({ logoBuffer: null })
    );
  });

  it('sin org.logo_url, no llama a fetchLogo y pasa logoBuffer=null al PDF', async () => {
    const ok = await call({ org: { ...baseOrg, logo_url: null } });
    expect(ok).toBe(true);
    expect(mockFetchLogo).not.toHaveBeenCalled();
    expect(mockBuildPdf).toHaveBeenCalledWith(
      expect.objectContaining({ logoBuffer: null })
    );
  });

  it('sin emailClient devuelve false sin tocar BD ni nada', async () => {
    const ok = await call({ emailClient: null });
    expect(ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockBuildPdf).not.toHaveBeenCalled();
  });

  it('sin card.email devuelve false (no podemos enviar a nada)', async () => {
    const ok = await call({ card: { ...baseCard, email: null } });
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('si el UPDATE de kit_email_sent_at falla, el email ya fue enviado → devuelve true', async () => {
    mockEqUpdate.mockResolvedValue({ error: { message: 'db down' } });
    const ok = await call();
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
