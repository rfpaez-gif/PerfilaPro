import { describe, it, expect } from 'vitest';
import { htmlPage } from '../netlify/functions/lib/dir-utils.js';

const baseArgs = {
  title: 'Test page',
  desc:  'Descripción de la página',
  canonical: 'https://perfilapro.es/p/ana',
  body: '<p>body</p>',
  crumbs: null,
  siteUrl: 'https://perfilapro.es',
  jsonLd: null,
};

describe('htmlPage Open Graph + Twitter Cards', () => {
  it('emite og:type=website por defecto y og:url=canonical', () => {
    const html = htmlPage({ ...baseArgs });
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta property="og:url" content="https://perfilapro.es/p/ana">');
    expect(html).toContain('<meta property="og:title" content="Test page">');
    expect(html).toContain('<meta property="og:site_name" content="PerfilaPro">');
    expect(html).toContain('<meta property="og:locale" content="es_ES">');
  });

  it('respeta ogType cuando se pasa (ej. profile)', () => {
    const html = htmlPage({ ...baseArgs, ogType: 'profile' });
    expect(html).toContain('<meta property="og:type" content="profile">');
  });

  it('omite og:image y usa twitter:card=summary cuando no hay imagen', () => {
    const html = htmlPage({ ...baseArgs });
    expect(html).not.toContain('property="og:image"');
    expect(html).not.toContain('name="twitter:image"');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('emite og:image y twitter:card=summary_large_image cuando hay imagen', () => {
    const html = htmlPage({ ...baseArgs, ogImage: 'https://cdn.example.com/foto.jpg' });
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/foto.jpg">');
    expect(html).toContain('<meta name="twitter:image" content="https://cdn.example.com/foto.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('escapa el contenido de las meta tags', () => {
    const html = htmlPage({ ...baseArgs, title: 'A & "B"', desc: '<script>x</script>' });
    expect(html).toContain('<meta property="og:title" content="A &amp; &quot;B&quot;">');
    expect(html).toContain('<meta property="og:description" content="&lt;script&gt;x&lt;/script&gt;">');
    expect(html).not.toContain('<script>x</script>');
  });
});
