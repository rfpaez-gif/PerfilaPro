import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/dir-sector.js';

// --- Mocks ---

const mockGetSectorMeta        = vi.fn();
const mockGetSectorSpecialties = vi.fn();
const mockGetSectorCities      = vi.fn();
const mockListProfiles         = vi.fn();
const mockGetDb                = vi.fn(() => ({}));

const handler = makeHandler({
  getDb:                mockGetDb,
  getSectorMeta:        mockGetSectorMeta,
  getSectorSpecialties: mockGetSectorSpecialties,
  getSectorCities:      mockGetSectorCities,
  listProfiles:         mockListProfiles,
  PAGE_SIZE:            20,
});

// --- Datos de muestra ---

const BASE_PROFILE = {
  slug: 'juan-fontanero', nombre: 'Juan García', tagline: 'Fontanero profesional',
  foto_url: null, plan: 'base', stripe_session_id: 'cs_test', profile_views: 10,
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

describe('dir-sector handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSectorMeta.mockResolvedValue({ sector_label: 'Oficios', meta_title: null, meta_desc: null });
    mockGetSectorSpecialties.mockResolvedValue([{ specialty: 'fontanero', specialty_label: 'Fontaneros' }]);
    mockGetSectorCities.mockResolvedValue([{ city_slug: 'madrid', city_name: 'Madrid', province: 'Madrid' }]);
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 1, error: null });
  });

  it('devuelve 400 si falta sector en la ruta', async () => {
    const res = await handler(buildEvent('/directorio'));
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 200 con HTML para un sector válido', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
  });

  it('incluye el sector label en el documento', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('Oficios');
  });

  it('renderiza tarjetas de perfil con link y nombre', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('/p/juan-fontanero');
    expect(res.body).toContain('Juan García');
  });

  it('muestra mensaje de sin resultados cuando no hay perfiles', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [], total: 0, error: null });
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sin resultados');
  });

  it('renderiza chips de especialidades con sus links', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('Fontaneros');
    expect(res.body).toContain('/directorio/oficios/fontanero');
  });

  it('renderiza chip de ciudad con su link', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('/directorio/oficios/_/madrid');
  });

  it('canonical en página 1 no lleva ?p=', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toMatch(/rel="canonical"[^>]*href="https:\/\/perfilapro\.es\/directorio\/oficios"/);
    expect(res.body).not.toMatch(/rel="canonical"[^>]*\?p=/);
  });

  it('muestra enlace de paginación cuando total supera PAGE_SIZE', async () => {
    mockListProfiles.mockResolvedValue({ profiles: [BASE_PROFILE], total: 25, error: null });
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('Siguiente');
  });

  it('usa meta_title personalizado de la BD cuando existe', async () => {
    mockGetSectorMeta.mockResolvedValue({ sector_label: 'Oficios', meta_title: 'Mejores fontaneros', meta_desc: null });
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('Mejores fontaneros');
  });

  it('incluye JSON-LD ItemList', async () => {
    const res = await handler(buildEvent('/directorio/oficios'));
    expect(res.body).toContain('"@type":"ItemList"');
  });
});
