const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <title>Tarjeta no encontrada</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f2ec;color:#1e1b14}div{text-align:center}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#6b6458}</style>
      </head><body><div><h1>Tarjeta no encontrada</h1><p>Este perfil no existe o no está activo.</p></div></body></html>`
    };
  }

  const serviciosHTML = (data.servicios || []).map((s, i) => {
    const m = s.match(/^(.+?)[\s·\-–]+(\d[\d.,€\s\/h]*)$/);
    const nombre = m ? m[1].trim() : s;
    const precio = m ? m[2].trim() : '';
    return `<div class="svc-line${i === 0 ? ' first' : ''}">
      <span class="svc-name">${nombre}</span>
      ${precio ? `<span class="svc-price">${precio}</span>` : ''}
    </div>`;
  }).join('');

  const DEMO_SLUGS = ['paco-fontanero-alicante'];
  const isDemo = DEMO_SLUGS.includes(data.slug);

  // Registrar visita de forma no bloqueante
  if (!isDemo) {
    supabase.from('visits').insert({ slug: data.slug }).then(({ error: ve }) => {
      if (ve) console.error('Error registrando visita:', ve.message);
    });
  }

  const waUrl = !isDemo && data.whatsapp
    ? `https://wa.me/${data.whatsapp}?text=${encodeURIComponent('Hola, he visto tu tarjeta en PerfilaPro y me interesa contactarte.')}`
    : null;

  const isPaid = !!data.stripe_session_id;
  const siteUrl = process.env.SITE_URL || 'https://perfilapro.netlify.app';
  const cardUrl = `${siteUrl}/c/${data.slug}`;

  let qrDataUrl = null;
  if (isPaid) {
    qrDataUrl = await QRCode.toDataURL(cardUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#01696f', light: '#ffffff' },
    });
  }

  const isPro = data.plan === 'pro';
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

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.nombre || 'Perfil profesional'} — PerfilaPro</title>
  <meta name="description" content="${data.tagline || ''} ${data.zona || ''}">
  <meta property="og:title" content="${data.nombre} — PerfilaPro">
  <meta property="og:description" content="${data.tagline || ''}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{--primary:#01696f;--phover:#0c4e54;--plight:#deeeed;--wa:#25D366;--wahover:#1db953;--bg:#f5f2ec;--surface:#faf9f6;--text:#1e1b14;--muted:#6b6458;--faint:#a89f90;--border:rgba(30,27,20,.10);--ff-d:"Instrument Serif",Georgia,serif;--ff-b:"Plus Jakarta Sans",system-ui,sans-serif}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--ff-b);background:var(--bg);color:var(--text);min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:2rem 1rem;-webkit-font-smoothing:antialiased}
    .card{background:#fff;border-radius:1rem;overflow:hidden;border:1px solid var(--border);box-shadow:0 4px 24px rgba(0,0,0,.10);width:100%;max-width:420px}
    .card-hd{padding:1.25rem 1.25rem 1rem;display:flex;align-items:center;gap:1rem;border-bottom:1px solid var(--border)}
    .card-av{width:72px;height:72px;border-radius:50%;border:2.5px solid var(--primary);flex-shrink:0;overflow:hidden;background:var(--plight);display:flex;align-items:center;justify-content:center;font-size:2rem}
    .card-av img{width:100%;height:100%;object-fit:cover}
    .card-name{font-family:var(--ff-d);font-size:1.25rem;line-height:1.2;font-weight:700}
    .card-tag{font-size:.8rem;color:var(--muted);margin-top:.2rem}
    .card-sec{padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
    .card-sec:last-child{border-bottom:none}
    .card-sec-label{font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--primary);margin-bottom:.625rem}
    .svc-line{display:flex;justify-content:space-between;align-items:center;padding:.45rem .75rem;border-radius:.5rem;margin-bottom:.325rem;background:var(--bg);font-size:.875rem}
    .svc-line.first{background:var(--plight);border:1px solid rgba(1,105,111,.18)}
    .svc-name{font-weight:600}
    .svc-price{font-weight:700;color:var(--primary)}
    .card-zona{font-size:.8rem;color:var(--muted);line-height:1.6}
    .card-wa{display:flex;align-items:center;justify-content:center;gap:.625rem;width:100%;padding:.9rem;background:var(--wa);color:#fff;border-radius:.5rem;font-size:1rem;font-weight:700;text-decoration:none;transition:background .2s,transform .2s}
    .card-wa:hover{background:var(--wahover);transform:translateY(-2px)}
    .card-powered{text-align:center;padding:.75rem 1rem;border-top:1px solid var(--border);font-size:.78rem;color:var(--faint)}
    .card-powered strong{color:var(--primary)}
    .card-powered a{display:inline-block;margin-top:.45rem;padding:.45rem 1rem;background:var(--primary);color:#fff;border-radius:999px;font-size:.78rem;font-weight:700;text-decoration:none}
    .card-qr{display:flex;flex-direction:column}
    .qr-wrap{display:flex;align-items:center;gap:1rem}
    .qr-wrap img{border-radius:.5rem;border:1px solid var(--border);flex-shrink:0}
    .qr-info p{font-size:.8rem;color:var(--muted);margin-bottom:.5rem}
    .qr-download{display:inline-block;padding:.4rem .9rem;background:var(--primary);color:#fff;border-radius:999px;font-size:.78rem;font-weight:700;text-decoration:none;transition:background .2s}
    .qr-download:hover{background:var(--phover)}
    .footer{margin-top:1.5rem;font-size:.75rem;color:var(--faint);text-align:center}
    .footer a{color:var(--primary);text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="card-hd">
      <div class="card-av">
        ${data.foto ? `<img src="${data.foto}" alt="${data.nombre}" loading="lazy">` : '👤'}
      </div>
      <div>
        <div class="card-name">${data.nombre || ''}</div>
        ${data.tagline ? `<div class="card-tag">${data.tagline}</div>` : ''}
      </div>
    </div>
    ${serviciosHTML ? `<div class="card-sec"><div class="card-sec-label">Servicios</div>${serviciosHTML}</div>` : ''}
    ${data.zona ? `<div class="card-sec"><div class="card-sec-label">Cobertura</div><div class="card-zona">${data.zona}</div></div>` : ''}
    <div class="card-sec" style="display:flex;flex-direction:column;gap:.5rem">
      ${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener" class="card-wa">` : '<div class="card-wa" style="cursor:default">'}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.535 5.858L0 24l6.335-1.652A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
        Contactar por WhatsApp
      ${waUrl ? '</a>' : '</div>'}
      ${data.telefono ? `<a href="tel:+34${data.telefono.replace(/\D/g,'')}" class="card-wa" style="background:#1e1b14">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
        Llamar ahora
      </a>` : ''}
    </div>
    ${qrDataUrl ? `
    <div class="card-sec card-qr">
      <div class="card-sec-label">Código QR</div>
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="QR ${data.nombre}" width="120" height="120">
        <div class="qr-info">
          <p>Escanea para abrir esta tarjeta</p>
          <a href="${qrDataUrl}" download="perfilapro-${data.slug}.png" class="qr-download">Descargar QR</a>
        </div>
      </div>
    </div>` : ''}
    ${isPro && visitCount !== null ? `
    <div class="card-sec" style="text-align:center">
      <div class="card-sec-label">Visitas este mes</div>
      <div style="font-size:2rem;font-weight:800;color:var(--primary);line-height:1">${visitCount}</div>
      <div style="font-size:.75rem;color:var(--faint);margin-top:.25rem">últimos 30 días</div>
    </div>` : ''}
    <div class="card-powered">
      Creado con <strong>PerfilaPro</strong><br>
      <a href="https://perfilapro.netlify.app">Crea tu propia tarjeta</a>
    </div>
  </div>
  <div class="footer">
    <a href="https://perfilapro.com" target="_blank">¿Quieres tu propia tarjeta? → PerfilaPro.com</a>
  </div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html
  };
};

