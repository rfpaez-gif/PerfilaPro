import { describe, it, expect } from 'vitest';
import { renderHead, renderPage, esc } from '../netlify/functions/lib/render.js';

describe('renderHead', () => {
  it('renderiza un head válido con opts mínimos', () => {
    const out = renderHead({
      title: 'PerfilaPro',
      description: 'Tu perfil profesional siempre a mano',
    });

    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(out).toContain('<title>PerfilaPro</title>');
    expect(out).toContain('<meta name="description" content="Tu perfil profesional siempre a mano">');
    expect(out).toContain('<meta property="og:image"');
    expect(out).not.toContain('noindex');
    expect(out).not.toContain('rel="canonical"');
  });

  it('enlaza exactamente /styles/brand.css', () => {
    const out = renderHead({ title: 't', description: 'd' });
    expect(out).toContain('<link rel="stylesheet" href="/styles/brand.css">');
  });

  it('incluye preconnect y stylesheet de Google Fonts (Geist + Fraunces)', () => {
    const out = renderHead({ title: 't', description: 'd' });
    expect(out).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">');
    expect(out).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    expect(out).toContain('family=Geist:wght@400;500;600');
    expect(out).toContain('family=Geist+Mono');
    expect(out).toContain('family=Fraunces');
  });

  it('con noindex=true añade el meta robots', () => {
    const out = renderHead({ title: 't', description: 'd', noindex: true });
    expect(out).toContain('<meta name="robots" content="noindex,nofollow">');
  });

  it('con canonical inyecta link canonical y og:url', () => {
    const url = 'https://perfilapro.es/c/maria';
    const out = renderHead({ title: 't', description: 'd', canonical: url });
    expect(out).toContain(`<link rel="canonical" href="${url}">`);
    expect(out).toContain(`<meta property="og:url" content="${url}">`);
  });

  it('usa ogImage por defecto basado en SITE_URL', () => {
    const out = renderHead({ title: 't', description: 'd' });
    expect(out).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/assets\/og-default\.png">/);
  });

  it('respeta ogImage explícito si se pasa', () => {
    const url = 'https://cdn.example.com/og.png';
    const out = renderHead({ title: 't', description: 'd', ogImage: url });
    expect(out).toContain(`<meta property="og:image" content="${url}">`);
  });

  it('inyecta extraHead AL FINAL, después del stylesheet de fuentes', () => {
    const extra = '<script type="application/ld+json">{"@type":"Person"}</script>';
    const out = renderHead({ title: 't', description: 'd', extraHead: extra });
    const idxFonts = out.indexOf('fonts.googleapis.com/css2');
    const idxExtra = out.indexOf(extra);
    expect(idxFonts).toBeGreaterThan(0);
    expect(idxExtra).toBeGreaterThan(idxFonts);
  });

  it('escapa <script> en title (seguridad XSS)', () => {
    const out = renderHead({
      title: '<script>alert(1)</script>',
      description: 'd',
    });
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('no truena si se llama sin opts (defaults)', () => {
    expect(() => renderHead()).not.toThrow();
    const out = renderHead();
    expect(out).toContain('<title></title>');
    expect(out).toContain('<link rel="stylesheet" href="/styles/brand.css">');
  });

  it('escapa comillas dobles en description (seguridad atributo)', () => {
    const out = renderHead({
      title: 't',
      description: 'Frase con "comillas" y <tags>',
    });
    expect(out).toContain('content="Frase con &quot;comillas&quot; y &lt;tags&gt;"');
  });
});

describe('renderPage', () => {
  it('envuelve head+body en doctype HTML5 con lang por defecto es', () => {
    const out = renderPage({ head: '<title>X</title>', body: '<h1>Hola</h1>' });
    expect(out).toMatch(/^<!doctype html>/);
    expect(out).toContain('<html lang="es">');
    expect(out).toContain('<title>X</title>');
    expect(out).toContain('<h1>Hola</h1>');
    expect(out).toContain('</html>');
  });

  it('respeta lang explícito y bodyClass', () => {
    const out = renderPage({
      head: '',
      body: '',
      lang: 'en',
      bodyClass: 'pp-page pp-page--admin',
    });
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('<body class="pp-page pp-page--admin">');
  });

  it('omite el atributo class del body si bodyClass está vacío', () => {
    const out = renderPage({ head: '', body: '' });
    expect(out).toContain('<body>');
    expect(out).not.toContain('<body class=');
  });
});

describe('esc', () => {
  it('escapa los 5 caracteres HTML peligrosos', () => {
    expect(esc('<a href="x">&\'</a>'))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });

  it('convierte null/undefined en cadena vacía', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('convierte números a string sin escape', () => {
    expect(esc(42)).toBe('42');
  });
});
