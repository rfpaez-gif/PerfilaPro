'use strict';

const { getDb } = require('./lib/supabase-client');
const { esc, renderCard, htmlPage } = require('./lib/dir-utils');
const { getOrgBySlug, listCardsByOrg, isValidHex, isSafeLogoUrl, isSafeWebsite } = require('./lib/org-utils');

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
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
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
.pp-org-about{background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:1rem;padding:1.5rem 1.25rem;margin-bottom:1.5rem}
.pp-org-about__title{font-family:var(--font-serif);font-size:1.25rem;font-weight:400;letter-spacing:-0.01em;color:var(--color-tinta);margin:0 0 .75rem}
.pp-org-about__desc{font-size:.9375rem;line-height:1.65;color:var(--color-tinta);margin:0;white-space:pre-line}
.pp-org-about__list{list-style:none;margin:1rem 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem;font-size:.875rem;color:var(--color-gris-700)}
.pp-org-about__list li{display:flex;gap:.5rem;align-items:flex-start;line-height:1.5}
.pp-org-about__list a{color:inherit;text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s}
.pp-org-about__list a:hover{border-color:currentColor}
.pp-org-count{font-size:.8125rem;color:var(--color-gris-500);margin:0 0 .875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
@media(max-width:480px){
  .pp-org-hero{padding:1.875rem 1rem 1.5rem}
  .pp-org-hero__name{font-size:1.5rem}
  .pp-org-hero__logo img{max-height:48px;max-width:160px}
}
@media(max-width:640px){.pp-org-about__list{grid-template-columns:1fr}}
`;

    const heroHtml = `<section class="pp-org-hero">
  ${logoUrl ? `<div class="pp-org-hero__logo"><img src="${esc(logoUrl)}" alt="${esc(org.name)}" loading="eager" decoding="async"></div>` : ''}
  <h1 class="pp-org-hero__name">${esc(org.name)}</h1>
  ${org.tagline ? `<p class="pp-org-hero__tagline">${esc(org.tagline)}</p>` : ''}
</section>`;

    // Bloque "Acerca de" — solo aparece si hay al menos un dato. Si la org
    // no rellena nada, /e/:slug queda como antes (hero + grid, sin scroll
    // extra). El website se valida con isSafeWebsite antes de renderizar
    // para evitar javascript: y demás. Email/phone construyen mailto:/tel:.
    const website = isSafeWebsite(org.website) ? org.website : null;
    const websiteDisplay = website ? website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : null;
    const phoneHref = org.phone ? String(org.phone).replace(/[^\d+]/g, '') : null;
    const hasContacts = Boolean(org.phone || org.email || website || org.address);
    const hasAbout    = Boolean(org.description || hasContacts);

    const aboutHtml = hasAbout ? `<section class="pp-org-about">
  <h2 class="pp-org-about__title">Acerca de ${esc(org.name)}</h2>
  ${org.description ? `<p class="pp-org-about__desc">${esc(org.description)}</p>` : ''}
  ${hasContacts ? `<ul class="pp-org-about__list">
    ${org.phone   ? `<li><span aria-hidden="true">📞</span> <a href="tel:${esc(phoneHref)}">${esc(org.phone)}</a></li>` : ''}
    ${org.email   ? `<li><span aria-hidden="true">✉</span> <a href="mailto:${esc(org.email)}">${esc(org.email)}</a></li>` : ''}
    ${website     ? `<li><span aria-hidden="true">🌐</span> <a href="${esc(website)}" target="_blank" rel="noopener noreferrer">${esc(websiteDisplay)}</a></li>` : ''}
    ${org.address ? `<li><span aria-hidden="true">📍</span> ${esc(org.address)}</li>` : ''}
  </ul>` : ''}
</section>` : '';

    // En el grid de una org enlazamos a la tarjeta personal de cada miembro
    // (/c/:slug), no al perfil-publico SEO (/p/:slug). Queremos que el visitante
    // que abre /e/:slug y hace click en un miembro aterrice en su tarjeta con
    // WhatsApp y QR directo, no en la página del directorio.
    const cardsHtml = cards.length
      ? `<p class="pp-org-count">${cards.length} ${cards.length === 1 ? 'profesional' : 'profesionales'}</p>
<div class="pp-dir-grid">${cards.map(c => renderCard(c, siteUrl, { linkPrefix: '/c/' })).join('\n')}</div>`
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
        body: `${heroHtml}\n${aboutHtml}\n${cardsHtml}`,
        crumbs: null,
        siteUrl,
        jsonLd: null,
        extraCss,
        // Las páginas B2B no son target SEO mientras el piloto no se cierre.
        // Cuando una org pase a producción de pago se puede pasar a true por org.
        noindex: true,
        // White-label B2B: nada de CTAs de captación de PerfilaPro al visitante.
        // El cliente B2B paga por la exclusividad del espacio.
        noPromo: true,
      }),
    };
  };
}

exports.handler = makeHandler({ getDb, getOrgBySlug, listCardsByOrg });
exports.makeHandler = makeHandler;
