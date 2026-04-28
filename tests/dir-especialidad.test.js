import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/dir-especialidad.js';

// --- Mocks ---

const mockGetSpecialtyMeta = vi.fn();
const mockGetSectorCities  = vi.fn();
const mockListProfiles     = vi.fn();
const mockGetDb            = vi.fn(() => ({}));

const handler = makeHandler({
  getDb:            mockGetDb,
  getSpecialtyMeta: mockGetSpecialtyMeta,
  getSectorCities:  mockGetSectorCities,
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

describe('dir-especialidad handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSpecialtyMeta.mockResolvedValue({
      sector_label: 'Oficios', specialty_label: 'Fontaneros', meta_title: null, meta_desc: null,
    });
    mockGetSectorCities.mockResolvedValue([{ city_slug: 'madrid', city_name: 'Madrid', province: 'Madrid' }]);
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 1, error: null });
  });

  it('devuelve 400 si falta specialty en la ruta', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 200 con HTML para sector+especialidad válidos', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('incluye specialty label en el documento', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('Fontaneros');
  });

  it('renderiza tarjetas de perfil con link y nombre', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('/p/juan-fontanero');
    expect(res.body).toContain('Juan García');
  });

  it('muestra mensaje vacío cuando no hay perfiles', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [], total: 0, error: null });
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sin resultados');
  });

  it('renderiza chips de ciudades con sus links', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('/directorio/oficios/fontanero/madrid');
    expect(res.body).toContain('Madrid');
  });

  it('canonical en página 1 no lleva ?p=', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toMatch(/rel="canonical"[^>]*href="https:\/\/perfilapro\.es\/directorio\/oficios\/fontanero"/);
    expect(res.body).not.toMatch(/rel="canonical"[^>]*\?p=/);
  });

  it('muestra paginación cuando total supera PAGE_SIZE', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 25, error: null });
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('Siguiente');
  });

  it('usa meta_title personalizado de la BD cuando existe', async () => {
    mockGetSpecialtyMeta.mockResolvedValue({
      sector_label: 'Oficios', specialty_label: 'Fontaneros',
      meta_title: 'Los mejores fontaneros', meta_desc: null,
    });
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('Los mejores fontaneros');
  });

  it('incluye breadcrumb con link al sector padre', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('/directorio/oficios');
  });

  it('incluye JSON-LD ItemList', async () => {
    const res = await handler(buildEvent('/directorio/oficios/fontanero'));
    expect(res.body).toContain('"@type":"ItemList"');
  });
});
