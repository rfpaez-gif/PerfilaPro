// Generador de la tarjeta imprimible (PDF A6 vertical) y del QR PNG en alta
// resolución que viajan adjuntos al email post-pago. La utilidad es shared
// entre stripe-webhook (envío automático) y los endpoints download-card /
// download-qr (re-descarga desde el editor con token).
//
// Diseño:
// - PDF A6 vertical (105×148mm), sin foto. La foto vive en el perfil digital
//   que se abre al escanear el QR; el papel es solo el portal.
// - Tipografías Helvetica nativas de PDFKit — render idéntico en todos los
//   visores, sin coste de carga ni dependencia de fuentes externas.
// - El usuario imprime tal cual (tamaño A6, cabe en un bolsillo) o ampliado
//   al 200% (A5 pared/escaparate) o al 50% (~A7 mano). PDF vectorial salvo
//   por el QR, que se embebe en PNG 1200px (densidad sobrada para imprenta).
//
// Hex codes sincronizados con tokens.css y lib/email-layout.js. Si cambia la
// paleta del producto, este archivo debe tocarse en el MISMO commit.

const path = require('path');
const PDFDocument = require('pdfkit');
const { Resvg } = require('@resvg/resvg-js');
const { buildQrSvg } = require('./lib/qr-svg.js');
const { registerFonts } = require('./lib/pdf-fonts');

// __dirname = netlify/functions/ (tanto local como bundlado por esbuild).
// El helper pdf-fonts.js no puede usar su propio __dirname al inlinearse.
const FONTS_DIR = path.join(__dirname, 'lib/fonts');

const A6_WIDTH  = 297.64; // 105mm en puntos PDF (1pt = 1/72")
const A6_HEIGHT = 419.53; // 148mm

// Paleta del PDF imprimible · alineada con el rebrand.
// Header band en Tinta (la tarjeta es marketing, no documento legal —
// Teal Documentos queda restringido a factura/contrato según brief).
const COLORS = {
  surface:    '#FFFFFF',
  ink:        '#0A1F44', // tinta
  inkSoft:    '#6B7280', // gris-500
  accent:     '#0A1F44', // tinta (header band)
  match:      '#00C277', // verde-match (acentos del wordmark)
  border:     '#E5E7EB', // gris-200
};

function formatSpanishPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  let local;
  if (digits.length === 11 && digits.startsWith('34')) local = digits.substring(2);
  else if (digits.length === 9) local = digits;
  else return String(phone);
  return `+34 ${local.substring(0, 3)} ${local.substring(3, 5)} ${local.substring(5, 7)} ${local.substring(7, 9)}`;
}

