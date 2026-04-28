import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/dir-ciudad.js';

// --- Mocks ---

const mockGetSpecialtyMeta = vi.fn();
const mockGetCityBySlug    = vi.fn();
const mockListProfiles     = vi.fn();
const mockGetDb            = vi.fn(() => ({}));

const handler = makeHandler({
  getDb:            mockGetDb,
  getSpecialtyMeta: mockGetSpecialtyMeta,
  getCityBySlug:    mockGetCityBySlug,
  listProfiles:     mockListProfiles,
  PAGE_SIZE:        20,
});

// --- Datos de muestra ---

const BASE_PROFILE = {
  slug: 'juan-fontanero', nombre: 'Juan García', tagline: 'Fontanero',
  foto_url: null, plan: 'base', stripe_session_id: 'cs_test', profile_views: 5,
  directory_featured: false, specialty_label: 'Fontaneros',
  city_name: 'Madrid', city_slug: 'madrid', province: 'Madrid',
};

function buildEvent(path, query = {}) {
  return {
    path,
    headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
    queryStringParameters: query,
  };
}

// --- Tests ---

describe('dir-ciudad handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSpecialtyMeta.mockResolvedValue({
      sector_label: 'Oficios', specialty_label: 'Fontaneros', meta_title: null, meta_desc: null,
    });
    mockGetCityBySlug.mockResolvedValue({ name: 'Madrid', slug: 'madrid', province: 'Madrid', region: 'Com. de Madrid' });
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 1, error: null });
  });

  it('devuelve 400 si falta ciudad en la ruta', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 200 con HTML para sector+especialidad+ciudad válidos', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('incluye ciudad y especialidad en el documento', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.body).toContain('Fontaneros');
    expect(res.body).toContain('Madrid');
  });

  it('renderiza tarjetas de perfil', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.body).toContain('/p/juan-fontanero');
    expect(res.body).toContain('Juan García');
  });

  it('muestra mensaje vacío cuando no hay perfiles', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [], total: 0, error: null });
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sin resultados');
  });

  it('canonical apunta a la ruta sector/specialty/ciudad', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.body).toMatch(/rel="canonical"[^>]*href="https:\/\/perfilapro\.es\/directorio\/oficios\/fontanero\/madrid"/);
  });

  it('muestra paginación cuando total supera PAGE_SIZE', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 25, error: null });
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.body).toContain('Siguiente');
  });

  // ── Modo "todas las ciudades" (specialty = _) ──

  it('specialty _ no llama a getSpecialtyMeta', async () => {
    await handler(buildEvent('/directorio/oficios/_/madrid'));
    expect(mockGetSpecialtyMeta).not.toHaveBeenCalled();
  });

  it('specialty _ devuelve 200 con HTML', async () => {
    const res = await handler(buildEvent('/directorio/oficios/_/madrid'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Madrid');
  });

  it('specialty _ no incluye breadcrumb de especialidad', async () => {
    const res = await handler(buildEvent('/directorio/oficios/_/madrid'));
    // El canonical contiene /_/madrid, pero no debe haber un <a href=".../_"> en el breadcrumb
    expect(res.body).not.toContain('href="https://perfilapro.es/directorio/oficios/_"');
  });

  it('breadcrumb incluye link al sector y a la especialidad cuando specialty no es _', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero/madrid'));
    expect(res.body).toContain('/directorio/oficios');
    expect(res.body).toContain('/directorio/oficios/fontanero');
  });

  it('usa nombre de ciudad de Supabase cuando getCityBySlug devuelve resultado', async () => {
    mockGetCityBySlug.mockResolvedValue({ name: 'Sevilla', slug: 'sevilla', province: 'Sevilla', region: 'Andalucía' });
    const res = await handler(buildEvent('/directorio/oficios/fontanero/sevilla'));
    expect(res.body).toContain('Sevilla');
  });
});
