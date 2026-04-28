import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/perfil-publico.js';

// --- Mocks ---

const mockThen   = vi.fn().mockImplementation((cb) => { cb({ error: null }); return Promise.resolve(); });
const mockEq     = vi.fn(() => ({ then: mockThen }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockFrom   = vi.fn(() => ({ update: mockUpdate }));
const mockDb     = { from: mockFrom };

const mockGetPublicProfile  = vi.fn();
const mockGetCategoryByCard = vi.fn();
const mockGetCityBySlug     = vi.fn();

const handler = makeHandler({
  getDb:             () => mockDb,
  getPublicProfile:  mockGetPublicProfile,
  getCategoryByCard: mockGetCategoryByCard,
  getCityBySlug:     mockGetCityBySlug,
});

// --- Datos de muestra ---

const BASE_CARD = {
  slug: 'ana-abogada', nombre: 'Ana Martínez', tagline: 'Abogada especialista en familia',
  foto_url: null, whatsapp: '34612345678', email: 'ana@ejemplo.com', telefono: '915001234',
  zona: 'Madrid', descripcion: 'Abogada con 10 años de experiencia en derecho de familia.',
  servicios: ['Divorcio · 300€', 'Testamentos · 150€'],
  plan: 'pro', stripe_session_id: 'cs_test_abc', status: 'active',
  profile_views: 42, directory_featured: false, directory_visible: true,
  category_id: 'cat-uuid', city_slug: 'madrid',
};

const CAT  = { sector: 'legal', sector_label: 'Legal', specialty: 'abogado', specialty_label: 'Abogados' };
const CITY = { name: 'Madrid', slug: 'madrid', province: 'Madrid', region: 'Com. de Madrid' };

function buildEvent(path) {
  return {
    path,
    headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
  };
}

// --- Tests ---

describe('perfil-publico handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicProfile.mockResolvedValue(BASE_CARD);
    mockGetCategoryByCard.mockResolvedValue(CAT);
    mockGetCityBySlug.mockResolvedValue(CITY);
    mockThen.mockImplementation((cb) => { cb({ error: null }); return Promise.resolve(); });
  });

  // ── Perfil no encontrado ──

  it('devuelve 404 si el perfil no existe', async () => {
    mockGetPublicProfile.mockResolvedValue(null);
    const res = await handler(buildEvent('/p/perfil-inexistente'));
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Perfil no encontrado');
  });

  it('404 devuelve HTML (no JSON)', async () => {
    mockGetPublicProfile.mockResolvedValue(null);
    const res = await handler(buildEvent('/p/perfil-inexistente'));
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  // ── Perfil existente ──

  it('devuelve 200 con HTML para un perfil activo', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('incluye nombre y tagline del profesional', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('Ana Martínez');
    expect(res.body).toContain('Abogada especialista en familia');
  });

  it('canonical apunta a /p/:slug (nunca a /c/:slug)', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('rel="canonical"');
    expect(res.body).toContain('/p/ana-abogada');
    expect(res.body).not.toMatch(/canonical[^>]*\/c\/ana-abogada/);
  });

  // ── Contacto: paid vs free ──

  it('muestra botón WhatsApp para perfiles de pago', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('wa.me');
    expect(res.body).toContain('WhatsApp');
  });

  it('muestra botón de llamada cuando hay teléfono en perfil de pago', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('tel:');
    expect(res.body).toContain('Llamar');
  });

  it('muestra contacto bloqueado para perfiles gratuitos (sin stripe_session_id)', async () => {
    mockGetPublicProfile.mockResolvedValue({ ...BASE_CARD, stripe_session_id: null });
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('wa.me');
    expect(res.body).toContain('contact-locked');
  });

  // ── Contenido ──

  it('renderiza la lista de servicios con precio', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('Divorcio');
    expect(res.body).toContain('300€');
  });

  it('incluye ciudad del profesional', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('Madrid');
  });

  // ── Categoría y breadcrumbs ──

  it('incluye breadcrumbs con link a sector y especialidad cuando existe categoría', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('/directorio/legal/abogado');
    expect(res.body).toContain('Abogados');
  });

  it('no incluye breadcrumbs de categoría cuando la tarjeta no tiene categoría', async () => {
    mockGetPublicProfile.mockResolvedValue({ ...BASE_CARD, category_id: null });
    mockGetCategoryByCard.mockResolvedValue(null);
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('/directorio/legal');
  });

  // ── SEO ──

  it('incluye JSON-LD con tipo LocalBusiness', async () => {
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.body).toContain('"@type":"LocalBusiness"');
    expect(res.body).toContain('Ana Mart');
  });

  // ── Profile views ──

  it('incrementa profile_views en Supabase de forma no bloqueante', async () => {
    await handler(buildEvent('/p/ana-abogada'));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ profile_views: 43 }));
    expect(mockEq).toHaveBeenCalledWith('slug', 'ana-abogada');
  });

  it('sigue devolviendo 200 aunque falle el incremento de visitas', async () => {
    mockThen.mockImplementation((cb) => { cb({ error: { message: 'DB error' } }); return Promise.resolve(); });
    const res = await handler(buildEvent('/p/ana-abogada'));
    expect(res.statusCode).toBe(200);
  });
});