// Rasteriza el SVG del QR al PNG del tamaño solicitado.
// El SVG fuente se genera a 280 (max display size) y resvg escala — fitTo
// width preserva proporción y nitidez sub-pixel.
function rasterizeQrSvgToPng(cardUrl, size) {
  const svg = buildQrSvg(cardUrl, { size: 280 });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

async function generateQrPngBuffer(cardUrl, size = 1024) {
  return rasterizeQrSvgToPng(cardUrl, size);
}

// Escapa caracteres con significado en XML para texto que va embebido en SVG.
function escSvg(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// PNG "escaparate" — el QR enmarcado como mini-tarjeta autosuficiente,
// pensado para vinilo en luna de coche, lateral de furgo o cartel de barrio.
// Composición:
//   · Marco gris-200 redondeado (rx=14)
//   · Header Tinta con wordmark Perfila/Pro
//   · Nombre (Source Serif 4) + chip profesión (Inter SemiBold uppercase)
//   · QR centrado (≈60% del ancho — sigue siendo el protagonista)
//   · URL en verde-match abajo
//   · Footer "Imprime a cualquier tamaño"
//
// Aspect ratio A6 (1:√2). Render por defecto 1024×1448px — densidad sobrada
// para imprimir hasta A4 sin pixelar.
//
// Las fuentes (Source Serif 4 Semibold + Inter / Inter SemiBold) se cargan
// desde lib/fonts vía resvg-js. loadSystemFonts:false garantiza render
// determinista; defaultFontFamily evita el WARN si algún glifo no resuelve.
async function buildEscaparateQrPng({ nombre, profesion, slug, cardUrl, size = 1024 }) {
  if (!slug || !cardUrl) {
    throw new Error('buildEscaparateQrPng: slug y cardUrl son obligatorios');
  }

  const VB_W = 300;
  const VB_H = 424;
  const FRAME_INSET = 6;
  const FRAME_R = 14;
  const HEADER_H = 40;

  // Posiciona el QR centrado horizontalmente, justo bajo el bloque identidad.
  const QR_W = 184;
  const QR_X = (VB_W - QR_W) / 2;
  const QR_Y = 138;

  // Inyecta x/y/width/height en el `<svg>` raíz del QR para que se renderice
  // como SVG anidado en la posición/escala deseada. Conserva el viewBox.
  const qrSvgRaw = buildQrSvg(cardUrl, { size: 280 });
  const qrEmbedded = qrSvgRaw.replace(
    /^<svg[^>]*>/,
    `<svg x="${QR_X}" y="${QR_Y}" width="${QR_W}" height="${QR_W}" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">`
  );

  const nombreClean    = String(nombre || '').trim().substring(0, 40) || '—';
  const profesionClean = profesion ? String(profesion).trim().substring(0, 36) : '';
  const urlLabel       = `perfilapro.es/c/${slug}`;

  // SVG email-defensive: hex literales (sin currentColor / vars).
  // Wordmark Perfila/Pro en dos `<tspan>` para alternar peso (regular vs italic)
  // dentro de un mismo bloque de texto centrado.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}">
<defs>
  <clipPath id="frameClip">
    <rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${VB_W - 2 * FRAME_INSET}" height="${VB_H - 2 * FRAME_INSET}" rx="${FRAME_R}" ry="${FRAME_R}"/>
  </clipPath>
</defs>
<rect width="${VB_W}" height="${VB_H}" fill="${COLORS.surface}"/>
<g clip-path="url(#frameClip)">
  <rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${VB_W - 2 * FRAME_INSET}" height="${HEADER_H}" fill="${COLORS.accent}"/>
</g>
<rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${VB_W - 2 * FRAME_INSET}" height="${VB_H - 2 * FRAME_INSET}" rx="${FRAME_R}" ry="${FRAME_R}" fill="none" stroke="${COLORS.border}" stroke-width="1"/>
<text x="${VB_W / 2}" y="${FRAME_INSET + HEADER_H / 2 + 6}" text-anchor="middle" font-family="Source Serif 4 Semibold" font-size="18" fill="#FFFFFF">Perfila<tspan font-family="Source Serif 4 Semibold" font-style="italic" fill="${COLORS.match}">Pro</tspan></text>
<text x="${VB_W / 2}" y="84" text-anchor="middle" font-family="Source Serif 4 Semibold" font-size="17" fill="${COLORS.ink}">${escSvg(nombreClean)}</text>
${profesionClean ? `<text x="${VB_W / 2}" y="104" text-anchor="middle" font-family="Inter SemiBold" font-size="9" fill="${COLORS.match}" letter-spacing="1.2">${escSvg(profesionClean.toUpperCase())}</text>` : ''}
<line x1="60" y1="124" x2="${VB_W - 60}" y2="124" stroke="${COLORS.border}" stroke-width="0.8"/>
${qrEmbedded}
<text x="${VB_W / 2}" y="346" text-anchor="middle" font-family="Inter" font-size="9" fill="${COLORS.inkSoft}">Escanea para abrir mi perfil</text>
<text x="${VB_W / 2}" y="368" text-anchor="middle" font-family="Inter SemiBold" font-size="11" fill="${COLORS.match}">${escSvg(urlLabel)}</text>
<text x="${VB_W / 2}" y="408" text-anchor="middle" font-family="Inter" font-size="7" fill="${COLORS.inkSoft}">Imprime a cualquier tamaño · perfilapro.es</text>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: {
      fontDirs: [FONTS_DIR],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
    textRendering: 2,
    shapeRendering: 2,
  });
  return resvg.render().asPng();
}

async function buildPrintableCardPDF({ nombre, tagline, profesion, whatsapp, direccion, zona, slug, cardUrl }) {
  if (!slug || !cardUrl) {
    throw new Error('buildPrintableCardPDF: slug y cardUrl son obligatorios');
  }

  const qrBuffer = rasterizeQrSvgToPng(cardUrl, 1200);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [A6_WIDTH, A6_HEIGHT],
      margin: 0,
      info: {
        Title: `Tarjeta ${slug} - PerfilaPro`,
        Author: 'PerfilaPro',
        Creator: 'PerfilaPro',
      },
    });
    registerFonts(doc, FONTS_DIR);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Fondo blanco
    doc.rect(0, 0, A6_WIDTH, A6_HEIGHT).fill(COLORS.surface);

    // Header band en Tinta + wordmark "Perfila/Pro" centrado.
    // "Perfila" en blanco, "Pro" italic verde-match (regla on-tinta del brief).
    const headerH = 44;
    doc.rect(0, 0, A6_WIDTH, headerH).fill(COLORS.accent);

    const wmSize = 18;
    const charSp = -wmSize * 0.02;
    doc.font('PP-Serif').fontSize(wmSize);
    const wPerfila = doc.widthOfString('Perfila', { characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(wmSize);
    const wPro = doc.widthOfString('Pro', { characterSpacing: charSp });
    const totalW = wPerfila + wPro;
    const wmX = (A6_WIDTH - totalW) / 2;
    const wmY = (headerH - wmSize) / 2;
    doc.font('PP-Serif').fontSize(wmSize).fillColor('#FFFFFF')
      .text('Perfila', wmX, wmY, { lineBreak: false, characterSpacing: charSp });
    doc.font('PP-Serif-Italic').fontSize(wmSize).fillColor(COLORS.match)
      .text('Pro', wmX + wPerfila, wmY, { lineBreak: false, characterSpacing: charSp });

    // Identidad arriba: nombre + profesión canónica + tagline libre.
    let cursorY = headerH + 22;
    doc.fillColor(COLORS.ink).font('PP-Serif').fontSize(17)
      .text(String(nombre || '').trim() || '—', 24, cursorY, { width: A6_WIDTH - 48, align: 'center', lineBreak: false });
    cursorY += 22;

    // Profesión canónica (specialty_label) en chip uppercase verde-match.
    // Se omite si coincide con el tagline (case-insensitive) para no duplicar.
    const profesionTrim = profesion ? String(profesion).trim() : '';
    const taglineTrim = tagline ? String(tagline).trim() : '';
    const sameAsTagline = profesionTrim && taglineTrim &&
      profesionTrim.toLowerCase() === taglineTrim.toLowerCase();
    if (profesionTrim && !sameAsTagline) {
      doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(8.5)
        .text(profesionTrim.toUpperCase().substring(0, 40), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false, characterSpacing: 1.2,
        });
      cursorY += 14;
    }

    if (taglineTrim) {
      doc.fillColor(COLORS.inkSoft).font('PP-Serif-Italic').fontSize(10)
        .text(taglineTrim.substring(0, 80), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 16;
    }

    // Divider fino
    cursorY += 6;
    doc.moveTo(48, cursorY).lineTo(A6_WIDTH - 48, cursorY)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();
    cursorY += 12;

    // QR centrado — 160pt (≈56mm) sigue siendo holgado para impresión A6.
    // Se reduce 10pt vs revisión anterior para dar aire a los datos físicos
    // bajo el QR (dirección + zona).
    const qrSize = 160;
    const qrX = (A6_WIDTH - qrSize) / 2;
    doc.image(qrBuffer, qrX, cursorY, { width: qrSize, height: qrSize });
    cursorY += qrSize + 10;

    // Etiqueta bajo QR
    doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
      .text('Escanea para abrir mi perfil completo', 0, cursorY, { width: A6_WIDTH, align: 'center' });
    cursorY += 17;

    // WhatsApp (contacto principal, destacado)
    if (whatsapp) {
      doc.fillColor(COLORS.ink).font('PP-Sans-SemiBold').fontSize(11.5)
        .text(formatSpanishPhone(whatsapp), 0, cursorY, { width: A6_WIDTH, align: 'center', lineBreak: false });
      cursorY += 15;
    }

    // Dirección física (calle + CP — campo direccion ya viene libre del usuario)
    if (direccion) {
      doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
        .text(String(direccion).trim().substring(0, 60), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 12;
    }

    // Zona (ciudad / provincia)
    if (zona) {
      doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(9)
        .text(String(zona).trim().substring(0, 60), 24, cursorY, {
          width: A6_WIDTH - 48, align: 'center', lineBreak: false,
        });
      cursorY += 12;
    }

    // URL
    doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(10)
      .text(`perfilapro.es/c/${slug}`, 0, cursorY, { width: A6_WIDTH, align: 'center', lineBreak: false });

    // Footer
    const footerY = A6_HEIGHT - 16;
    doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(7)
      .text('Imprime a cualquier tamaño · perfilapro.es', 0, footerY, { width: A6_WIDTH, align: 'center' });

    doc.end();
  });
}

