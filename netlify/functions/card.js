const { createClient } = require('@supabase/supabase-js');
const { buildQrSvg } = require('./lib/qr-svg.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function normalizePhone(tel) {
  if (!tel) return null;
  const digits = String(tel).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('34')) return '+' + digits;
  if (digits.length === 9) return '+34' + digits;
  if (digits.length === 13 && digits.startsWith('0034')) return '+' + digits.substring(2);
  return '+' + digits;
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

exports.handler = async (event) => {
  // 1) Intentar leer slug de la query (?slug=...)
  const slugFromQuery = event.queryStringParameters?.slug;

  // 2) Fallback: intentar sacarlo del path por si se llama directo
  const slugFromPath = event.path
    .replace('/.netlify/functions/card', '')
    .replace(/^\/c\//, '')
    .replace(/\/$/, '');

  const slug = slugFromQuery || slugFromPath;

  if (!slug) {
    return { statusCode: 400, body: 'Missing slug' };
  }

  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('slug', slug)
    .in('status', ['active', 'free'])
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <title>Tarjeta no encontrada</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#FAF7F0;color:#0A1F44;margin:0}div{text-align:center;padding:1rem}h1{font-size:1.5rem;margin-bottom:.5rem;font-weight:700;letter-spacing:-0.02em}p{color:#6B7280;margin:0}</style>
      </head><body><div><h1>Tarjeta no encontrada</h1><p>Este perfil no existe o no está activo.</p></div></body></html>`
    };
  }

  const serviciosHTML = (data.servicios || []).map((s, i) => {
    const m = s.match(/^(.+?)[\s·\-–]+(\d[\d.,€\s\/h]*)$/);
    const nombre = esc(m ? m[1].trim() : s);
    const precio = esc(m ? m[2].trim() : '');
    return `<div class="pp-svc${i === 0 ? ' pp-svc--lead' : ''}">
      <span class="pp-svc__name">${nombre}</span>
      ${precio ? `<span class="pp-svc__price">${precio}</span>` : ''}
    </div>`;
  }).join('');

  const DEMO_SLUGS = ['paco-fontanero-alicante'];
  const isDemo = DEMO_SLUGS.includes(data.slug);

  if (isDemo && !data.foto_url) {
    data.foto_url = 'https://pplx-res.cloudinary.com/image/upload/pplx_search_images/ae1c272ba36742b81a35745691899c1f512df06d.jpg';
  }

  // Registrar visita de forma no bloqueante
  if (!isDemo) {
    supabase.from('visits').insert({ slug: data.slug }).then(({ error: ve }) => {
      if (ve) console.error('Error registrando visita:', ve.message);
    });
  }

  const waUrl = !isDemo && data.whatsapp
    ? `https://wa.me/${data.whatsapp}?text=${encodeURIComponent('Hola, he visto tu perfil en PerfilaPro y me interesa contactarte.')}`
    : null;

  const isFree = !data.stripe_session_id;
  const isPaid = isDemo || !!data.stripe_session_id;
  const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const host    = (event.headers && event.headers.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;
  const cardUrl = `${siteUrl}/c/${data.slug}`;

  let qrSvg = null;
  if (isPaid) {
    try {
      qrSvg = buildQrSvg(cardUrl, { size: 200 });
    } catch (qrErr) {
      console.error('Error generando QR:', qrErr.message);
    }
  }

  const isPro = isDemo || data.plan === 'pro';
  let visitCount = null;
  if (isPro) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('visits')
      .select('*', { count: 'exact', head: true })
      .eq('slug', data.slug)
      .gte('visited_at', thirtyDaysAgo);
    visitCount = count ?? 0;
  }

  const zonaParts = (data.zona || '').split(' · ');
  const zonaLocal = esc(zonaParts[0] || '');
  const zonaRange = zonaParts[1] ? esc(zonaParts[1]) : null;

  const avatarInitial = esc((data.nombre || '').trim().charAt(0).toUpperCase() || '?');
  const hasBothCtas = !!(waUrl && data.telefono);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(data.nombre) || 'Perfil profesional'} — PerfilaPro</title>
  <meta name="description" content="${esc(data.tagline)} ${esc(data.zona)}">
  <meta name="generator" content="PerfilaPro·${esc(data.slug)}${data.agent_code ? '·' + esc(data.agent_code) : ''}">
  <link rel="canonical" href="${siteUrl}/p/${data.slug}">
  <meta property="og:type" content="profile">
  <meta property="og:site_name" content="PerfilaPro">
  <meta property="og:locale" content="es_ES">
  <meta property="og:url" content="${siteUrl}/p/${data.slug}">
  <meta property="og:title" content="${esc(data.nombre)} — PerfilaPro">
  <meta property="og:description" content="${esc(data.tagline)}">
  <meta property="og:image" content="${siteUrl}/api/share-image?slug=${esc(data.slug)}&template=og">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(data.nombre)} — PerfilaPro">
  <meta name="twitter:description" content="${esc(data.tagline)}">
  <meta name="twitter:image" content="${siteUrl}/api/share-image?slug=${esc(data.slug)}&template=og">
  ${data.foto_url ? `<link rel="preload" as="image" href="${esc(data.foto_url)}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400..700;1,400..700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* ─────────────────────────────────────────────────────
       PerfilaPro · Tarjeta digital · REGISTRO CÁLIDO
       Hex hardcoded sincronizado con --pp-color-warm-* de
       public/styles/tokens.css y con el mapa COLORS de
       netlify/functions/lib/email-layout.js. Cualquier cambio
       de paleta debe tocar AMBOS archivos en el MISMO commit.
       ───────────────────────────────────────────────────── */
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --color-crema:#FAF7F0;
      --color-tinta:#0A1F44;
      --color-gris-500:#6B7280;
      --color-verde-match:#00C277;
      --color-verde-dark:#00A865;
      --color-verde-light:#E6F9F0;
      --color-gris-200:#E5E7EB;
      --pp-warning:#B8860B; /* TODO: el brief no define un color de warning. Decidir y migrar. */
      --pp-wa:#25D366; /* TODO: brand color de WhatsApp, no existe en la paleta. Decidir si CTA WA pasa a verde-match o conserva el brand verde. */
      --pp-wa-deep:#1CB058; /* TODO: ídem (hover del CTA WA). */
      --pp-r-md:1rem;
      --pp-r-lg:1.5rem;
      --pp-r-pill:999px;
      --pp-shadow:0 12px 32px rgba(30,27,20,.08);
      --font-serif:'Source Serif 4',Georgia,serif;
      --font-sans:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
    }
    body{font-family:var(--font-sans);background:var(--color-crema);color:var(--color-tinta);min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:1.5rem 1rem 3rem;-webkit-font-smoothing:antialiased}
    .pp-card{width:min(100%,420px);background:#FFFFFF;border:1px solid var(--color-gris-200);border-radius:var(--pp-r-lg);overflow:hidden;box-shadow:var(--pp-shadow)}
    .pp-card__header{display:flex;flex-direction:column;text-align:center;gap:.875rem;padding:1.25rem;border-bottom:1px solid var(--color-gris-200)}
    .pp-card__avatar{width:100%;aspect-ratio:1/1;border-radius:1rem;overflow:hidden;background:var(--color-verde-light);display:flex;align-items:center;justify-content:center}
    .pp-card__avatar img{width:100%;height:100%;object-fit:cover;display:block}
    .pp-card__avatar-init{font-family:var(--font-serif);font-size:clamp(4rem,18vw,6rem);color:var(--color-verde-match);line-height:1}
    .pp-card__name{font-family:var(--font-serif);font-size:1.75rem;line-height:1.15;letter-spacing:-0.02em;color:var(--color-tinta)}
    .pp-card__role{font-size:.9375rem;color:var(--color-gris-500);margin-top:.375rem;line-height:1.4}
    .pp-card__body{display:grid;grid-template-columns:minmax(0,1fr);gap:.875rem;padding:1.1rem 1.25rem 1.25rem}
    .pp-chips{display:flex;flex-wrap:wrap;gap:.375rem}
    .pp-chip{display:inline-flex;align-items:center;gap:.3rem;padding:.3rem .65rem;border-radius:var(--pp-r-pill);font-size:.6875rem;font-weight:600;line-height:1.3;max-width:100%;white-space:normal;overflow-wrap:anywhere}
    .pp-chip--loc{background:var(--color-crema);color:var(--color-gris-500);border:1px solid var(--color-gris-200)}
    .pp-chip--stat{background:var(--color-verde-light);color:var(--color-verde-match);border:1px solid var(--color-gris-200)}
    .pp-card__desc{font-size:.9375rem;color:var(--color-gris-500);line-height:1.75;background:var(--color-crema);border-radius:var(--pp-r-md);padding:.875rem 1rem;border:1px solid var(--color-gris-200)}
    .pp-svc-list{display:grid;gap:.375rem}
    .pp-svc{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.75rem .875rem;border-radius:var(--pp-r-md);background:var(--color-crema);border:1px solid transparent}
    .pp-svc--lead{background:var(--color-verde-light);border-color:var(--color-gris-200)}
    .pp-svc__name{font-size:.875rem;font-weight:600;color:var(--color-tinta);min-width:0;flex:1}
    .pp-svc__price{font-size:.8125rem;font-weight:700;color:var(--color-verde-match);white-space:nowrap}
    .pp-cta-group{display:grid;gap:.625rem}
    .pp-cta-group--dual{grid-template-columns:1fr auto}
    .pp-cta{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.9375rem 1.25rem;border-radius:var(--pp-r-pill);font-family:var(--font-sans);font-weight:700;text-decoration:none;cursor:pointer;border:none;min-height:52px;transition:background .18s,opacity .18s;-webkit-tap-highlight-color:transparent}
    .pp-cta:active{opacity:.82;transform:scale(.98)}
    .pp-cta--wa{background:var(--pp-wa);color:#fff;font-size:1rem}
    .pp-cta--wa:hover{background:var(--pp-wa-deep)}
    .pp-cta--call{background:var(--color-crema);color:var(--color-tinta);border:1.5px solid var(--color-gris-200);font-size:.875rem;padding:.9375rem 1.125rem}
    .pp-cta--call:hover{background:var(--color-verde-light)}
    .pp-utils{display:flex;align-items:center;justify-content:center;gap:.5rem}
    .pp-icon-btn{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid var(--color-gris-200);background:#FFFFFF;cursor:pointer;text-decoration:none;transition:background .15s;-webkit-tap-highlight-color:transparent;flex-shrink:0;color:var(--color-gris-500)}
    .pp-icon-btn:hover{background:var(--color-crema)}
    .pp-icon-btn:active{transform:scale(.9)}
    .pp-qr{display:flex;align-items:center;gap:.875rem;padding:.875rem 1rem;background:var(--color-crema);border-radius:var(--pp-r-md);border:1px solid var(--color-gris-200)}
    .pp-qr__code{position:relative;width:80px;height:80px;min-width:80px;max-width:80px;flex-shrink:0;border-radius:.5rem;overflow:hidden;background:#FFF}
    .pp-qr__code svg{width:80px;height:80px;max-width:100%;max-height:100%;display:block}
    .pp-qr__seal{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#FFF;padding:2px;border-radius:4px;box-shadow:0 0 0 2px #FFF}
    .pp-qr__seal-inner{display:flex;align-items:center;justify-content:center;background:var(--color-tinta);color:var(--color-verde-match);font-family:var(--font-serif);font-style:italic;font-weight:600;line-height:1;width:18px;height:18px;font-size:13px;border-radius:3px}
    .pp-qr__meta{display:grid;grid-template-columns:minmax(0,1fr);gap:.2rem;min-width:0;overflow:hidden}
    .pp-qr__meta p{font-size:.75rem;color:var(--color-gris-500);line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
    .pp-qr__strong{font-size:.8125rem;font-weight:600;color:var(--color-tinta);overflow-wrap:anywhere}
    .pp-qr__meta a{font-size:.75rem;color:var(--color-verde-match);text-decoration:none;font-weight:600;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
    .pp-qr__dl{display:inline-flex;align-items:center;gap:.3rem;margin-top:.375rem;padding:.3rem .7rem;background:var(--color-verde-match);color:#fff;border-radius:var(--pp-r-pill);font-size:.6875rem;font-weight:700;text-decoration:none}
    .pp-qr__dl:hover{background:var(--color-verde-dark)}
    .pp-qr__dl--alt{background:transparent;color:var(--color-verde-match);border:1px solid var(--color-verde-match);margin-left:.3rem}
    .pp-qr__dl--alt:hover{background:var(--color-verde-light)}
    .pp-free-banner{background:var(--color-verde-light);border:1px solid var(--color-gris-200);border-radius:var(--pp-r-md);padding:.75rem 1rem;margin:.75rem 0;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
    .pp-free-banner p{font-size:.8125rem;color:var(--pp-warning);margin:0}
    .pp-free-banner__btn{font-size:.8125rem;font-weight:700;color:#fff;background:var(--color-verde-match);padding:.35rem .875rem;border-radius:var(--pp-r-pill);text-decoration:none;white-space:nowrap}
    .pp-free-banner__btn:hover{background:var(--color-verde-dark)}
    .pp-card__pw{text-align:center;font-size:.6875rem;color:var(--color-gris-500);padding:.75rem 0 .125rem;border-top:1px solid var(--color-gris-200);line-height:1.6}
    .pp-card__pw strong{font-family:var(--font-serif);font-weight:600;letter-spacing:-0.02em;color:var(--color-tinta);font-size:.8125rem}
    .pp-logo__pro{font-family:var(--font-serif);font-style:italic;font-weight:600;color:var(--color-verde-match)}
    .pp-card__pw a{display:inline-block;margin-top:.3rem;padding:.3rem .875rem;background:var(--color-verde-match);color:#fff;border-radius:var(--pp-r-pill);font-size:.6875rem;font-weight:700;text-decoration:none}
    .pp-card__pw a:hover{background:var(--color-verde-dark)}
    .pp-page-foot{margin-top:1.5rem;font-size:.75rem;color:var(--color-gris-500);text-align:center}
    .pp-page-foot a{color:var(--color-verde-match);text-decoration:none}
    :focus-visible{outline:2px solid var(--color-verde-match);outline-offset:2px}
  </style>
  <script src="/js/posthog-init.js" defer></script>
  <script src="/js/privacy-banner.js" defer></script>
</head>
<body>
  <div class="pp-card">
    <div class="pp-card__header">
      <div class="pp-card__avatar">
        ${data.foto_url ? `<img src="${esc(data.foto_url)}" alt="${esc(data.nombre)}" loading="lazy">` : `<span class="pp-card__avatar-init">${avatarInitial}</span>`}
      </div>
      <div>
        <h1 class="pp-card__name">${esc(data.nombre)}</h1>
        ${data.tagline ? `<p class="pp-card__role">${esc(data.tagline)}</p>` : ''}
      </div>
    </div>
    <div class="pp-card__body">
      ${(data.zona || (isPro && visitCount !== null)) ? `<div class="pp-chips">
        ${data.zona ? `<span class="pp-chip pp-chip--loc"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${zonaLocal}${zonaRange ? ` &middot; ${zonaRange}` : ''}</span>` : ''}
        ${isPro && visitCount !== null ? `<span class="pp-chip pp-chip--stat"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${visitCount} visitas &middot; 30 d&iacute;as</span>` : ''}
      </div>` : ''}
      ${data.descripcion ? `<p class="pp-card__desc">${esc(data.descripcion)}</p>` : ''}
      ${serviciosHTML ? `<div class="pp-svc-list">${serviciosHTML}</div>` : ''}
      ${(waUrl || data.telefono) ? `<div class="pp-cta-group${hasBothCtas ? ' pp-cta-group--dual' : ''}">
        ${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener" class="pp-cta pp-cta--wa">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.535 5.858L0 24l6.335-1.652A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
          WhatsApp
        </a>` : ''}
        ${data.telefono ? `<a href="tel:${normalizePhone(data.telefono)}" class="pp-cta pp-cta--call">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.84a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.05 12.05 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Llamar
        </a>` : ''}
      </div>` : ''}
      <div class="pp-utils">
        <button class="pp-icon-btn" id="shareBtn" onclick="shareProfile()" title="Compartir" aria-label="Compartir perfil">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
        <a class="pp-icon-btn" href="https://wa.me/?text=${encodeURIComponent('Mira el perfil de ' + data.nombre + ': ' + cardUrl)}" target="_blank" rel="noopener" title="Compartir por WhatsApp" aria-label="Compartir por WhatsApp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 2C6.477 2 2 6.477 2 12c0 1.883.517 3.643 1.415 5.163L2 22l4.978-1.398A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>
        </a>
        <button class="pp-icon-btn" onclick="downloadVCard()" title="Añadir contacto" aria-label="Añadir a contactos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </button>
        <button class="pp-icon-btn" id="dlCardBtn" onclick="downloadCard(this)" title="Descargar tarjeta" aria-label="Descargar tarjeta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      ${qrSvg ? `<div class="pp-qr">
        <div class="pp-qr__code" aria-label="Código QR para ${esc(data.nombre)}">
          ${qrSvg}
          <span class="pp-qr__seal" aria-hidden="true"><span class="pp-qr__seal-inner">P</span></span>
        </div>
        <div class="pp-qr__meta">
          <p>Escanea para abrir este perfil</p>
          ${data.whatsapp ? `<p class="pp-qr__strong">${esc(normalizePhone(data.whatsapp))}</p>` : ''}
          ${data.email ? `<p>${esc(data.email)}</p>` : ''}
          ${data.direccion ? `<a href="https://maps.google.com/?q=${encodeURIComponent(data.direccion)}" target="_blank" rel="noopener">${esc(data.direccion)} &rarr;</a>` : ''}
          ${isPro ? `<div>
            <a href="/api/qr/${esc(data.slug)}" download="perfilapro-${esc(data.slug)}.svg" class="pp-qr__dl" title="SVG vectorial — escala infinita, ideal imprenta">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              SVG
            </a>
            <a href="/api/qr/${esc(data.slug)}?format=png&size=1024" download="perfilapro-${esc(data.slug)}.png" class="pp-qr__dl pp-qr__dl--alt" title="PNG 1024×1024 — para web/redes">PNG</a>
          </div>` : `<a href="/api/qr/${esc(data.slug)}?format=png&size=1024" download="perfilapro-${esc(data.slug)}.png" class="pp-qr__dl">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar QR
          </a>`}
        </div>
      </div>` : ''}
      ${isFree ? `<div class="pp-free-banner">
        <p><strong>Perfil básico</strong> · Sin foto, QR ni directorio</p>
      </div>` : ''}
      <div class="pp-card__pw">
        Creado con <strong>Perfila<span class="pp-logo__pro">Pro</span></strong><br>
        <a href="https://perfilapro.es">Crea tu propio perfil</a>
      </div>
    </div>
  </div>
  <div class="pp-page-foot">
    <a href="https://perfilapro.es" target="_blank">¿Quieres tu propio perfil? &rarr; PerfilaPro.es</a>
  </div>
  <script>
    var CARD = ${safeJson({
      nombre:      data.nombre      || '',
      tagline:     data.tagline     || '',
      whatsapp:    data.whatsapp    || '',
      telefono:    data.telefono    || '',
      zona:        data.zona        || '',
      descripcion: data.descripcion || '',
      servicios:   data.servicios   || [],
      foto_url:    data.foto_url    || '',
      slug:        data.slug,
      cardUrl:     cardUrl,
    })};

    function shareProfile() {
      var btn = document.getElementById('shareBtn');
      if (navigator.share) {
        navigator.share({ title: CARD.nombre, url: CARD.cardUrl }).catch(function(){});
      } else {
        navigator.clipboard.writeText(CARD.cardUrl).then(function() {
          var orig = btn.innerHTML;
          btn.textContent = '¡Copiado!';
          setTimeout(function() { btn.innerHTML = orig; }, 2000);
        });
      }
    }

    function downloadVCard() {
      var lines = ['BEGIN:VCARD','VERSION:3.0','FN:' + CARD.nombre];
      if (CARD.whatsapp) lines.push('TEL;TYPE=CELL:+' + CARD.whatsapp);
      if (CARD.telefono) {
        var telDigits = CARD.telefono.replace(/\\D/g,'');
        var telE164 = (telDigits.length === 11 && telDigits.indexOf('34') === 0) ? '+' + telDigits : '+34' + telDigits;
        lines.push('TEL;TYPE=WORK:' + telE164);
      }
      if (CARD.tagline)  lines.push('TITLE:' + CARD.tagline);
      if (CARD.zona)     lines.push('NOTE:' + CARD.zona);
      lines.push('URL:' + CARD.cardUrl);
      if (CARD.foto_url) lines.push('PHOTO;VALUE=URI:' + CARD.foto_url);
      lines.push('END:VCARD');
      var blob = new Blob([lines.join('\\r\\n')], { type: 'text/vcard' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = CARD.slug + '.vcf';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    async function downloadCard(btn) {
      var orig = btn.innerHTML; btn.textContent = 'Generando…'; btn.disabled = true;
      var svcs = (CARD.servicios || []).slice(0,5);
      var W = 800, H = 280 + svcs.length*58 + (CARD.zona ? 50 : 0) + 120;
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      // Hex sincronizados con --pp-color-warm-* (tokens.css) y mapa COLORS (lib/email-layout.js).
      var P = '#01696F', PL = '#E8EFEF', BG = '#FAF3E6', TX = '#1E1B14', MU = '#5C5246';

      ctx.fillStyle = BG; ctx.fillRect(0,0,W,H);
      ctx.shadowColor = 'rgba(30,27,20,.10)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#fff'; rrect(ctx,40,40,W-80,H-80,18); ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = P; rrectTop(ctx,40,40,W-80,160,18); ctx.fill();

      ctx.fillStyle = '#fff'; ctx.font = 'bold 38px Georgia,serif'; ctx.textBaseline = 'top';
      ctx.fillText(CARD.nombre, 80, 68);
      if (CARD.tagline) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '20px Arial,sans-serif'; ctx.fillText(CARD.tagline,80,120); }

      if (CARD.foto_url) {
        await new Promise(function(res) {
          var img = new Image(); img.crossOrigin = 'anonymous';
          img.onload = function() {
            ctx.save(); ctx.beginPath(); ctx.arc(W-100,110,52,0,Math.PI*2); ctx.clip();
            ctx.drawImage(img,W-152,58,104,104); ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(W-100,110,52,0,Math.PI*2); ctx.stroke(); res();
          };
          img.onerror = res; img.src = CARD.foto_url;
        });
      }

      var y = 220;
      if (svcs.length) {
        ctx.fillStyle = P; ctx.font = 'bold 11px Arial,sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('SERVICIOS', 80, y); y += 30;
        svcs.forEach(function(s,i) {
          var m = s.match(/^(.+?)[\\s·\\-–]+(\\d[\\d.,€\\s\\/h]*)$/);
          var nom = m ? m[1].trim() : s, pr = m ? m[2].trim() : '';
          ctx.fillStyle = i===0 ? PL : BG; rrect(ctx,60,y,W-120,46,7); ctx.fill();
          ctx.fillStyle = TX; ctx.font = 'bold 18px Arial,sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(nom,85,y+14);
          if (pr) { ctx.fillStyle = P; ctx.textAlign = 'right'; ctx.fillText(pr,W-85,y+14); }
          y += 56;
        });
      }
      if (CARD.zona) { y+=8; ctx.fillStyle = MU; ctx.font = '17px Arial,sans-serif'; ctx.textAlign='left'; ctx.fillText('\\uD83D\\uDCCD '+CARD.zona,80,y); y+=48; }

      y += 10;
      ctx.strokeStyle = 'rgba(30,27,20,.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(W-60,y); ctx.stroke(); y+=24;
      ctx.fillStyle = P; ctx.font = 'bold 17px Arial,sans-serif'; ctx.textAlign='left';
      ctx.fillText(CARD.cardUrl,80,y);
      ctx.fillStyle = 'rgba(30,27,20,.25)'; ctx.font = '13px Arial,sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('Creado con PerfilaPro',W/2,H-52);

      canvas.toBlob(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href=url;
        a.download = 'perfilapro-'+CARD.slug+'.png';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        btn.innerHTML = orig; btn.disabled = false;
      },'image/png');
    }

    function rrect(ctx,x,y,w,h,r) {
      ctx.beginPath(); ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
      ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
    }
    function rrectTop(ctx,x,y,w,h,r) {
      ctx.beginPath(); ctx.moveTo(x+r,y);
      ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h);
      ctx.lineTo(x,y+h); ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
    }

    // Track click en boton WhatsApp principal (no en compartir)
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.pp-cta--wa');
      if (!a) return;
      if (typeof window.ppEvent === 'function') {
        window.ppEvent('whatsapp_click', { slug: CARD.slug });
      }
    });
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html
  };
};
