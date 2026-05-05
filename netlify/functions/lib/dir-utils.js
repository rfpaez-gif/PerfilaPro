'use strict';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

const SECTOR_LABELS = {
  oficios:    'Oficios',
  salud:      'Salud',
  educacion:  'Educación',
  comercial:  'Comercial',
  belleza:    'Belleza',
  reforma:    'Reforma',
  hosteleria: 'Hostelería',
  tech:       'Tecnología',
  legal:      'Legal',
  jardineria: 'Jardinería',
  transporte: 'Transporte',
  fotografia: 'Fotografía',
  eventos:    'Eventos',
  automocion: 'Automoción',
  seguridad:  'Seguridad',
  cuidados:   'Cuidados',
  fitness:    'Fitness',
  turismo:    'Turismo',
  comercio:   'Comercio',
  otro:       'Otros',
};

function labelOf(sector, fromMeta) {
  return fromMeta || SECTOR_LABELS[sector] || sector.charAt(0).toUpperCase() + sector.slice(1).replace(/-/g, ' ');
}

/* ─────────────────────────────────────────────────────
   PerfilaPro · Directorio + Perfil público · SISTEMA GENERAL
   Hex hardcoded sincronizado con --pp-color-* (sin sufijo)
   de public/styles/tokens.css. Cualquier cambio de paleta debe
   tocar AMBOS archivos en el MISMO commit.
   No usar el registro cálido aquí: estas páginas son la
   superficie SEO/marketing del producto y comparten paleta
   con landing/admin/agente.
   ───────────────────────────────────────────────────── */