// ============================================================
// Tarjeta de visita B2B · 85×55mm horizontal, formato cartera
// ============================================================
//
// Variante formal del kit imprimible para perfiles que viven dentro de
// una organización. Diferencias clave vs `buildPrintableCardPDF` (A6 B2C):
//
//  · Tamaño tarjeta de visita estándar (ISO/IEC 7810 ID-1, 85×55mm).
//    Es lo que cabe en cartera y se entrega en mano en eventos
//    corporativos. La A6 del B2C es un flyer de bolsillo — distinto
//    caso de uso.
//
//  · Branding de la organización manda: franja superior con
//    `color_primary` + logo + nombre de la org en serif blanco. Es lo
//    primero que el receptor ve cuando coge la tarjeta.
//
//  · Protagonismo a los datos del miembro: nombre grande, cargo
//    debajo, contactos (teléfono · email · dirección) en cuerpo sans.
//
//  · QR auxiliar (~14mm) en la esquina, no protagonista. La tarjeta
//    YA da los datos físicos completos; el QR es la extensión al perfil
//    digital para quien quiera más (servicios, fotos, WhatsApp).
//
//  · Single-side. La idea es que cualquier imprenta digital la imprima
//    en un click; doble cara exigiría briefing de impresor.
//
// El fallback de `direccion` (card → org) cubre dos casos reales:
//  - Equipo distribuido (cada miembro su sede) → usa la del card.
//  - Despacho con sede única (20 empleados misma dirección) → usa la
//    de la org porque las cards individuales no la llenarán.

