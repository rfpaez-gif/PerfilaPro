'use strict';

const { getDb } = require('./lib/supabase-client');
const { esc, renderCard, htmlPage, buildShowcaseCta } = require('./lib/dir-utils');
const { getOrgBySlug, listCardsByOrg, isValidHex, isSafeLogoUrl } = require('./lib/org-utils');

function makeHandler(deps) {
  const _getDb           = deps.getDb;
  const _getOrgBySlug    = deps.getOrgBySlug;
  const _listCardsByOrg  = deps.listCardsByOrg;

  return async (event) => {
    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;

    // /e/:slug · primer segmento útil del path
    const parts = (event.path || '').split('/').filter(Boolean);
    const slug  = parts[1] || event.queryStringParameters?.slug;

    if (!slug) return { statusCode: 400, body: 'Missing slug' };

    const db = _getDb();
    const org = await _getOrgBySlug(db, slug);

    if (!org) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Organización no encontrada — PerfilaPro</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#FAF7F0;color:#0A1F44;margin:0}div{text-align:center;padding:1rem}h1{font-size:1.5rem;margin-bottom:.5rem;font-weight:700;letter-spacing:-0.02em}p{color:#6B7280;margin:0}</style>
</head><body><div><h1>Organización no encontrada</h1><p>Esta página no existe o ya no está activa.</p></div></body></html>`,
      };
    }

    const { cards } = await _listCardsByOrg(db, org.id);

    const accent  = isValidHex(org.color_primary) ? org.color_primary : null;
    const logoUrl = isSafeLogoUrl(org.logo_url) ? org.logo_url : null;
    const canonical = `${siteUrl}/e/${org.slug}`;

    // Estilos específicos del hero de la organización. El grid de
    // tarjetas reutiliza .pp-dir-grid + .pp-dir-card de dir-utils.
    const extraCss = `
.pp-org-hero{background:${accent || '#0A1F44'};color:#FFFFFF;padding:2.5rem 1.5rem 2rem;border-radius:1.5rem;text-align:center;margin-bottom:1.5rem;border:1px solid var(--color-gris-200)}
.pp-org-hero__logo{display:inline-flex;align-items:center;justify-content:center;background:#FFFFFF;padding:.75rem 1rem;border-radius:.875rem;margin-bottom:1rem;box-shadow:0 4px 16px rgba(0,0,0,.08)}
.pp-org-hero__logo img{display:block;max-height:60px;max-width:200px;width:auto;height:auto}
.pp-org-hero__name{font-family:var(--font-serif);font-size:1.875rem;line-height:1.2;font-weight:400;letter-spacing:-0.02em;color:#FFFFFF}
.pp-org-hero__tagline{font-size:.9375rem;opacity:.88;margin-top:.5rem;line-height:1.6;max-width:48ch;margin-left:auto;margin-right:auto}
.pp-org-count{font-size:.8125rem;color:var(--color-gris-500);margin:0 0 .875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
@media(max-width:480px){
  .pp-org-hero{padding:1.875rem 1rem 1.5rem}
  .pp-org-hero__name{font-size:1.5rem}
  .pp-org-hero__logo img{max-height:48px;max-width:160px}
}
`;

    const heroHtml = `<section class="pp-org-hero">
  ${logoUrl ? `<div class="pp-org-hero__logo"><img src="${esc(logoUrl)}" alt="${esc(org.name)}" loading="eager" decoding="async"></div>` : ''}
  <h1 class="pp-org-hero__name">${esc(org.name)}</h1>
  ${org.tagline ? `<p class="pp-org-hero__tagline">${esc(org.tagline)}</p>` : ''}
</section>`;

    const cardsHtml = cards.length
      ? `<p class="pp-org-count">${cards.length} ${cards.length === 1 ? 'profesional' : 'profesionales'}</p>
<div class="pp-dir-grid">${cards.map(c => renderCard(c, siteUrl)).join('\n')}</div>`
      : `<div class="pp-dir-empty"><h2>Aún no hay profesionales</h2><p>Esta organización todavía no tiene perfiles publicados en PerfilaPro.</p></div>`;

    const title = `${org.name} — PerfilaPro`;
    const desc  = org.tagline || `Equipo de ${org.name} en PerfilaPro. Cada profesional con su perfil, su QR y su WhatsApp.`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage({
        title,
        desc,
        canonical,
        body: `${heroHtml}\n${cardsHtml}\n${buildShowcaseCta(siteUrl)}`,
        crumbs: null,
        siteUrl,
        jsonLd: null,
        extraCss,
        // Las páginas B2B no son target SEO mientras el piloto no se cierre.
        // Cuando una org pase a producción de pago se puede pasar a true por org.
        noindex: true,
      }),
    };
  };
}

exports.handler = makeHandler({ getDb, getOrgBySlug, listCardsByOrg });
exports.makeHandler = makeHandler;
