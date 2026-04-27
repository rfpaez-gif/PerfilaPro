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

const DIR_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f6f3ee;--surface:#fcfbf8;--surface-2:#f2eee8;
  --text:#1f1a14;--muted:#6f675c;--faint:#aaa193;
  --primary:#01696f;--primary-h:#0c4e54;--primary-bg:rgba(1,105,111,.08);
  --wa:#25D366;--line:rgba(31,26,20,.10);
  --ff-d:"Instrument Serif",Georgia,serif;
  --ff-b:"Plus Jakarta Sans",system-ui,sans-serif;
  --r-sm:.75rem;--r-md:1rem;--r-lg:1.5rem;--r-full:999px;
  --shadow:0 4px 16px rgba(20,20,20,.07)
}
body{font-family:var(--ff-b);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;min-height:100dvh;display:flex;flex-direction:column}
a{color:inherit;text-decoration:none}
.site-hd{display:flex;align-items:center;justify-content:space-between;padding:.875rem 1.25rem;border-bottom:1px solid var(--line);background:var(--surface);position:sticky;top:0;z-index:10}
.site-logo{font-family:var(--ff-d);font-size:1.25rem;color:var(--primary)}
.hd-cta{padding:.5rem 1rem;background:var(--primary);color:#fff;border-radius:var(--r-full);font-size:.8125rem;font-weight:700;transition:background .15s}
.hd-cta:hover{background:var(--primary-h)}
.breadcrumb{padding:.625rem 1.25rem;font-size:.8125rem;color:var(--muted);border-bottom:1px solid var(--line);background:var(--surface)}
.breadcrumb ol{list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem}
.breadcrumb a{color:var(--primary)}
.breadcrumb a:hover{text-decoration:underline}
.bc-sep{color:var(--faint);user-select:none}
main{flex:1;max-width:960px;width:100%;margin:0 auto;padding:1.5rem 1.25rem 3rem}
.dir-ph{margin-bottom:1.25rem}
.dir-ph h1{font-family:var(--ff-d);font-size:1.875rem;line-height:1.2;font-weight:400}
.dir-ph-desc{font-size:.9375rem;color:var(--muted);margin-top:.5rem;line-height:1.6;max-width:60ch}
.dir-count{font-size:.8125rem;color:var(--faint);margin-top:.375rem}
.sub-section{margin:.875rem 0 1.25rem}
.sub-section-label{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:.5rem}
.sub-chips{display:flex;flex-wrap:wrap;gap:.5rem}
.sub-chip{padding:.4375rem .9375rem;border-radius:var(--r-full);font-size:.8125rem;font-weight:600;background:var(--surface);border:1.5px solid var(--line);color:var(--text);transition:background .15s,border-color .15s}
.sub-chip:hover,.sub-chip--active{background:var(--primary-bg);border-color:rgba(1,105,111,.3);color:var(--primary)}
.dir-grid{display:grid;gap:.625rem}
.dir-card{display:grid;grid-template-columns:56px 1fr 28px;gap:.875rem;align-items:center;padding:1rem 1.125rem;background:var(--surface);border:1px solid var(--line);border-radius:1rem;transition:box-shadow .18s,border-color .18s}
.dir-card:hover{box-shadow:var(--shadow);border-color:rgba(1,105,111,.22)}
.dir-card--featured{border-color:rgba(1,105,111,.22);background:rgba(1,105,111,.025)}
.dir-av{width:56px;height:56px;border-radius:50%;background:var(--primary-bg);border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.dir-av img{width:100%;height:100%;object-fit:cover}
.dir-av-init{font-family:var(--ff-d);font-size:1.5rem;color:var(--primary);line-height:1}
.dir-body{min-width:0}
.dir-name{font-size:.9375rem;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dir-role{font-size:.8125rem;color:var(--primary);font-weight:600;margin-top:.2rem}
.dir-loc{font-size:.75rem;color:var(--muted);margin-top:.2rem;display:flex;align-items:center;gap:.25rem}
.dir-arrow{width:28px;height:28px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted);transition:background .15s}
.dir-card:hover .dir-arrow{background:var(--primary);color:#fff}
.dir-card--featured .dir-arrow{background:var(--primary-bg);color:var(--primary)}
.dir-card--featured:hover .dir-arrow{background:var(--primary);color:#fff}
.dir-empty{text-align:center;padding:3rem 1rem;background:var(--surface);border:1px solid var(--line);border-radius:1rem}
.dir-empty h2{font-size:1.125rem;margin-bottom:.5rem;font-family:var(--ff-d);font-weight:400}
.dir-empty p{color:var(--muted);font-size:.9375rem;line-height:1.6}
.pagination{display:flex;align-items:center;justify-content:center;gap:.75rem;margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.pag-btn{display:inline-flex;align-items:center;padding:.5rem 1.25rem;border-radius:var(--r-full);font-size:.875rem;font-weight:600;background:var(--surface);border:1.5px solid var(--line);color:var(--text);transition:background .15s}
a.pag-btn:hover{background:var(--surface-2)}
.pag-btn--dis{opacity:.4;pointer-events:none}
.pag-info{font-size:.8125rem;color:var(--muted)}
.site-ft{border-top:1px solid var(--line);padding:1.5rem 1.25rem;text-align:center;font-size:.75rem;color:var(--faint)}
.site-ft a{color:var(--primary)}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
@media(max-width:480px){
  main{padding:1.25rem .875rem 3rem}
  .dir-card{grid-template-columns:44px 1fr 24px;gap:.625rem;padding:.875rem .875rem}
  .dir-av{width:44px;height:44px}
  .dir-av-init{font-size:1.25rem}
  .dir-ph h1{font-size:1.5rem}
}
`;

const PROFILE_CSS = `
.prof-wrap{max-width:640px;margin:0 auto}
.prof-hero{display:grid;grid-template-columns:80px 1fr;gap:1.25rem;align-items:center;margin-bottom:1rem;padding:1.25rem;background:var(--surface);border:1px solid var(--line);border-radius:1.25rem}
.prof-av{width:80px;height:80px;border-radius:50%;background:var(--primary-bg);border:2px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.prof-av img{width:100%;height:100%;object-fit:cover}
.prof-av-init{font-family:var(--ff-d);font-size:2rem;color:var(--primary);line-height:1}
.prof-name{font-family:var(--ff-d);font-size:1.625rem;line-height:1.15;font-weight:400}
.prof-role{font-size:.875rem;color:var(--primary);font-weight:600;margin-top:.25rem}
.prof-loc{font-size:.8125rem;color:var(--muted);margin-top:.3rem;display:flex;align-items:center;gap:.3rem}
.prof-section{background:var(--surface);border:1px solid var(--line);border-radius:1.25rem;padding:1.125rem 1.25rem;margin-bottom:.75rem}
.prof-section-lbl{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:.625rem}
.prof-desc{font-size:.9375rem;color:var(--muted);line-height:1.75}
.prof-svc-list{display:grid;gap:.375rem}
.prof-svc-item{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.75rem .875rem;border-radius:var(--r-md);background:var(--surface-2);border:1px solid transparent}
.prof-svc-item--lead{background:rgba(1,105,111,.07);border-color:rgba(1,105,111,.15)}
.prof-svc-name{font-size:.875rem;font-weight:600;min-width:0;flex:1}
.prof-svc-price{font-size:.8125rem;font-weight:700;color:var(--primary);white-space:nowrap}
.prof-contact{display:grid;gap:.625rem;margin-bottom:.75rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.9375rem 1.25rem;border-radius:var(--r-full);font-family:var(--ff-b);font-weight:700;text-decoration:none;cursor:pointer;border:none;min-height:52px;width:100%;transition:background .18s,opacity .18s;-webkit-tap-highlight-color:transparent;font-size:1rem}
.btn:active{opacity:.82;transform:scale(.98)}
.btn--wa{background:var(--wa);color:#fff}
.btn--wa:hover{background:#1db953}
.btn--call{background:var(--surface-2);color:var(--text);border:1.5px solid var(--line);font-size:.875rem}
.btn--call:hover{background:var(--bg)}
.contact-locked{padding:1.25rem;background:var(--surface-2);border-radius:var(--r-md);text-align:center}
.contact-locked p{font-size:.875rem;color:var(--muted);line-height:1.6}
.contact-locked a{color:var(--primary);font-weight:600}
.prof-cta{background:var(--primary-bg);border:1.5px solid rgba(1,105,111,.2);border-radius:1.25rem;padding:1.25rem;text-align:center;margin-top:1.25rem}
.prof-cta p{font-size:.9375rem;color:var(--muted);margin-bottom:.875rem;line-height:1.5}
.prof-cta a{display:inline-flex;padding:.6875rem 1.5rem;background:var(--primary);color:#fff;border-radius:var(--r-full);font-size:.875rem;font-weight:700;transition:background .15s}
.prof-cta a:hover{background:var(--primary-h)}
.prof-card-link{display:flex;align-items:center;justify-content:center;gap:.375rem;font-size:.8125rem;color:var(--primary);font-weight:600;margin-bottom:1rem;padding:.625rem;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-full);transition:background .15s}
.prof-card-link:hover{background:var(--primary-bg)}
@media(max-width:480px){
  .prof-hero{grid-template-columns:64px 1fr;gap:.875rem;padding:.875rem}
  .prof-av{width:64px;height:64px}
  .prof-av-init{font-size:1.625rem}
  .prof-name{font-size:1.375rem}
}
`;

const PIN_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ARROW_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

function renderCard(p, siteUrl) {
  const isPaid = !!p.stripe_session_id || p.plan === 'pro' || p.plan === 'base';
  const avatarInitial = esc((p.nombre || '').trim().charAt(0).toUpperCase() || '?');
  const loc = p.city_name ? `${esc(p.city_name)}${p.province && p.province !== p.city_name ? `, ${esc(p.province)}` : ''}` : '';

  return `<a href="${esc(siteUrl)}/p/${esc(p.slug)}" class="dir-card${p.directory_featured ? ' dir-card--featured' : ''}">
  <div class="dir-av">${isPaid && p.foto_url
    ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nombre)}" loading="lazy" width="56" height="56">`
    : `<span class="dir-av-init">${avatarInitial}</span>`}</div>
  <div class="dir-body">
    <p class="dir-name">${esc(p.nombre)}</p>
    <p class="dir-role">${esc(p.specialty_label || p.tagline || '')}</p>
    ${loc ? `<p class="dir-loc">${PIN_SVG}${loc}</p>` : ''}
  </div>
  <div class="dir-arrow">${ARROW_SVG}</div>
</a>`;
}

function breadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="Ruta de navegación"><ol>${
    items.map((item, i) => {
      const last = i === items.length - 1;
      const sep = i > 0 ? `<li class="bc-sep" aria-hidden="true">›</li>` : '';
      return last
        ? `${sep}<li><span aria-current="page">${esc(item.label)}</span></li>`
        : `${sep}<li><a href="${esc(item.url)}">${esc(item.label)}</a></li>`;
    }).join('')
  }</ol></nav>`;
}

function paginationLinks(page, totalPages, baseUrl) {
  if (totalPages <= 1) return '';
  const prev = page > 1 ? `${baseUrl}?p=${page - 1}` : null;
  const next = page < totalPages ? `${baseUrl}?p=${page + 1}` : null;
  return `<nav class="pagination" aria-label="Paginación">
  ${prev ? `<a href="${esc(prev)}" class="pag-btn" rel="prev">← Anterior</a>` : '<span class="pag-btn pag-btn--dis" aria-disabled="true">← Anterior</span>'}
  <span class="pag-info">Página ${page} de ${totalPages}</span>
  ${next ? `<a href="${esc(next)}" class="pag-btn" rel="next">Siguiente →</a>` : '<span class="pag-btn pag-btn--dis" aria-disabled="true">Siguiente →</span>'}
</nav>`;
}

function htmlPage({ title, desc, canonical, prevUrl, nextUrl, body, crumbs, siteUrl, jsonLd, extraCss = '' }) {
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
  ${jsonLd ? `<script type="application/ld+json">${safeJson(jsonLd)}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>${DIR_CSS}${extraCss}</style>
</head>
<body>
  <header class="site-hd">
    <a href="${esc(siteUrl)}" class="site-logo">PerfilaPro</a>
    <a href="${esc(siteUrl)}/#crear" class="hd-cta">Crea tu perfil →</a>
  </header>
  ${crumbs ? breadcrumb(crumbs) : ''}
  <main>${body}</main>
  <footer class="site-ft">
    <p>© PerfilaPro &nbsp;·&nbsp; <a href="${esc(siteUrl)}/directorio">Directorio</a> &nbsp;·&nbsp; <a href="${esc(siteUrl)}/terminos.html">Términos</a> &nbsp;·&nbsp; <a href="${esc(siteUrl)}/privacidad.html">Privacidad</a></p>
  </footer>
</body>
</html>`;
}

module.exports = {
  esc, safeJson, SECTOR_LABELS, labelOf,
  DIR_CSS, PROFILE_CSS,
  renderCard, breadcrumb, paginationLinks, htmlPage,
};
