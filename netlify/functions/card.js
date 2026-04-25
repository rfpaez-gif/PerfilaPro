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

  const isPaid = isDemo || !!data.stripe_session_id;
  const siteUrl = process.env.SITE_URL || 'https://perfilapro.es';
  const cardUrl = `${siteUrl}/c/${data.slug}`;

  let qrDataUrl = null;
  if (isPaid) {
    qrDataUrl = await QRCode.toDataURL(cardUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#01696f', light: '#ffffff' },
    });
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
    .svc-line{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:.5rem;padding:.45rem .75rem;border-radius:.5rem;margin-bottom:.325rem;background:var(--bg);font-size:.875rem}
    .svc-line.first{background:var(--plight);border:1px solid rgba(1,105,111,.18)}
    .svc-name{font-weight:600;min-width:0}
    .svc-price{font-weight:700;color:var(--primary);white-space:nowrap;text-align:right}
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
    .share-btns{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
    .share-btn{display:flex;align-items:center;justify-content:center;gap:.4rem;padding:.75rem .5rem;border:1.5px solid var(--border);border-radius:.5rem;font-size:.82rem;font-weight:700;cursor:pointer;background:#fff;color:var(--text);transition:all .15s;font-family:var(--ff-b)}
    .share-btn:hover{border-color:var(--primary);color:var(--primary)}
    .share-btn:disabled{opacity:.6;cursor:default}
  </style>
</head>
<body>
  <div class="card">
    <div class="card-hd">
      <div class="card-av">
        ${data.foto_url ? `<img src="${data.foto_url}" alt="${data.nombre}" loading="lazy">` : '👤'}
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
          <p>Escanea para abrir este perfil</p>
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
    <div class="card-sec">
      <div class="card-sec-label">Comparte</div>
      <div class="share-btns">
        <button class="share-btn" onclick="downloadVCard()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Añadir contacto
        </button>
        <button class="share-btn" id="dlCardBtn" onclick="downloadCard(this)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Descargar perfil
        </button>
      </div>
    </div>
    <div class="card-powered">
      Creado con <strong>PerfilaPro</strong><br>
      <a href="https://perfilapro.es">Crea tu propio perfil</a>
      <br><a href="/editar.html" style="font-size:.72rem;color:var(--faint);text-decoration:none;margin-top:.4rem;display:inline-block">¿Eres el propietario? Editar perfil</a>
    </div>
  </div>
  <div class="footer">
    <a href="https://perfilapro.es" target="_blank">¿Quieres tu propio perfil? → PerfilaPro.es</a>
  </div>
  <script>
    var CARD = ${JSON.stringify({
      nombre:   data.nombre   || '',
      tagline:  data.tagline  || '',
      whatsapp: data.whatsapp || '',
      telefono: data.telefono || '',
      zona:     data.zona     || '',
      servicios: data.servicios || [],
      foto_url: data.foto_url || '',
      slug:     data.slug,
      cardUrl:  cardUrl,
    })};

    function downloadVCard() {
      var lines = ['BEGIN:VCARD','VERSION:3.0','FN:' + CARD.nombre];
      if (CARD.whatsapp) lines.push('TEL;TYPE=CELL:+' + CARD.whatsapp);
      if (CARD.telefono) lines.push('TEL;TYPE=WORK:+34' + CARD.telefono.replace(/\\D/g,''));
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
      var P = '#01696f', PL = '#deeeed', BG = '#f5f2ec', TX = '#1e1b14', MU = '#6b6458';

      ctx.fillStyle = BG; ctx.fillRect(0,0,W,H);
      ctx.shadowColor = 'rgba(0,0,0,.10)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
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
  </script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html
  };
};

