import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeHandler } from '../netlify/functions/org.js';

// --- Mocks ---

const mockGetOrgBySlug   = vi.fn();
const mockListCardsByOrg = vi.fn();
const mockGetDb          = vi.fn(() => ({}));

const handler = makeHandler({
  getDb:          mockGetDb,
  getOrgBySlug:   mockGetOrgBySlug,
  listCardsByOrg: mockListCardsByOrg,
});

// --- Datos de muestra ---

const BASE_ORG = {
  id: 'uuid-iris',
  slug: 'iris',
  name: 'Iris Comercializadora',
  tagline: 'Energía para autónomos',
  logo_url: 'https://abc.supabase.co/storage/v1/object/public/logos/iris.png',
  color_primary: '#FF6600',
  deleted_at: null,
};

const BASE_CARD = {
  slug: 'ana-electricista',
  nombre: 'Ana López',
  tagline: 'Electricista certificada',
  foto_url: null,
  plan: 'pro',
  stripe_session_id: 'cs_test',
  directory_featured: false,
};

function buildEvent(path) {
  return {
    path,
    headers: { host: 'perfilapro.es', 'x-forwarded-proto': 'https' },
    queryStringParameters: {},
  };
}

// --- Tests ---

describe('org handler (/e/:slug)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgBySlug.mockResolvedValue(BASE_ORG);
    mockListCardsByOrg.mockResolvedValue({ cards: [BASE_CARD] });
  });

  it('devuelve 400 si falta el slug', async () => {
    const res = await handler({ path: '/e/', headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(400);
  });

  it('devuelve 404 con HTML cuando la org no existe', async () => {
    mockGetOrgBySlug.mockResolvedValue(null);
    const res = await handler(buildEvent('/e/no-existe'));
    expect(res.statusCode).toBe(404);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.body).toContain('no encontrada');
  });

  it('renderiza nombre, tagline y logo de la organización', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Iris Comercializadora');
    expect(res.body).toContain('Energía para autónomos');
    expect(res.body).toContain('supabase.co/storage');
  });

  it('aplica el color primario como background del hero cuando es hex válido', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toMatch(/\.pp-org-hero\{background:#FF6600/);
  });

  it('usa color fallback cuando color_primary es inválido', async () => {
    mockGetOrgBySlug.mockResolvedValue({ ...BASE_ORG, color_primary: 'no-valido' });
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toMatch(/\.pp-org-hero\{background:#0A1F44/);
    expect(res.body).not.toContain('no-valido');
  });

  it('no incluye el logo si la URL no está whitelisted', async () => {
    mockGetOrgBySlug.mockResolvedValue({ ...BASE_ORG, logo_url: 'https://evil.com/x.png' });
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).not.toContain('evil.com');
    // El hero sigue ahí con el nombre, solo falta la imagen.
    expect(res.body).toContain('Iris Comercializadora');
  });

  it('renderiza el grid con las cards de la org', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toContain('/p/ana-electricista');
    expect(res.body).toContain('Ana López');
  });

  it('muestra contador en plural cuando hay varias cards', async () => {
    mockListCardsByOrg.mockResolvedValue({
      cards: [BASE_CARD, { ...BASE_CARD, slug: 'beto', nombre: 'Beto' }],
    });
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toContain('2 profesionales');
  });

  it('muestra contador en singular con una sola card', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toContain('1 profesional');
    expect(res.body).not.toContain('1 profesionales');
  });

  it('muestra estado vacío cuando la org no tiene cards', async () => {
    mockListCardsByOrg.mockResolvedValue({ cards: [] });
    const res = await handler(buildEvent('/e/iris'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Aún no hay profesionales');
  });

  it('canonical apunta a /e/:slug en el dominio actual', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toMatch(/rel="canonical"\s+href="https:\/\/perfilapro\.es\/e\/iris"/);
  });

  it('emite robots noindex,nofollow para que las páginas B2B no se indexen', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it('escapa el nombre de la org en HTML', async () => {
    mockGetOrgBySlug.mockResolvedValue({ ...BASE_ORG, name: 'Iris <script>x</script>', logo_url: null });
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});
