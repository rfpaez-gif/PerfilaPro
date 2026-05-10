import { describe, it, expect } from 'vitest';
import { handler, PAGES, LANGS, buildSitemapXml } from '../netlify/functions/sitemap-static.js';

const buildEvent = (overrides = {}) => ({
  headers: {
    'x-forwarded-proto': 'https',
    host: 'perfilapro.es',
    ...(overrides.headers || {}),
  },
});

describe('sitemap-static handler', () => {
  it('devuelve XML con headers correctos', async () => {
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/application\/xml/);
    expect(res.headers['Cache-Control']).toContain('max-age=86400');
    expect(res.body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('declara el namespace xhtml en <urlset>', async () => {
    const res = await handler(buildEvent());
    expect(res.body).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(res.body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it('emite una <url> por cada par (página × idioma)', async () => {
    const res = await handler(buildEvent());
    const urlCount = (res.body.match(/<url>/g) || []).length;
    expect(urlCount).toBe(PAGES.length * LANGS.length);
  });

  it('lista la home /es/ y /ca/ con trailing slash', async () => {
    const res = await handler(buildEvent());
    expect(res.body).toContain('<loc>https://perfilapro.es/es/</loc>');
    expect(res.body).toContain('<loc>https://perfilapro.es/ca/</loc>');
  });

  it('lista todas las páginas indexables en ambos idiomas', async () => {
    const res = await handler(buildEvent());
    for (const path of ['alta', 'terminos', 'privacidad', 'legal']) {
      expect(res.body).toContain(`<loc>https://perfilapro.es/es/${path}</loc>`);
      expect(res.body).toContain(`<loc>https://perfilapro.es/ca/${path}</loc>`);
    }
  });

  it('NO incluye páginas con noindex (editar, success)', async () => {
    const res = await handler(buildEvent());
    expect(res.body).not.toContain('/editar');
    expect(res.body).not.toContain('/success');
  });

  it('cada <url> incluye xhtml:link para es, ca y x-default', async () => {
    const res = await handler(buildEvent());
    const blocks = res.body.split('<url>').slice(1);
    expect(blocks).toHaveLength(PAGES.length * LANGS.length);
    for (const block of blocks) {
      expect(block).toContain('rel="alternate" hreflang="es"');
      expect(block).toContain('rel="alternate" hreflang="ca"');
      expect(block).toContain('rel="alternate" hreflang="x-default"');
    }
  });

  it('hreflang x-default apunta a la raíz (no a /es/)', async () => {
    const res = await handler(buildEvent());
    expect(res.body).toContain('rel="alternate" hreflang="x-default" href="https://perfilapro.es/"');
    expect(res.body).not.toMatch(/hreflang="x-default" href="https:\/\/perfilapro\.es\/(es|ca)\//);
  });

  it('home usa priority 1.0 y alta priority 0.9', async () => {
    const res = await handler(buildEvent());
    const homeBlock = res.body.split('<url>').find(b => b.includes('<loc>https://perfilapro.es/es/</loc>'));
    expect(homeBlock).toContain('<priority>1.0</priority>');
    const altaBlock = res.body.split('<url>').find(b => b.includes('<loc>https://perfilapro.es/es/alta</loc>'));
    expect(altaBlock).toContain('<priority>0.9</priority>');
  });

  it('NO lista la URL legacy /alta (sin prefijo de idioma)', async () => {
    const res = await handler(buildEvent());
    expect(res.body).not.toMatch(/<loc>https:\/\/perfilapro\.es\/alta<\/loc>/);
  });

  it('respeta x-forwarded-proto y host del request', async () => {
    const res = await handler(buildEvent({ headers: { 'x-forwarded-proto': 'http', host: 'staging.example.com' } }));
    expect(res.body).toContain('<loc>http://staging.example.com/es/');
    expect(res.body).not.toContain('perfilapro.es');
  });

  it('lastmod tiene formato YYYY-MM-DD', async () => {
    const res = await handler(buildEvent());
    const lastmods = res.body.match(/<lastmod>([^<]+)<\/lastmod>/g) || [];
    expect(lastmods.length).toBeGreaterThan(0);
    for (const tag of lastmods) {
      expect(tag).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    }
  });

  it('buildSitemapXml es determinista para una fecha fija', () => {
    const a = buildSitemapXml('https://perfilapro.es', '2026-05-10');
    const b = buildSitemapXml('https://perfilapro.es', '2026-05-10');
    expect(a).toBe(b);
  });
});
