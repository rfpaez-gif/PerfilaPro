'use strict';

// Transformaciones puras sobre los datos de una subasta: parseo de
// importes y fechas en formato español, slug, normalización de estado
// y tipo, y construcción de la fila lista para Supabase. Sin I/O —
// todo testeable offline.

// "12.345,67 €" → 1234567 (céntimos). Formato español: punto miles,
// coma decimal. Devuelve null si no hay número.
function eurosToCents(str) {
  if (str == null) return null;
  if (typeof str === 'number') return Math.round(str * 100);
  const cleaned = String(str).replace(/[^\d.,-]/g, '');
  if (!cleaned || cleaned === '-') return null;
  // quita separadores de miles (puntos) y pasa la coma a punto decimal
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// 1234567 → "12.345,67 €" (display español).
function centsToEuros(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const eur = Number(cents) / 100;
  return eur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// "10-06-2024 18:00:00" / "10/06/2024 18:00" / "10-06-2024" → ISO.
// Se interpreta como hora local peninsular; se almacena en UTC sin
// corrección de huso (deriva de 1-2 h, irrelevante para ventanas de
// "cierra pronto"). Devuelve null si no parsea.
function parseSpanishDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(
    /(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Slug de URL pública a partir del identificador y el lote.
function slugify(idSubasta, lote) {
  const base = String(idSubasta || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return lote ? `${base}-l${lote}` : base;
}

// Estado del portal → enum interno.
function normEstado(str) {
  const t = String(str || '').toLowerCase();
  if (/desiert/.test(t)) return 'desierta';
  if (/suspend|cancel/.test(t)) return 'suspendida';
  if (/conclu|finaliz|cerrad|celebrad/.test(t)) return 'cerrada';
  if (/celebr|abiert|en plazo|en curso/.test(t)) return 'abierta';
  if (/pr[oó]xim|pendiente de apertura/.test(t)) return 'proxima';
  return t ? 'abierta' : null; // por defecto, si hay texto desconocido, la tratamos como activa
}

// Tipo de subasta a partir del prefijo del identificador del portal.
// SUB-JA = judicial, SUB-AT = AEAT (Agencia Tributaria),
// SUB-SS = Seguridad Social, SUB-NE = concursal.
function tipoSubastaFromId(idSubasta) {
  const m = String(idSubasta || '').toUpperCase().match(/^SUB-([A-Z]{2})/);
  if (!m) return null;
  return { JA: 'judicial', AT: 'aeat', SS: 'seg_social', NE: 'concursal' }[m[1]] || 'otro';
}

// Clasifica el tipo de bien a partir del texto descriptivo del BOE.
function normTipoBien(str) {
  const t = String(str || '').toLowerCase();
  if (/vivienda|piso|chalet|adosad|apartament|d[uú]plex|[aá]tico|casa/.test(t)) return 'vivienda';
  if (/garaje|aparcamiento|plaza de garaje/.test(t)) return 'garaje';
  if (/local|comercial/.test(t)) return 'local';
  if (/nave|industrial|almac[eé]n/.test(t)) return 'nave';
  if (/solar|suelo|parcela|urbaniz/.test(t)) return 'suelo';
  if (/r[uú]stic|finca|terreno|agr[ií]col/.test(t)) return 'finca_rustica';
  if (/trastero/.test(t)) return 'trastero';
  return str ? 'otro' : null;
}

// Construye la fila de `subastas` a partir del detalle ya parseado del
// BOE (objeto con campos en bruto) y el municipio costero resuelto.
function buildSubastaRow(detalle, municipio) {
  const idSubasta = detalle.idSubasta;
  const lote = detalle.lote != null ? Number(detalle.lote) : null;
  const id = lote ? `${idSubasta}-L${lote}` : idSubasta;

  return {
    id,
    id_subasta: idSubasta,
    lote,
    slug: slugify(idSubasta, lote),
    estado: normEstado(detalle.estado),
    tipo_subasta: tipoSubastaFromId(idSubasta),
    tipo_bien: normTipoBien(detalle.tipoBien),
    municipio,
    localidad_raw: detalle.localidad || null,
    direccion: detalle.direccion || null,
    provincia: detalle.provincia || 'Tarragona',
    ref_catastral: detalle.refCatastral || null,
    valor_subasta_cents: eurosToCents(detalle.valorSubasta),
    tasacion_cents: eurosToCents(detalle.tasacion),
    deposito_cents: eurosToCents(detalle.deposito),
    puja_minima_cents: eurosToCents(detalle.pujaMinima),
    cantidad_reclamada_cents: eurosToCents(detalle.cantidadReclamada),
    fecha_inicio: parseSpanishDate(detalle.fechaInicio),
    fecha_fin: parseSpanishDate(detalle.fechaFin),
    autoridad: detalle.autoridad || null,
    boe_anuncio: detalle.boeAnuncio || null,
    boe_url: detalle.boeUrl || null,
    detalle_url: detalle.detalleUrl || null,
    fotos: Array.isArray(detalle.fotos) ? detalle.fotos : [],
    raw: detalle,
  };
}

// ¿La subasta cierra dentro de la ventana (días)? Para el aviso de
// "cierra pronto". `ahora` inyectable para tests.
function cierraPronto(row, dias = 3, ahora = new Date()) {
  if (!row || !row.fecha_fin) return false;
  if (row.estado && row.estado !== 'abierta' && row.estado !== 'proxima') return false;
  const fin = new Date(row.fecha_fin).getTime();
  if (Number.isNaN(fin)) return false;
  const ms = fin - ahora.getTime();
  return ms > 0 && ms <= dias * 24 * 60 * 60 * 1000;
}

module.exports = {
  eurosToCents,
  centsToEuros,
  parseSpanishDate,
  slugify,
  normEstado,
  tipoSubastaFromId,
  normTipoBien,
  buildSubastaRow,
  cierraPronto,
};
