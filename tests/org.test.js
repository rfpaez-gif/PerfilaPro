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

  it('renderiza el grid con las cards de la org enlazando a /c/:slug (tarjeta personal)', async () => {
    const res = await handler(buildEvent('/e/iris'));
    expect(res.body).toContain('/c/ana-electricista');
    expect(res.body).not.toContain('/p/ana-electricista');
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

  // ── Bloque "Acerca de" (description + contactos) ──
  describe('bloque Acerca de', () => {
    it('no aparece si la org no tiene description ni contactos', async () => {
      // BASE_ORG no tiene description/website/email/phone/address
      const res = await handler(buildEvent('/e/iris'));
      // El CSS .pp-org-about vive siempre en <style>, lo que no debe
      // aparecer es la <section> ni el título "Acerca de …".
      expect(res.body).not.toContain('<section class="pp-org-about">');
      expect(res.body).not.toContain('Acerca de Iris');
    });

    it('aparece con párrafo de description', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        description: 'Comercializadora independiente de energía 100% renovable.',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).toContain('<section class="pp-org-about">');
      expect(res.body).toContain('Acerca de Iris Comercializadora');
      expect(res.body).toContain('Comercializadora independiente de energía 100% renovable.');
    });

    it('renderiza website como link con target=_blank y rel=noopener', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        website: 'https://irisenergia.es',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).toContain('href="https://irisenergia.es"');
      expect(res.body).toContain('target="_blank"');
      expect(res.body).toContain('rel="noopener noreferrer"');
      // display sin protocolo
      expect(res.body).toMatch(/>irisenergia\.es</);
    });

    it('omite website si el protocolo no es http(s)', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        website: 'javascript:alert(1)',
        description: 'Algo descriptivo',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).not.toContain('javascript:alert');
      expect(res.body).toContain('Algo descriptivo');
    });

    it('renderiza email como mailto: clicable', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        email: 'hola@iris.es',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).toContain('href="mailto:hola@iris.es"');
    });

    it('renderiza phone como tel: limpiando espacios', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        phone: '+34 965 12 34 56',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).toContain('href="tel:+34965123456"');
      // display preserva el formato bonito
      expect(res.body).toContain('+34 965 12 34 56');
    });

    it('renderiza address como texto plano (no link)', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        address: 'C/ Mayor 12, Orihuela',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).toContain('C/ Mayor 12, Orihuela');
    });

    it('escapa la description y el website en HTML', async () => {
      mockGetOrgBySlug.mockResolvedValue({
        ...BASE_ORG,
        description: '<script>alert(1)</script>',
        website: 'https://example.com/"><script>',
      });
      const res = await handler(buildEvent('/e/iris'));
      expect(res.body).not.toContain('<script>alert(1)</script>');
      expect(res.body).toContain('&lt;script&gt;');
    });
  });
});
