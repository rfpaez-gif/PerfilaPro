'use strict';

// Render público server-side de la ficha de una subasta (/s/:slug) y de
// la vitrina-listado (/inmo). Mismo enfoque que card.js: plantilla
// string, todo el contenido de usuario escapado con esc(). Esto es lo
// que hace que la idea de "tarjeta de propiedad" cobre sentido —
// reusamos el patrón de página pública, pero con datos de finca.

const { centsToEuros } = require('./subasta-model');
const { TIPO_BIEN_LABEL, fmtFecha } = require('./subasta-email');

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ESTADO_LABEL = {
  proxima: 'Próxima', abierta: 'Abierta', cerrada: 'Cerrada',
  desierta: 'Desierta', suspendida: 'Suspendida',
};
const TIPO_SUBASTA_LABEL = {
  judicial: 'Judicial', aeat: 'Agencia Tributaria', seg_social: 'Seguridad Social',
  concursal: 'Concursal', notarial: 'Notarial',
};

// Enlace a Google Maps por dirección+municipio o por coordenadas.
function mapsUrl(s) {
  if (s.lat != null && s.lng != null) return `https://www.google.com/maps?q=${s.lat},${s.lng}`;
  const q = [s.direccion, s.municipio, 'Tarragona'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function dato(label, value) {
  if (value == null || value === '') return '';
  return `<div class="dato"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;
}

function renderSubastaPage(s, { siteUrl = process.env.SITE_URL || 'https://perfilapro.es' } = {}) {
  const tipoBien = TIPO_BIEN_LABEL[s.tipo_bien] || 'Inmueble';
  const titulo = `${tipoBien} en ${s.municipio || s.localidad_raw || 'Tarragona'}`;
  const estado = ESTADO_LABEL[s.estado] || s.estado || '';
  const fotos = Array.isArray(s.fotos) ? s.fotos : [];
  const hero = fotos.length
    ? `<div class="fotos">${fotos.map((f) => `<img src="${esc(f)}" alt="${esc(titulo)}" loading="lazy">`).join('')}</div>`
    : `<div class="nofoto">Sin fotografías publicadas</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)} · Subasta</title>
<style>
  :root{--ink:#2b2620;--soft:#6b6256;--accent:#1f7a5a;--bg:#f7f5f1;--surface:#fff;--border:#e7e2d9}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:760px;margin:0 auto;padding:20px 16px 60px}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .badge{font-size:12px;font-weight:700;padding:5px 12px;border-radius:100px;background:#eef4f0;color:var(--accent)}
  .badge.estado{background:var(--accent);color:#fff}
  h1{font-size:1.6rem;margin:0 0 4px;line-height:1.2}
  .sub{color:var(--soft);margin:0 0 18px}
  .fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-bottom:20px}
  .fotos img{width:100%;height:170px;object-fit:cover;border-radius:10px;border:1px solid var(--border)}
  .nofoto{background:var(--surface);border:1px dashed var(--border);border-radius:10px;padding:40px;text-align:center;color:var(--soft);margin-bottom:20px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
  .precio{font-size:2rem;font-weight:800;color:var(--accent);line-height:1}
  .precio small{display:block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin-bottom:4px}
  .dato{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:.95rem}
  .dato:last-child{border-bottom:0}
  .lbl{color:var(--soft)}
  .val{font-weight:600;text-align:right}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  .btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;font-size:.95rem;padding:12px 22px;border-radius:100px}
  .btn.ghost{background:transparent;color:var(--accent);border:1px solid var(--accent)}
  .foot{color:var(--soft);font-size:.8rem;text-align:center;margin-top:24px}
</style>
</head>
<body>
  <div class="wrap">
    <div class="badges">
      ${estado ? `<span class="badge estado">${esc(estado)}</span>` : ''}
      ${s.tipo_subasta ? `<span class="badge">${esc(TIPO_SUBASTA_LABEL[s.tipo_subasta] || s.tipo_subasta)}</span>` : ''}
      <span class="badge">${esc(tipoBien)}</span>
    </div>
    <h1>${esc(titulo)}</h1>
    <p class="sub">${esc(s.direccion || s.localidad_raw || '')}${s.municipio ? ` · ${esc(s.municipio)} (Tarragona)` : ''}</p>

    ${hero}

    <div class="card">
      <div class="precio"><small>Valor de subasta</small>${esc(centsToEuros(s.valor_subasta_cents) || 'No publicado')}</div>
      <div class="actions" style="margin-top:16px">
        ${s.detalle_url ? `<a class="btn" href="${esc(s.detalle_url)}" target="_blank" rel="noopener">Ver en el BOE →</a>` : ''}
        <a class="btn ghost" href="${esc(mapsUrl(s))}" target="_blank" rel="noopener">Ver en el mapa</a>
      </div>
    </div>

    <div class="card">
      ${dato('Tasación', centsToEuros(s.tasacion_cents))}
      ${dato('Depósito para pujar', centsToEuros(s.deposito_cents))}
      ${dato('Puja mínima', centsToEuros(s.puja_minima_cents))}
      ${dato('Cantidad reclamada', centsToEuros(s.cantidad_reclamada_cents))}
      ${dato('Inicio', fmtFecha(s.fecha_inicio))}
      ${dato('Conclusión', fmtFecha(s.fecha_fin))}
      ${dato('Referencia catastral', s.ref_catastral)}
      ${dato('Autoridad', s.autoridad)}
      ${dato('Identificador', s.id_subasta)}
      ${dato('Anuncio BOE', s.boe_anuncio)}
    </div>

    <p class="foot">Datos del Portal de Subastas del BOE. Verifica siempre en la fuente oficial antes de pujar.</p>
  </div>
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>No encontrada</title>
<style>body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f7f5f1;color:#2b2620;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}</style>
</head><body><div><h1>Subasta no encontrada</h1><p>Esta ficha no existe o ya no está disponible.</p></div></body></html>`;
}

module.exports = { renderSubastaPage, renderNotFound, mapsUrl, ESTADO_LABEL, TIPO_SUBASTA_LABEL };
