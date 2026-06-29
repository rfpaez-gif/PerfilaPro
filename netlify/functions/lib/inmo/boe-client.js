'use strict';

// Cliente del Portal de Subastas del BOE (subastas.boe.es).
//
// El parseo se ancla en TEXTO ESTABLE (el identificador `idSub=…` y las
// etiquetas en español que ve el usuario: "Valor de subasta", "Lote",
// "Localidad"…), no en clases CSS — el HTML del portal cambia de forma
// pero esas etiquetas son las del dominio y se mueven poco. Las
// funciones de parseo son puras (reciben HTML) y se testean offline con
// fixtures; el acceso de red está aislado en fetchText/scrape.
//
// ⚠️ PRIMERA EJECUCIÓN EN PRODUCCIÓN: confirmar dos cosas contra el
// portal real (no accesibles desde el sandbox de desarrollo):
//   1. INMO_BOE_SEARCH_URL — la URL de búsqueda ya filtrada por
//      Provincia=Tarragona + Tipo de bien=Inmuebles. Lo más fiable es
//      abrir subastas.boe.es, aplicar esos filtros en el buscador y
//      pegar aquí la URL resultante (el portal conserva el filtro en la
//      query string).
//   2. Que las etiquetas de `parseDetalle` coinciden con las del HTML.
// Ver docs/inmo-subastas.md.

const DEFAULT_TIMEOUT_MS = 20000;
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';

// URL de búsqueda. Por defecto, búsqueda avanzada de bienes inmuebles en
// la provincia de Tarragona (código 43). Sobrescribible por env para
// pegar la URL exacta copiada del navegador.
function buildSearchUrl() {
  if (process.env.INMO_BOE_SEARCH_URL) return process.env.INMO_BOE_SEARCH_URL;
  return (
    'https://subastas.boe.es/subastas_ava.php' +
    '?accion=Buscar' +
    '&dato%5Bbien_tipo%5D=I' +            // I = inmuebles
    '&dato%5Bprovincia%5D=43' +           // 43 = Tarragona
    '&campo%5B0%5D=SUBASTA.ESTADO&dato%5B0%5D=EJ'  // EJ = en ejecución/abiertas
  );
}

// GET con UA de navegador + timeout. fetchImpl inyectable para tests.
async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Extrae los identificadores de subasta (SUB-XX-AAAA-NNN…) de una página
// de listado, sin duplicados y en orden de aparición.
function extractIdSubs(html) {
  const out = [];
  const seen = new Set();
  const re = /idSub=(SUB-[A-Z]{2,3}-\d{4}-\d+)/g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

// Escapa una etiqueta para usarla en regex.
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Devuelve el valor que sigue a una etiqueta. Tolera etiquetas y `:`
// entre el label y el dato. `labels` admite sinónimos; devuelve el
// primero que aparezca. Captura el primer fragmento de texto no vacío
// tras la etiqueta.
function field(html, labels) {
  const h = String(html || '');
  for (const label of [].concat(labels)) {
    // tolera una o más etiquetas entre la etiqueta y el dato
    // (p.ej. `Localidad</span><span class="val">Cambrils<`)
    const re = new RegExp(
      escRe(label) + '\\s*:?\\s*(?:<[^>]*>\\s*)+([^<]+?)\\s*<',
      'i'
    );
    const m = h.match(re);
    if (m && m[1].trim()) return m[1].trim();
    // variante: etiqueta y valor en el mismo nodo ("Lote 1")
    const re2 = new RegExp(escRe(label) + '\\s*:?\\s*([^<\\n]+)', 'i');
    const m2 = h.match(re2);
    if (m2 && m2[1].trim()) return m2[1].trim();
  }
  return null;
}

// URLs de imágenes del bien alojadas en el propio portal.
function extractFotos(html) {
  const out = [];
  const seen = new Set();
  const re = /src="([^"]*(?:imagenBien|fotos?|media)[^"]*\.(?:jpg|jpeg|png|webp))"/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    let u = m[1];
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = 'https://subastas.boe.es' + u;
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

// Parsea la página de detalle de una subasta a un objeto plano de
// campos en bruto (sin normalizar — eso lo hace subasta-model). Modela
// el caso común de UN bien inmueble; el lote se detecta si está
// presente. La localidad y la provincia se devuelven SEPARADAS para que
// el geofiltro no confunda el municipio con la provincia.
function parseDetalle(html, ctx = {}) {
  const idSubasta = ctx.idSubasta || (field(html, ['Identificador']) || '').match(/SUB-[A-Z]{2,3}-\d{4}-\d+/)?.[0] || null;
  const detalleUrl = ctx.detalleUrl || (idSubasta ? `https://subastas.boe.es/detalleSubasta.php?idSub=${idSubasta}` : null);
  const loteTxt = field(html, ['Lote']);
  const lote = loteTxt ? (loteTxt.match(/\d+/) || [])[0] : null;

  return {
    idSubasta,
    detalleUrl,
    lote: lote != null ? Number(lote) : null,
    estado: field(html, ['Estado']),
    fechaInicio: field(html, ['Fecha de inicio', 'Inicio']),
    fechaFin: field(html, ['Fecha de conclusión', 'Fecha de fin', 'Conclusión']),
    valorSubasta: field(html, ['Valor de subasta', 'Valor subasta']),
    tasacion: field(html, ['Tasación', 'Valor de tasación']),
    deposito: field(html, ['Importe del depósito', 'Depósito']),
    pujaMinima: field(html, ['Puja mínima']),
    cantidadReclamada: field(html, ['Cantidad reclamada']),
    autoridad: field(html, ['Autoridad gestora', 'Juzgado', 'Organismo']),
    boeAnuncio: (html.match(/BOE-B-\d{4}-\d+/) || [])[0] || null,
    boeUrl: (() => {
      const a = (html.match(/BOE-B-\d{4}-\d+/) || [])[0];
      return a ? `https://www.boe.es/diario_boe/txt.php?id=${a}` : null;
    })(),
    tipoBien: field(html, ['Tipo de bien', 'Tipo']),
    descripcion: field(html, ['Descripción']),
    localidad: field(html, ['Localidad', 'Municipio', 'Población']),
    provincia: field(html, ['Provincia']),
    direccion: field(html, ['Dirección', 'Domicilio', 'Calle']),
    refCatastral: field(html, ['Referencia catastral', 'Ref. catastral']),
    fotos: extractFotos(html),
  };
}

module.exports = {
  buildSearchUrl,
  fetchText,
  extractIdSubs,
  field,
  extractFotos,
  parseDetalle,
  BROWSER_UA,
};
