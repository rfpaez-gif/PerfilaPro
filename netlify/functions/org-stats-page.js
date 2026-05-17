'use strict';

const { createClient } = require('@supabase/supabase-js');
const { isValidOrgSlug, isValidHex, isSafeLogoUrl } = require('./lib/org-utils');
const { authenticateOrgStats, computeOrgStats } = require('./lib/org-stats-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(statusCode, html) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body: html,
  };
}

function notFoundPage() {
  return htmlResponse(404, `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Estadísticas no disponibles — PerfilaPro</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#FAF7F0;color:#0A1F44;margin:0;padding:2rem}div{max-width:480px;text-align:center}h1{font-family:'Source Serif 4',Georgia,serif;font-size:1.5rem;margin-bottom:.75rem;font-weight:400;letter-spacing:-0.02em}p{color:#6B7280;margin:0;line-height:1.6}</style>
</head><body><div>
<h1>Estadísticas no disponibles</h1>
<p>El enlace ha caducado o no es válido. Pide al administrador de tu organización que te envíe un enlace nuevo desde el panel.</p>
</div></body></html>`);
}

function renderSparkline(byDay, accent) {
  const W = 720, H = 140, P = 12;
  const data = byDay.map(d => d.count);
  const max = Math.max(1, ...data);
  const xStep = (W - P * 2) / Math.max(1, data.length - 1);
  const yScale = (H - P * 2) / max;

  const points = data.map((v, i) => {
    const x = P + i * xStep;
    const y = H - P - v * yScale;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(' L ')}`;
  const areaPath = `${path} L ${(P + (data.length - 1) * xStep).toFixed(1)},${H - P} L ${P},${H - P} Z`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Visitas por día (últimos 30 días)" style="width:100%;height:140px;display:block">
    <path d="${areaPath}" fill="${accent}" fill-opacity="0.12" stroke="none"/>
    <path d="${path}" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderPage({ org, stats, accent, logoUrl, siteUrl }) {
  const totals = stats.totals;
  const fmtN = (n) => new Intl.NumberFormat('es-ES').format(n);

  const memberRows = stats.by_member.length
    ? stats.by_member.map(m => `<tr>
        <td><a href="${siteUrl}/c/${esc(m.slug)}" target="_blank" rel="noopener">${esc(m.nombre)}</a></td>
        <td class="num">${fmtN(m.visits_7d)}</td>
        <td class="num">${fmtN(m.visits_30d)}</td>
        <td class="num">${fmtN(m.visits_all)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#6B7280;padding:1.5rem 0">Aún no hay profesionales activos en esta organización.</td></tr>`;

  return `<!DOCTYPE html><html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Estadísticas · ${esc(org.name)} — PerfilaPro</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --ink:#0A1F44;
      --crema:#FAF7F0;
      --gris-200:#E5E7EB;
      --gris-500:#6B7280;
      --gris-700:#374151;
      --accent:${accent};
      --font-serif:'Source Serif 4',Georgia,serif;
      --font-sans:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
    }
    body{font-family:var(--font-sans);background:var(--crema);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased;padding:1.5rem 1rem 3rem}
    .pp-stats{max-width:920px;margin:0 auto}
    .pp-stats__hero{background:var(--accent);color:#FFFFFF;padding:1.75rem 1.5rem;border-radius:1.25rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
    .pp-stats__hero-logo{background:#FFFFFF;padding:.5rem .625rem;border-radius:.625rem;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.12)}
    .pp-stats__hero-logo img{display:block;max-height:36px;max-width:120px}
    .pp-stats__hero-meta{flex:1;min-width:0}
    .pp-stats__hero-eyebrow{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;opacity:.85;margin-bottom:.25rem}
    .pp-stats__hero-name{font-family:var(--font-serif);font-size:1.5rem;font-weight:500;letter-spacing:-0.02em;line-height:1.2}
    .pp-stats__hero-link{font-size:.8125rem;opacity:.85;text-decoration:underline;text-underline-offset:3px;color:#FFFFFF;display:inline-block;margin-top:.375rem}
    .pp-stats__hero-link:hover{opacity:1}
    .pp-stats__kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-bottom:1.25rem}
    @media(max-width:700px){.pp-stats__kpis{grid-template-columns:repeat(2,1fr)}}
    .pp-kpi{background:#FFFFFF;border:1px solid var(--gris-200);border-radius:1rem;padding:1rem 1.125rem}
    .pp-kpi__label{font-size:.6875rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gris-500);font-weight:600;margin-bottom:.375rem}
    .pp-kpi__value{font-family:var(--font-serif);font-size:1.875rem;font-weight:500;line-height:1;letter-spacing:-0.02em}
    .pp-kpi__hint{font-size:.75rem;color:var(--gris-500);margin-top:.25rem}
    .pp-card{background:#FFFFFF;border:1px solid var(--gris-200);border-radius:1rem;padding:1.25rem 1.25rem;margin-bottom:1.25rem}
    .pp-card__title{font-family:var(--font-serif);font-size:1.125rem;font-weight:500;letter-spacing:-0.01em;margin-bottom:.875rem}
    .pp-card__sub{font-size:.8125rem;color:var(--gris-500);margin-top:-.5rem;margin-bottom:.875rem}
    .pp-table{width:100%;border-collapse:collapse;font-size:.875rem}
    .pp-table th,.pp-table td{padding:.625rem .5rem;border-bottom:1px solid var(--gris-200);text-align:left}
    .pp-table th{font-size:.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--gris-500)}
    .pp-table td a{color:var(--ink);text-decoration:none;font-weight:500;border-bottom:1px solid transparent;transition:border-color .15s}
    .pp-table td a:hover{border-color:var(--ink)}
    .pp-table .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--gris-700)}
    .pp-foot{margin-top:2rem;text-align:center;font-size:.75rem;color:var(--gris-500);line-height:1.6}
    .pp-foot a{color:var(--accent);text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <main class="pp-stats">
    <header class="pp-stats__hero">
      ${logoUrl ? `<div class="pp-stats__hero-logo"><img src="${esc(logoUrl)}" alt="${esc(org.name)}" loading="eager"></div>` : ''}
      <div class="pp-stats__hero-meta">
        <p class="pp-stats__hero-eyebrow">Estadísticas · ${stats.members} ${stats.members === 1 ? 'profesional' : 'profesionales'}</p>
        <h1 class="pp-stats__hero-name">${esc(org.name)}</h1>
        <a class="pp-stats__hero-link" href="${siteUrl}/e/${esc(org.slug)}" target="_blank" rel="noopener">Ver página pública →</a>
      </div>
    </header>

    <section class="pp-stats__kpis">
      <div class="pp-kpi">
        <p class="pp-kpi__label">Visitas · 7 días</p>
        <p class="pp-kpi__value">${fmtN(totals.visits_7d)}</p>
        <p class="pp-kpi__hint">Últimos 7 días</p>
      </div>
      <div class="pp-kpi">
        <p class="pp-kpi__label">Visitas · 30 días</p>
        <p class="pp-kpi__value">${fmtN(totals.visits_30d)}</p>
        <p class="pp-kpi__hint">Últimos 30 días</p>
      </div>
      <div class="pp-kpi">
        <p class="pp-kpi__label">Visitas totales</p>
        <p class="pp-kpi__value">${fmtN(totals.visits_all)}</p>
        <p class="pp-kpi__hint">Histórico</p>
      </div>
      <div class="pp-kpi">
        <p class="pp-kpi__label">Profesionales</p>
        <p class="pp-kpi__value">${stats.members}</p>
        <p class="pp-kpi__hint">Activos</p>
      </div>
    </section>

    <section class="pp-card">
      <h2 class="pp-card__title">Visitas por día</h2>
      <p class="pp-card__sub">Últimos 30 días, suma de toda la organización</p>
      ${renderSparkline(stats.by_day, accent)}
    </section>

    <section class="pp-card">
      <h2 class="pp-card__title">Profesionales</h2>
      <p class="pp-card__sub">Ordenado por visitas en los últimos 30 días</p>
      <table class="pp-table">
        <thead>
          <tr>
            <th>Profesional</th>
            <th class="num">7d</th>
            <th class="num">30d</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${memberRows}</tbody>
      </table>
    </section>

    <footer class="pp-foot">
      <p>Panel privado · solo accesible con tu enlace personal.</p>
      <p style="margin-top:.5rem">Powered by <a href="${siteUrl}/es/empresas">PerfilaPro</a></p>
    </footer>
  </main>
</body>
</html>`;
}

function fmtN(n) {
  return new Intl.NumberFormat('es-ES').format(n);
}

function makeHandler(deps) {
  const { db } = deps;

  return async (event) => {
    const rl = checkRateLimit(event, {
      bucket: 'org-stats-page',
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    // /e/:slug/stats — slug viaja en path (Netlify lo pasa también a query como :slug)
    const slug  = event.queryStringParameters?.slug || (event.path || '').split('/').filter(Boolean)[1];
    const token = event.queryStringParameters?.token;

    if (!slug || !token || !isValidOrgSlug(slug)) {
      return notFoundPage();
    }

    const org = await authenticateOrgStats(db, slug, token);
    if (!org) return notFoundPage();

    const stats = await computeOrgStats(db, org.id);

    const accent  = isValidHex(org.color_primary) ? org.color_primary : '#0A1F44';
    const logoUrl = isSafeLogoUrl(org.logo_url) ? org.logo_url : null;

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;

    return htmlResponse(200, renderPage({ org, stats, accent, logoUrl, siteUrl }));
  };
}

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = makeHandler({ db: defaultDb });
exports.makeHandler = makeHandler;