const BIZCARD_WIDTH  = 240.94; // 85 mm en puntos PDF
const BIZCARD_HEIGHT = 155.91; // 55 mm

// Fetch + normalización del logo de la org a PNG buffer para embeberlo
// en el PDF. PDFKit solo digiere PNG y JPG nativos — los SVG los pasamos
// por Resvg (ya en deps), los WEBP y resto los descartamos en silencio.
// Timeout 3s + try/catch defensivo: si el logo está caído o no es válido,
// el PDF sigue generándose sin él (la marca queda en el nombre de la org).
async function fetchLogoAsPngBuffer(logoUrl, { timeoutMs = 3000, targetWidth = 400 } = {}) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  if (!/^https:\/\//.test(logoUrl)) return null;
  let controller;
  let timer;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('image/png') || ct.includes('image/jpeg') || ct.includes('image/jpg')) {
      return buf;
    }
    if (ct.includes('image/svg')) {
      try {
        const resvg = new Resvg(buf.toString('utf8'), {
          fitTo: { mode: 'width', value: targetWidth },
          font: { fontDirs: [FONTS_DIR], loadSystemFonts: false, defaultFontFamily: 'Inter' },
        });
        return resvg.render().asPng();
      } catch (err) {
        console.warn('fetchLogoAsPngBuffer: SVG render falló:', err.message);
        return null;
      }
    }
    // image/webp u otros — los saltamos para no inyectar formato no soportado.
    return null;
  } catch (err) {
    if (timer) clearTimeout(timer);
    console.warn('fetchLogoAsPngBuffer: fetch falló:', err.message);
    return null;
  }
}

