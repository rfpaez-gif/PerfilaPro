import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildEmailLayout, COLORS } from '../netlify/functions/lib/email-layout.js';

describe('buildEmailLayout', () => {
  const baseOpts = {
    preheader: 'Tu perfil ya está activo',
    title: 'Hola Ana',
    bodyHtml: '<p>Tu tarjeta está lista para compartir.</p>',
  };

  it('renderiza un email HTML válido y autocontenido', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toContain('<html lang="es">');
    expect(out).toContain('</html>');
    expect(out).toContain('<meta charset="UTF-8">');
  });

  it('NO incluye <style> ni <link> externos (compatibilidad email)', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<link');
  });

  it('NO usa CSS variables var(--...) en ningún sitio', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).not.toContain('var(--');
  });

  it('inyecta el preheader en un bloque oculto al inicio del body', () => {
    const out = buildEmailLayout({ ...baseOpts, preheader: 'Texto preview' });
    expect(out).toContain('Texto preview');
    const body = out.slice(out.indexOf('<body'));
    const idxPreheader = body.indexOf('Texto preview');
    const idxFirstTable = body.indexOf('<table');
    expect(idxPreheader).toBeLessThan(idxFirstTable);
    expect(out).toContain('display:none');
  });

  it('renderiza el title con tipografía destacada', () => {
    const out = buildEmailLayout({ ...baseOpts, title: 'Bienvenida, Ana' });
    expect(out).toContain('Bienvenida, Ana');
    expect(out).toMatch(/font-size:24px;font-weight:700/);
  });

  it('omite el bloque de title si title está vacío', () => {
    const out = buildEmailLayout({ ...baseOpts, title: '' });
    expect(out).not.toMatch(/font-size:24px;font-weight:700/);
  });

  it('inyecta bodyHtml tal cual (no escapa, es HTML del consumidor)', () => {
    const html = '<p>Línea 1</p><p><strong>Línea 2</strong></p>';
    const out = buildEmailLayout({ ...baseOpts, bodyHtml: html });
    expect(out).toContain(html);
  });

  it('renderiza el CTA cuando se pasa { text, url }', () => {
    const out = buildEmailLayout({
      ...baseOpts,
      cta: { text: 'Ver mi perfil', url: 'https://perfilapro.es/c/ana' },
    });
    expect(out).toContain('href="https://perfilapro.es/c/ana"');
    expect(out).toContain('Ver mi perfil');
    expect(out).toContain('border-radius:100px');
    expect(out).toContain(COLORS.primary);
  });

  it('omite el CTA si no se pasa', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).not.toContain('border-radius:100px');
  });

  it('omite el CTA si falta text o url', () => {
    const a = buildEmailLayout({ ...baseOpts, cta: { text: 'X' } });
    const b = buildEmailLayout({ ...baseOpts, cta: { url: 'https://x' } });
    expect(a).not.toContain('border-radius:100px');
    expect(b).not.toContain('border-radius:100px');
  });

  it('renderiza footerNote opcional bajo el CTA', () => {
    const note = '🔒 Enlace personal — no compartas este email.';
    const out = buildEmailLayout({ ...baseOpts, footerNote: note });
    expect(out).toContain(note);
  });

  it('omite footerNote si no se pasa', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).not.toContain('Enlace personal');
  });

  it('escapa contenido peligroso en title (XSS)', () => {
    const out = buildEmailLayout({
      ...baseOpts,
      title: '<script>alert(1)</script>',
    });
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapa el preheader', () => {
    const out = buildEmailLayout({
      ...baseOpts,
      preheader: 'A "B" & <C>',
    });
    expect(out).toContain('A &quot;B&quot; &amp; &lt;C&gt;');
  });

  it('escapa el text y url del CTA', () => {
    const out = buildEmailLayout({
      ...baseOpts,
      cta: {
        text: 'Click <here>',
        url: 'https://x.test/?a=1&b="2"',
      },
    });
    expect(out).toContain('Click &lt;here&gt;');
    expect(out).toContain('href="https://x.test/?a=1&amp;b=&quot;2&quot;"');
  });

  it('usa hex codes (no var()) sincronizados con tokens.css', () => {
    const out = buildEmailLayout(baseOpts);
    expect(out).toContain(COLORS.primary);   // #01696f
    expect(out).toContain(COLORS.bg);        // #f5f2ec
    expect(out).toContain(COLORS.bgCard);    // #ffffff
    expect(out).toContain(COLORS.ink);       // #1e1b14
    expect(out).toContain(COLORS.inkSubtle); // #a89f90 (footer)
  });

  it('los enlaces del footer usan SITE_URL del entorno', () => {
    const original = process.env.SITE_URL;
    process.env.SITE_URL = 'https://staging.perfilapro.es';
    const out = buildEmailLayout(baseOpts);
    expect(out).toContain('href="https://staging.perfilapro.es/terminos.html"');
    expect(out).toContain('href="https://staging.perfilapro.es/privacidad.html"');
    expect(out).toContain('href="https://staging.perfilapro.es/legal.html"');
    if (original === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = original;
  });

  it('respeta siteUrl pasado por opts (override del env)', () => {
    const out = buildEmailLayout({
      ...baseOpts,
      siteUrl: 'https://custom.test',
    });
    expect(out).toContain('href="https://custom.test/terminos.html"');
  });

  it('no truena si se llama sin opts (defaults razonables)', () => {
    expect(() => buildEmailLayout()).not.toThrow();
    const out = buildEmailLayout();
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toContain('PerfilaPro');
  });
});

describe('snapshot · email completo de ejemplo', () => {
  it('rendering completo con todos los opts es estable', () => {
    const out = buildEmailLayout({
      preheader: 'Tu perfil ya está en el mundo',
      title: '¡Listo, Ana! 💪',
      bodyHtml:
        '<p style="margin:0 0 16px;font-size:15px;color:#6b6458;line-height:1.7">' +
        'Comparte tu enlace en grupos de WhatsApp.' +
        '</p>',
      cta: { text: 'Ver mi perfil →', url: 'https://perfilapro.es/c/ana' },
      footerNote: '🔒 Enlace personal — no compartas este email.',
      siteUrl: 'https://perfilapro.es',
    });
    expect(out).toMatchSnapshot();
  });
});