const DIR_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --color-crema:#FAF7F0;
  --color-piedra:#F7F8FA;
  --color-tinta:#0A1F44;
  --color-gris-500:#6B7280;
  --color-verde-match:#00C277;
  --color-verde-dark:#00A865;
  --color-verde-light:#E6F9F0;
  --color-gris-200:#E5E7EB;
  --pp-wa:#25D366; /* TODO: brand color de WhatsApp, no existe en la paleta. Decidir si CTA WA pasa a verde-match o conserva el brand verde. */
  --pp-wa-deep:#1CB058; /* TODO: ídem (hover del CTA WA). */
  --pp-r-md:14px;
  --pp-r-lg:20px;
  --pp-r-pill:999px;
  --pp-shadow:0 4px 16px rgba(10,31,68,.06);
  --pp-shadow-lg:0 12px 32px rgba(10,31,68,.08);
  --pp-f-display:'Fraunces',Georgia,'Times New Roman',serif;
  --pp-f-sans:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
}
body{font-family:var(--pp-f-sans);background:var(--color-crema);color:var(--color-tinta);-webkit-font-smoothing:antialiased;min-height:100dvh;display:flex;flex-direction:column}
a{color:inherit;text-decoration:none}
.pp-site-hd{display:flex;align-items:center;justify-content:space-between;padding:.875rem 1.25rem;border-bottom:1px solid var(--color-gris-200);background:#FFFFFF;position:sticky;top:0;z-index:10}
.pp-site-hd__logo{font-family:var(--pp-f-display);font-size:1.25rem;letter-spacing:-0.02em;color:var(--color-tinta)}
.pp-site-hd__cta{padding:.5rem 1rem;background:var(--color-verde-match);color:#fff;border-radius:var(--pp-r-pill);font-size:.8125rem;font-weight:700;transition:background .15s}
.pp-site-hd__cta:hover{background:var(--color-verde-dark)}
.pp-breadcrumb{padding:.625rem 1.25rem;font-size:.8125rem;color:var(--color-gris-500);border-bottom:1px solid var(--color-gris-200);background:#FFFFFF}
.pp-breadcrumb ol{list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem}
.pp-breadcrumb a{color:var(--color-verde-dark);font-weight:600}
.pp-breadcrumb a:hover{text-decoration:underline}
.pp-breadcrumb__sep{color:var(--color-gris-500);user-select:none}
main{flex:1;max-width:960px;width:100%;margin:0 auto;padding:1.5rem 1.25rem 3rem}
.pp-dir-ph{margin-bottom:1.25rem}
.pp-dir-ph h1{font-family:var(--pp-f-display);font-size:1.875rem;line-height:1.2;font-weight:400;letter-spacing:-0.02em;color:var(--color-tinta)}
.pp-dir-ph__desc{font-size:.9375rem;color:var(--color-gris-500);margin-top:.5rem;line-height:1.6;max-width:60ch}
.pp-dir-ph__count{font-size:.8125rem;color:var(--color-gris-500);margin-top:.375rem}
.pp-sub-section{margin:.875rem 0 1.25rem}
.pp-sub-section__label{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-gris-500);margin-bottom:.5rem}
.pp-sub-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.pp-sub-chip{padding:.4375rem .9375rem;border-radius:var(--pp-r-pill);font-size:.8125rem;font-weight:600;background:#FFFFFF;border:1.5px solid var(--color-gris-200);color:var(--color-tinta);transition:background .15s,border-color .15s,color .15s}
.pp-sub-chip:hover,.pp-sub-chip--active{background:var(--color-verde-light);border-color:var(--color-verde-dark);color:var(--color-verde-dark)}
.pp-dir-grid{display:grid;gap:.625rem}
.pp-dir-card{display:grid;grid-template-columns:56px 1fr 28px;gap:.875rem;align-items:center;padding:1rem 1.125rem;background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:1rem;transition:box-shadow .18s,border-color .18s}
.pp-dir-card:hover{box-shadow:var(--pp-shadow);border-color:var(--color-verde-dark)}
.pp-dir-card--featured{border-color:var(--color-verde-dark);background:var(--color-verde-light)}
.pp-dir-card__feat{font-size:.75em;vertical-align:.1em}
.pp-dir-card__av{width:56px;height:56px;border-radius:50%;background:var(--color-verde-light);border:1.5px solid var(--color-gris-200);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.pp-dir-card__av img{width:100%;height:100%;object-fit:cover}
.pp-dir-card__av-init{font-family:var(--pp-f-display);font-size:1.5rem;color:var(--color-verde-dark);line-height:1}
.pp-dir-card__body{min-width:0}
.pp-dir-card__name{font-size:.9375rem;font-weight:700;line-height:1.25;color:var(--color-tinta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-dir-card__role{font-size:.8125rem;color:var(--color-verde-dark);font-weight:600;margin-top:.2rem}
.pp-dir-card__loc{font-size:.75rem;color:var(--color-gris-500);margin-top:.2rem;display:flex;align-items:center;gap:.25rem}
.pp-dir-card__arrow{width:28px;height:28px;border-radius:50%;background:var(--color-crema);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--color-gris-500);transition:background .15s,color .15s}
.pp-dir-card:hover .pp-dir-card__arrow{background:var(--color-verde-match);color:#fff}
.pp-dir-card--featured .pp-dir-card__arrow{background:var(--color-verde-light);color:var(--color-verde-dark)}
.pp-dir-card--featured:hover .pp-dir-card__arrow{background:var(--color-verde-match);color:#fff}
.pp-dir-empty{text-align:center;padding:3rem 1rem;background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:1rem}
.pp-dir-empty h2{font-family:var(--pp-f-display);font-size:1.125rem;letter-spacing:-0.02em;font-weight:400;margin-bottom:.5rem;color:var(--color-tinta)}
.pp-dir-empty p{color:var(--color-gris-500);font-size:.9375rem;line-height:1.6}
.pp-dir-cta{margin-top:2.5rem;padding:1.875rem 1.5rem;background:var(--color-verde-light);border:1.5px solid var(--color-verde-dark);border-radius:1.25rem;text-align:center}
.pp-dir-cta h2{font-family:var(--pp-f-display);font-size:1.375rem;line-height:1.2;letter-spacing:-0.02em;font-weight:400;color:var(--color-tinta);margin-bottom:.5rem}
.pp-dir-cta p{font-size:.9375rem;color:var(--color-gris-500);max-width:48ch;margin:0 auto 1.125rem;line-height:1.55}
.pp-dir-cta__btn{display:inline-flex;align-items:center;padding:.75rem 1.5rem;background:var(--color-verde-match);color:#fff;border-radius:var(--pp-r-pill);font-size:.9375rem;font-weight:700;transition:background .15s}
.pp-dir-cta__btn:hover{background:var(--color-verde-dark)}
.pp-pagination{display:flex;align-items:center;justify-content:center;gap:.75rem;margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--color-gris-200)}
.pp-pagination__btn{display:inline-flex;align-items:center;padding:.5rem 1.25rem;border-radius:var(--pp-r-pill);font-size:.875rem;font-weight:600;background:#FFFFFF;border:1.5px solid var(--color-gris-200);color:var(--color-tinta);transition:background .15s,border-color .15s}
a.pp-pagination__btn:hover{background:var(--color-verde-light);border-color:var(--color-verde-dark)}
.pp-pagination__btn--dis{opacity:.4;pointer-events:none}
.pp-pagination__info{font-size:.8125rem;color:var(--color-gris-500)}
.pp-site-ft{border-top:1px solid var(--color-gris-200);padding:1.5rem 1.25rem;text-align:center;font-size:.75rem;color:var(--color-gris-500)}
.pp-site-ft a{color:var(--color-verde-dark);font-weight:600}
:focus-visible{outline:2px solid var(--color-verde-match);outline-offset:2px}
@media(max-width:480px){
  main{padding:1.25rem .875rem 3rem}
  .pp-dir-card{grid-template-columns:44px 1fr 24px;gap:.625rem;padding:.875rem .875rem}
  .pp-dir-card__av{width:44px;height:44px}
  .pp-dir-card__av-init{font-size:1.25rem}
  .pp-dir-ph h1{font-size:1.5rem}
}
`;

const PROFILE_CSS = `
.pp-prof{max-width:640px;margin:0 auto}
.pp-prof__hero{display:grid;grid-template-columns:80px 1fr;gap:1.25rem;align-items:center;margin-bottom:1rem;padding:1.25rem;background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:1.25rem}
.pp-prof__av{width:80px;height:80px;border-radius:50%;background:var(--color-verde-light);border:2px solid var(--color-gris-200);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.pp-prof__av img{width:100%;height:100%;object-fit:cover}
.pp-prof__av-init{font-family:var(--pp-f-display);font-size:2rem;color:var(--color-verde-dark);line-height:1}
.pp-prof__name{font-family:var(--pp-f-display);font-size:1.625rem;line-height:1.15;letter-spacing:-0.02em;font-weight:400;color:var(--color-tinta)}
.pp-prof__role{font-size:.875rem;color:var(--color-verde-dark);font-weight:600;margin-top:.25rem}
.pp-prof__loc{font-size:.8125rem;color:var(--color-gris-500);margin-top:.3rem;display:flex;align-items:center;gap:.3rem}
.pp-prof-section{background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:1.25rem;padding:1.125rem 1.25rem;margin-bottom:.75rem}
.pp-prof-section__label{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-gris-500);margin-bottom:.625rem}
.pp-prof-section__desc{font-size:.9375rem;color:var(--color-gris-500);line-height:1.75}
.pp-prof-svc-list{display:grid;gap:.375rem}
.pp-prof-svc{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.75rem .875rem;border-radius:var(--pp-r-md);background:var(--color-piedra);border:1px solid transparent}
.pp-prof-svc--lead{background:var(--color-verde-light);border-color:var(--color-verde-dark)}
.pp-prof-svc__name{font-size:.875rem;font-weight:600;color:var(--color-tinta);min-width:0;flex:1}
.pp-prof-svc__price{font-size:.8125rem;font-weight:700;color:var(--color-verde-dark);white-space:nowrap}
.pp-prof-contact{display:grid;gap:.625rem;margin-bottom:.75rem}
.pp-prof-cta{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.9375rem 1.25rem;border-radius:var(--pp-r-pill);font-family:var(--pp-f-sans);font-weight:700;text-decoration:none;cursor:pointer;border:none;min-height:52px;width:100%;transition:background .18s,opacity .18s;-webkit-tap-highlight-color:transparent;font-size:1rem}
.pp-prof-cta:active{opacity:.82;transform:scale(.98)}
.pp-prof-cta--wa{background:var(--pp-wa);color:#fff}
.pp-prof-cta--wa:hover{background:var(--pp-wa-deep)}
.pp-prof-cta--call{background:var(--color-piedra);color:var(--color-tinta);border:1.5px solid var(--color-gris-200);font-size:.875rem}
.pp-prof-cta--call:hover{background:var(--color-crema)}
.pp-prof-locked{padding:1.25rem;background:var(--color-piedra);border-radius:var(--pp-r-md);text-align:center}
.pp-prof-locked p{font-size:.875rem;color:var(--color-gris-500);line-height:1.6}
.pp-prof-locked a{color:var(--color-verde-dark);font-weight:600}
.pp-prof-banner{background:var(--color-verde-light);border:1.5px solid var(--color-verde-dark);border-radius:1.25rem;padding:1.25rem;text-align:center;margin-top:1.25rem}
.pp-prof-banner p{font-size:.9375rem;color:var(--color-gris-500);margin-bottom:.875rem;line-height:1.5}
.pp-prof-banner a{display:inline-flex;padding:.6875rem 1.5rem;background:var(--color-verde-match);color:#fff;border-radius:var(--pp-r-pill);font-size:.875rem;font-weight:700;transition:background .15s}
.pp-prof-banner a:hover{background:var(--color-verde-dark)}
.pp-prof-card-link{display:flex;align-items:center;justify-content:center;gap:.375rem;font-size:.8125rem;color:var(--color-verde-dark);font-weight:600;margin-bottom:1rem;padding:.625rem;background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:var(--pp-r-pill);transition:background .15s}
.pp-prof-card-link:hover{background:var(--color-verde-light)}
@media(max-width:480px){
  .pp-prof__hero{grid-template-columns:64px 1fr;gap:.875rem;padding:.875rem}
  .pp-prof__av{width:64px;height:64px}
  .pp-prof__av-init{font-size:1.625rem}
  .pp-prof__name{font-size:1.375rem}
}
`;

const PIN_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ARROW_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

function renderCard(p, siteUrl) {
  const isPaid = !!p.stripe_session_id || p.plan === 'pro' || p.plan === 'base';
  const avatarInitial = esc((p.nombre || '').trim().charAt(0).toUpperCase() || '?');
  const loc = p.city_name ? `${esc(p.city_name)}${p.province && p.province !== p.city_name ? `, ${esc(p.province)}` : ''}` : '';

  return `<a href="${esc(siteUrl)}/p/${esc(p.slug)}" class="pp-dir-card${p.directory_featured ? ' pp-dir-card--featured' : ''}">
  <div class="pp-dir-card__av">${isPaid && p.foto_url
    ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nombre)}" loading="lazy" width="56" height="56">`
    : `<span class="pp-dir-card__av-init">${avatarInitial}</span>`}</div>
  <div class="pp-dir-card__body">
    <p class="pp-dir-card__name">${esc(p.nombre)}${p.directory_featured ? ' <span class="pp-dir-card__feat">⭐</span>' : ''}</p>
    <p class="pp-dir-card__role">${esc(p.specialty_label || p.tagline || '')}</p>
    ${loc ? `<p class="pp-dir-card__loc">${PIN_SVG}${loc}</p>` : ''}
  </div>
  <div class="pp-dir-card__arrow">${ARROW_SVG}</div>
</a>`;
}

function breadcrumb(items) {
  return `<nav class="pp-breadcrumb" aria-label="Ruta de navegación"><ol>${
    items.map((item, i) => {
      const last = i === items.length - 1;
      const sep = i > 0 ? `<li class="pp-breadcrumb__sep" aria-hidden="true">›</li>` : '';
      return last
        ? `${sep}<li><span aria-current="page">${esc(item.label)}</span></li>`
        : `${sep}<li><a href="${esc(item.url)}">${esc(item.label)}</a></li>`;
    }).join('')
  }</ol></nav>`;
}

function getPageRange(rawPage, pageSize = 20) {
  const page = Math.max(1, parseInt(rawPage, 10) || 1);
  const from = (page - 1) * pageSize;
  return { page, from, to: from + pageSize - 1 };
}

function buildDirectoryMeta({ sectorLabel = '', specialtyLabel = '', cityName = '' } = {}) {
  if (cityName && specialtyLabel) {
    return {
      title: `${specialtyLabel} en ${cityName} | PerfilaPro`,
      desc:  `Encuentra ${specialtyLabel.toLowerCase()} en ${cityName}. Directorio de profesionales actualizado en PerfilaPro.`,
    };
  }
  if (specialtyLabel) {
    return {
      title: `${specialtyLabel} en España | PerfilaPro`,
      desc:  `Encuentra ${specialtyLabel.toLowerCase()} cerca de ti. Directorio actualizado en PerfilaPro.`,
    };
  }
  return {
    title: `${sectorLabel} profesionales en España | PerfilaPro`,
    desc:  `Encuentra profesionales de ${sectorLabel.toLowerCase()} cerca de ti. Directorio actualizado en PerfilaPro.`,
  };
}

function paginationLinks(page, totalPages, baseUrl) {
  if (totalPages <= 1) return '';
  const prev = page > 1 ? `${baseUrl}?p=${page - 1}` : null;
  const next = page < totalPages ? `${baseUrl}?p=${page + 1}` : null;
  return `<nav class="pp-pagination" aria-label="Paginación">
  ${prev ? `<a href="${esc(prev)}" class="pp-pagination__btn" rel="prev">← Anterior</a>` : '<span class="pp-pagination__btn pp-pagination__btn--dis" aria-disabled="true">← Anterior</span>'}
  <span class="pp-pagination__info">Página ${page} de ${totalPages}</span>
  ${next ? `<a href="${esc(next)}" class="pp-pagination__btn" rel="next">Siguiente →</a>` : '<span class="pp-pagination__btn pp-pagination__btn--dis" aria-disabled="true">Siguiente →</span>'}
</nav>`;
}

function htmlPage({ title, desc, canonical, prevUrl, nextUrl, body, crumbs, siteUrl, jsonLd, extraCss = '', ogImage = null, ogType = 'website' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(canonical)}">
  ${prevUrl ? `<link rel="prev" href="${esc(prevUrl)}">` : ''}
  ${nextUrl ? `<link rel="next" href="${esc(nextUrl)}">` : ''}
  <meta property="og:type" content="${esc(ogType)}">
  <meta property="og:site_name" content="PerfilaPro">
  <meta property="og:locale" content="es_ES">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  ${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
  ${jsonLd ? `<script type="application/ld+json">${safeJson(jsonLd)}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,700;1,9..144,400&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${DIR_CSS}${extraCss}</style>
</head>
<body>
  <header class="pp-site-hd">
    <a href="${esc(siteUrl)}" class="pp-site-hd__logo">PerfilaPro</a>
    <a href="${esc(siteUrl)}/#crear" class="pp-site-hd__cta">Crea tu perfil →</a>
  </header>
  ${crumbs ? breadcrumb(crumbs) : ''}
  <main>${body}</main>
  <footer class="pp-site-ft">
    <p>© PerfilaPro &nbsp;·&nbsp; <a href="${esc(siteUrl)}/directorio">Directorio</a> &nbsp;·&nbsp; <a href="${esc(siteUrl)}/terminos.html">Términos</a> &nbsp;·&nbsp; <a href="${esc(siteUrl)}/privacidad.html">Privacidad</a></p>
  </footer>
</body>
</html>`;
}

// Subtítulo visible compartido por las páginas internas del directorio.
// Reemplaza al render del meta_desc ("Encuentra X cerca de ti"), que
// es copy SEO orientado a marketplace y choca con el reposicionamiento
// como escaparate.
const SHOWCASE_INTRO = 'Cada uno con su URL, su QR y su WhatsApp en PerfilaPro.';

// CTA showcase al pie de cada página del directorio. Misma promesa que
// el bloque inferior de /directorio (index escaparate).
function buildShowcaseCta(siteUrl) {
  return `<aside class="pp-dir-cta">
  <h2>¿Tu trabajo también merece verse?</h2>
  <p>Crea tu perfil en 2 minutos. Tu URL propia, tu QR y un botón directo de WhatsApp.</p>
  <a href="${esc(siteUrl)}/alta.html" class="pp-dir-cta__btn">Crear mi perfil gratis →</a>
</aside>`;
}

module.exports = {
  esc, safeJson, SECTOR_LABELS, labelOf,
  DIR_CSS, PROFILE_CSS,
  renderCard, breadcrumb, paginationLinks, htmlPage,
  getPageRange, buildDirectoryMeta,
  SHOWCASE_INTRO, buildShowcaseCta,
};