// Renderiza UNA tarjeta de visita en la página activa del documento.
// Aislado para poder reusarlo en el booklet multi-página sin duplicar lógica.
// El `logoBuffer` se inyecta ya resuelto desde fuera — fetcheo de logo
// es lento, los callers que iteran sobre N miembros lo cachean.
function renderBusinessCard(doc, { card, org, logoBuffer, qrBuffer, cardUrl }) {
  const orgName     = org && org.name     ? String(org.name).trim()     : '';
  const orgColor    = org && org.color_primary && /^#[0-9a-fA-F]{6}$/.test(org.color_primary)
    ? org.color_primary : COLORS.ink;
  // Leyenda verde uppercase = "firma del equipo", se configura una sola vez
  // en organizations.tagline y se aplica a todas las cards de la org. Las
  // cards no la guardan duplicada — antes vivía en cards.tagline (un dato
  // común repetido por miembro), ahora es propiedad de la org.
  const teamLegend  = org && org.tagline ? String(org.tagline).trim() : '';
  const nombreRaw   = card.nombre  ? String(card.nombre).trim()  : '—';
  const taglineCard = card.tagline ? String(card.tagline).trim() : '';

  // El cargo individual del miembro ("Director Comercial", "CEO"…) sale en
  // su propia línea bajo el nombre. Dos fuentes posibles:
  //   1. card.tagline (formato post-PR#111: el form pone el cargo en la 3ª
  //      columna y eso se persiste en tagline).
  //   2. Split del nombre por la primera coma (formato legacy: cards
  //      antiguas con "Sisco Benet, Dirección Comercial" en nombre).
  // Si hay coma en el nombre, la prioridad es el split — esa coma es señal
  // explícita de que el cargo está concatenado y debe extraerse.
  let displayName = nombreRaw;
  let displayCargo = '';
  const commaIdx = nombreRaw.indexOf(',');
  if (commaIdx > 0 && commaIdx < nombreRaw.length - 1) {
    displayName  = nombreRaw.substring(0, commaIdx).trim();
    displayCargo = nombreRaw.substring(commaIdx + 1).trim().replace(/[.;]+$/, '');
  }
  if (!displayCargo && taglineCard) {
    displayCargo = taglineCard;
  }

  // Address fallback: card.direccion → org.address. Cubre los dos casos
  // (equipo distribuido vs sede única). Si ninguno, se omite la línea.
  const direccion   = card.direccion ? String(card.direccion).trim()
                                     : (org && org.address ? String(org.address).trim() : '');
  const telefono    = card.whatsapp  ? formatSpanishPhone(card.whatsapp) : '';
  const email       = card.email     ? String(card.email).trim()         : '';

  const W = BIZCARD_WIDTH;
  const H = BIZCARD_HEIGHT;

  // Fondo blanco
  doc.rect(0, 0, W, H).fill(COLORS.surface);

  // Franja superior con color de la org · 36pt alto ≈ 12.7mm.
  // Logo en píldora blanca a la izquierda + nombre de la org centrado/derecha.
  // STRIP_H subió a 36pt (era 28pt → 22pt → 17pt en versiones previas) tras
  // confirmar con tarjetas impresas que el logo es height-bound: su proporción
  // intrínseca limita el crecimiento. Necesita altura para crecer visualmente,
  // no más ancho. Strip = 23% del alto de la tarjeta — caro pero es el sello
  // físico de pertenencia al equipo, justifica el espacio.
  const STRIP_H = 36;
  doc.rect(0, 0, W, STRIP_H).fill(orgColor);

  let orgNameX = 10;
  if (logoBuffer) {
    try {
      // Píldora blanca con padding mínimo (1pt vertical) para que el logo
      // llegue casi al borde y se aproveche todo el alto de la franja.
      // Logos con whitespace propio en el PNG ya tienen su propio margen —
      // duplicarlo con padding del contenedor hacía que el logo se viera
      // diminuto incluso con boxes grandes.
      const logoPadY = 1;
      const logoBoxH = STRIP_H - logoPadY * 2;   // = 34
      const logoBoxW = 78;
      doc.roundedRect(6, logoPadY, logoBoxW, logoBoxH, 2).fill('#FFFFFF');
      doc.image(logoBuffer, 7, logoPadY + 1, {
        fit: [logoBoxW - 2, logoBoxH - 2],
        align: 'center',
        valign: 'center',
      });
      orgNameX = 6 + logoBoxW + 6;
    } catch (err) {
      console.warn('renderBusinessCard: doc.image del logo falló:', err.message);
      orgNameX = 10;
    }
  }

  if (orgName) {
    const orgNameMaxW = W - orgNameX - 10;
    doc.font('PP-Serif').fontSize(10).fillColor('#FFFFFF')
       .text(orgName.substring(0, 60), orgNameX, 14, {
         width: orgNameMaxW, align: logoBuffer ? 'left' : 'center',
         lineBreak: false, ellipsis: true,
       });
  }

  // Cuerpo. Columna izquierda: identidad + contactos. Derecha: QR + URL.
  // QR_SIZE subió de 40pt a 46pt (+15%) — escaneable con más confianza
  // desde el móvil a 30-40cm, que es la distancia natural cuando alguien
  // te pasa una tarjeta de visita.
  const BODY_TOP    = STRIP_H + 10;
  const PAD_X       = 12;
  const QR_SIZE     = 46;
  const QR_X        = W - QR_SIZE - 10;
  const QR_Y        = BODY_TOP;
  const LEFT_W      = QR_X - PAD_X - 6;

  // Nombre del miembro · serif grande, peso. Es el protagonista del cuerpo.
  // Triple defensa contra desbordes:
  //   (1) Medimos con `widthOfString` y bajamos fontSize de 14→7 en pasos de
  //       0.5pt mientras no entre. Comparamos contra LEFT_W × 0.95 porque
  //       PDFKit a veces renderiza ~3-5% más ancho que lo que reporta su
  //       propio widthOfString.
  //   (2) Si al mínimo (7pt) aún no entra, truncamos carácter a carácter
  //       y añadimos elipsis, limpiando puntuación de cola.
  //   (3) En la llamada a `.text()` fijamos `height` además de `width` para
  //       que PDFKit clipee a una sola línea aunque (1) y (2) fallaran.
  // Tras el split-por-coma, `displayName` ya suele ser corto ("Sisco Benet"
  // sin el cargo) y no toca la defensa, pero la dejamos por si alguien
  // tiene un nombre legítimamente largo.
  const NAME_MAX = 14;
  const NAME_MIN = 7;
  const NAME_SAFETY = LEFT_W * 0.95;
  doc.font('PP-Serif');
  let nameFontSize = NAME_MAX;
  let nombreFinal = displayName.substring(0, 50);
  doc.fontSize(nameFontSize);
  while (nameFontSize > NAME_MIN && doc.widthOfString(nombreFinal) > NAME_SAFETY) {
    nameFontSize -= 0.5;
    doc.fontSize(nameFontSize);
  }
  if (doc.widthOfString(nombreFinal) > NAME_SAFETY) {
    while (nombreFinal.length > 1 && doc.widthOfString(nombreFinal + '…') > NAME_SAFETY) {
      nombreFinal = nombreFinal.slice(0, -1);
    }
    nombreFinal = nombreFinal.replace(/[\s,;:.-]+$/, '') + '…';
  }
  doc.fillColor(COLORS.ink)
     .text(nombreFinal, PAD_X, BODY_TOP, {
       width: LEFT_W,
       height: nameFontSize + 4,
       lineBreak: false,
       ellipsis: true,
     });

  // Cargo individual · sans regular sentence-case, color suave. Aparece como
  // subtítulo del nombre. Estilo distinto del verde uppercase para que la
  // jerarquía sea inequívoca: NOMBRE / Cargo / FIRMA DE EQUIPO.
  let cursorY = BODY_TOP + Math.round(nameFontSize * 1.21);
  if (displayCargo) {
    doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(8.5)
       .text(displayCargo.substring(0, 60), PAD_X, cursorY, {
         width: LEFT_W, height: 12, lineBreak: false, ellipsis: true,
       });
    cursorY += 13;
  }

  // Firma de equipo · uppercase tracking en verde-match.
  // Espacio extra antes de la firma para equilibrar visualmente la tarjeta
  // (el nombre + cargo de arriba pesa más, así que damos respiración).
  if (teamLegend) {
    cursorY += 4;
    doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(7)
       .text(teamLegend.toUpperCase().substring(0, 50), PAD_X, cursorY, {
         width: LEFT_W, lineBreak: false, characterSpacing: 1.1, ellipsis: true,
       });
    cursorY += 13;
  } else {
    cursorY += 4;
  }

  // Datos de contacto · sans, una línea por canal. Iconografía texto-Unicode
  // (☎ ✉ 📍) para no depender de glifos de emoji que no embeben todas las
  // imprentas. Si la imprenta no tiene la fuente, cae a un cuadrado neutro
  // sin romper layout — es preferible a una imagen que no escala.
  //
  // Anclamos el bloque al FONDO del cuerpo (justo encima del separador del
  // footer). Si solo hay 2 líneas (p.ej. card sin teléfono guardado), no
  // quedan flotando en el medio dejando un vacío visual abajo: se pegan al
  // pie y la firma de equipo respira arriba. Cuando hay 3 líneas, el
  // espaciado se reparte naturalmente porque el ancla baja queda intacta.
  const lineH = 11.5;
  const contactLines = [];
  if (telefono)  contactLines.push(`☎  ${telefono}`);
  if (email)     contactLines.push(`✉  ${email.substring(0, 50)}`);
  if (direccion) contactLines.push(`📍 ${direccion.substring(0, 60)}`);

  const FOOTER_LINE_Y = H - 16; // = línea fina sobre 'Powered by PerfilaPro'
  const CONTACT_GAP_TO_FOOTER = 4;
  let contactY = FOOTER_LINE_Y - CONTACT_GAP_TO_FOOTER - contactLines.length * lineH;
  // Salvaguarda: si la identidad de arriba creció (nombre largo + cargo +
  // legend con tracking), no dejamos que el bloque de contactos se monte
  // sobre ella. Mantenemos al menos 4pt de respiro.
  contactY = Math.max(contactY, cursorY + 4);
  for (const line of contactLines) {
    doc.fillColor(COLORS.ink).font('PP-Sans').fontSize(8)
       .text(line, PAD_X, contactY, { width: LEFT_W, lineBreak: false, ellipsis: true });
    contactY += lineH;
  }

  // QR (esquina superior derecha del cuerpo). Borde fino para que destaque
  // visualmente sin ser dominante.
  doc.image(qrBuffer, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE });
  doc.rect(QR_X - 0.5, QR_Y - 0.5, QR_SIZE + 1, QR_SIZE + 1)
     .lineWidth(0.3).strokeColor(COLORS.border).stroke();

  // URL corta bajo el QR (sin protocolo, peso normal pero color match).
  // Usamos `perfilapro.es/c/<slug>` — cabe en el ancho del QR si el slug
  // es razonable, y permite que alguien teclee la URL si no puede escanear.
  const slug = card.slug || '';
  const urlLabel = `perfilapro.es/c/${slug}`;
  doc.fillColor(COLORS.match).font('PP-Sans-SemiBold').fontSize(6)
     .text(urlLabel, QR_X - 10, QR_Y + QR_SIZE + 3, {
       width: QR_SIZE + 20, align: 'center', lineBreak: false, ellipsis: true,
     });

  // Footer · línea sutil + atribución mínima. Cumple "Powered by"
  // sin competir visualmente con la marca de la org.
  const FOOTER_Y = H - 12;
  doc.moveTo(PAD_X, FOOTER_Y - 4).lineTo(W - PAD_X, FOOTER_Y - 4)
     .strokeColor(COLORS.border).lineWidth(0.3).stroke();
  doc.fillColor(COLORS.inkSoft).font('PP-Sans').fontSize(6)
     .text('Powered by PerfilaPro', PAD_X, FOOTER_Y, {
       width: W - PAD_X * 2, align: 'right', lineBreak: false,
     });
}

// PDF single-card. Recibe la card + la org resuelta + el logoBuffer ya
// cacheado (si lo hay) y devuelve un Buffer con UNA página tarjeta de visita.
// `siteUrl` permite que el caller controle el dominio (en tests pasamos un
// stub; en prod, el siteUrl del entorno).
async function buildBusinessCardPDF({ card, org, logoBuffer = null, siteUrl } = {}) {
  if (!card || !card.slug) {
    throw new Error('buildBusinessCardPDF: card.slug es obligatorio');
  }
  const baseUrl = siteUrl || process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
  const cardUrl = `${baseUrl}/c/${card.slug}`;
  const qrBuffer = rasterizeQrSvgToPng(cardUrl, 600); // 600px sobra para 14mm

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [BIZCARD_WIDTH, BIZCARD_HEIGHT],
      margin: 0,
      info: {
        Title: `Tarjeta visita ${card.slug} - PerfilaPro`,
        Author: 'PerfilaPro',
        Creator: 'PerfilaPro',
      },
    });
    registerFonts(doc, FONTS_DIR);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderBusinessCard(doc, { card, org, logoBuffer, qrBuffer, cardUrl });
    doc.end();
  });
}

// PDF booklet — una página por miembro del equipo. Pensado para que el admin
// descargue de un click todas las tarjetas y las lleve a la imprenta en un
// único documento. El `logoBuffer` se fetch una sola vez y se reusa en cada
// página (ahorra N peticiones HTTP idénticas). Si la lista está vacía,
// genera un PDF de una página en blanco — el caller decide si rechazar.
async function buildBusinessCardsBookletPDF({ cards, org, siteUrl } = {}) {
  if (!Array.isArray(cards) || !cards.length) {
    throw new Error('buildBusinessCardsBookletPDF: cards debe ser un array no vacío');
  }
  const baseUrl = siteUrl || process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

  // Cacheamos el fetch del logo: idéntico para todas las páginas. Si falla
  // se genera el booklet sin logo (el nombre de la org sigue arriba).
  const logoBuffer = org && org.logo_url ? await fetchLogoAsPngBuffer(org.logo_url) : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [BIZCARD_WIDTH, BIZCARD_HEIGHT],
      margin: 0,
      autoFirstPage: false,
      info: {
        Title: `Tarjetas de visita ${org && org.slug ? org.slug : 'equipo'} - PerfilaPro`,
        Author: 'PerfilaPro',
        Creator: 'PerfilaPro',
      },
    });
    registerFonts(doc, FONTS_DIR);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const card of cards) {
      if (!card || !card.slug) continue;
      doc.addPage({ size: [BIZCARD_WIDTH, BIZCARD_HEIGHT], margin: 0 });
      const cardUrl = `${baseUrl}/c/${card.slug}`;
      const qrBuffer = rasterizeQrSvgToPng(cardUrl, 600);
      renderBusinessCard(doc, { card, org, logoBuffer, qrBuffer, cardUrl });
    }
    doc.end();
  });
}

module.exports = {
  buildPrintableCardPDF,
  buildBusinessCardPDF,
  buildBusinessCardsBookletPDF,
  generateQrPngBuffer,
  buildEscaparateQrPng,
  formatSpanishPhone,
  fetchLogoAsPngBuffer,
  A6_WIDTH,
  A6_HEIGHT,
  BIZCARD_WIDTH,
  BIZCARD_HEIGHT,
};
