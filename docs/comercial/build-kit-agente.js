#!/usr/bin/env node
/**
 * Genera 7 PDFs branded a partir de los .md del kit del agente.
 *
 * Uso:
 *   node docs/comercial/build-kit-agente.js                # todos
 *   node docs/comercial/build-kit-agente.js portal links   # subset
 *
 * Paleta y fuentes sincronizadas con docs/comercial/build-one-pager.js
 * y netlify/functions/lib/email-layout.js. Cualquier cambio de rebrand
 * toca los tres en el mismo commit.
 *
 * El markdown sigue siendo la fuente editable. El PDF se regenera.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONTS_DIR = path.join(__dirname, '..', '..', 'netlify', 'functions', 'lib', 'fonts');
const DOCS_DIR  = __dirname;

// ── Paleta (mismas hex que build-one-pager.js) ───────────────────
const C = {
  ink:      '#0A1F44',
  inkSoft:  '#6B7280',
  inkPale:  '#B8C5D6',
  match:    '#00C277',
  matchDk:  '#00A865',
  matchLt:  '#E6F9F0',
  crema:    '#FAF7F0',
  border:   '#E5E7EB',
  white:    '#FFFFFF',
  code:     '#1F2937',
  codeBg:   '#F3F4F6',
  alert:    '#B23A48',
  alertBg:  '#FCEAEC',
};

const FONTS = {
  serif:    'SourceSerif4-Semibold.ttf',
  serifIt:  'SourceSerif4-SemiboldIt.ttf',
  sans:     'Inter-Regular.ttf',
  sansBold: 'Inter-Bold.ttf',
  sansSemi: 'Inter-SemiBold.ttf',
};

// ── A4 ───────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 50;
const CW = PAGE_W - M * 2;
const HEADER_H = 44;
const FOOTER_H = 28;
const BODY_TOP = HEADER_H + 26;
const BODY_BOTTOM = PAGE_H - FOOTER_H - 8;

// ── Piezas ───────────────────────────────────────────────────────
const PIECES = [
  { key: 'index',        file: 'kit-agente-README.md',                  title: 'Kit del agente',          eyebrow: 'Pieza 3 · Paquete comercial', subtitle: 'Material para colaboradores que captan organizaciones B2B' },
  { key: 'portal',       file: 'kit-agente-portal-readme.md',           title: 'Portal del agente',       eyebrow: 'Pieza 1 · Kit del agente',    subtitle: 'Qué ves, cómo se navega, qué significa cada KPI' },
  { key: 'links',        file: 'kit-agente-links-referido.md',          title: 'Links de referido',       eyebrow: 'Pieza 2 · Kit del agente',    subtitle: 'Autónomos vs B2B · cuándo usar cada uno · atribución paso a paso' },
  { key: 'comisiones',   file: 'kit-agente-comisiones.md',              title: 'Modelo de comisión',      eyebrow: 'Pieza 3 · Kit del agente',    subtitle: 'Números reales, escenarios cerrados, override L2-on-L1' },
  { key: 'plantillas',   file: 'kit-agente-plantillas-prospeccion.md',  title: 'Plantillas de prospección', eyebrow: 'Pieza 4 · Kit del agente',  subtitle: 'Email, WhatsApp, LinkedIn · español y catalán · 3 ángulos' },
  { key: 'cobros',       file: 'kit-agente-operativa-cobros.md',        title: 'Operativa de cobros',     eyebrow: 'Pieza 5 · Kit del agente',    subtitle: 'Ciclo de liquidación, factura a PerfilaPro, soporte documental' },
  { key: 'que-no-hacer', file: 'kit-agente-que-no-hacer.md',            title: 'Qué NO hacer',            eyebrow: 'Pieza 6 · Kit del agente',    subtitle: 'Promesas, descuentos, manejo de leads del founder' },
];

// ─────────────────────────────────────────────────────────────────
// Parser markdown ligero. Cubre lo que escribimos en los .md:
//   #..###  headings  ·  ```...```  code blocks  ·  > quote
//   - / 1.  listas    ·  | … |       tablas      ·  ---  hr
//   **bold** *italic* `code` [text](url)  inline
// ─────────────────────────────────────────────────────────────────
function parseMarkdown(src) {
  const lines = src.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const out = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { out.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', text: out.join('\n') });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (/^>\s/.test(line)) {
      const out = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        out.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: out.join(' ') });
      continue;
    }

    // Lista (bullet o numerada, sin nesting profundo)
    if (/^([-*]|\d+\.)\s/.test(line)) {
      const items = [];
      const ordered = /^\d+\./.test(line.trim());
      while (i < lines.length) {
        const m = lines[i].match(/^([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        let txt = m[2];
        let j = i + 1;
        while (
          j < lines.length
          && lines[j].trim() !== ''
          && !/^([-*]|\d+\.)\s/.test(lines[j])
          && !/^#{1,6}\s/.test(lines[j])
          && !/^```/.test(lines[j])
          && !/^\|/.test(lines[j])
          && !/^>\s/.test(lines[j])
        ) {
          txt += ' ' + lines[j].trim();
          j++;
        }
        items.push(txt);
        i = j;
        if (i < lines.length && lines[i].trim() === '') break;
      }
      blocks.push({ type: 'list', items, ordered });
      continue;
    }

    // Tabla con header + separador `|---|---|`
    if (
      /^\|/.test(line)
      && i + 1 < lines.length
      && /^\|[\s|:-]+\|$/.test(lines[i + 1].trim())
    ) {
      const rows = [];
      const splitRow = (s) => s.split('|').slice(1, -1).map(c => c.trim());
      rows.push(splitRow(line));
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    // Párrafo: une líneas hasta blank o cambio de tipo
    const para = [line];
    i++;
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^(#{1,6}\s|```|>\s|---|\|)/.test(lines[i])
      && !/^([-*]|\d+\.)\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

// Inline: parsea **bold**, *italic*, `code`, [text](url). Devuelve segmentos.
function parseInline(text) {
  const segs = [];
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { segs.push({ kind: 'text', value: buf }); buf = ''; } };

  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) { flush(); segs.push({ kind: 'bold', value: text.slice(i + 2, end) }); i = end + 2; continue; }
    }
    if (text[i] === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1 && text[end - 1] !== '*' && text[end + 1] !== '*') {
        flush(); segs.push({ kind: 'italic', value: text.slice(i + 1, end) }); i = end + 1; continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) { flush(); segs.push({ kind: 'code', value: text.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd !== -1) {
          flush();
          segs.push({ kind: 'link', value: text.slice(i + 1, close), url: text.slice(close + 2, urlEnd) });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return segs;
}

// ─────────────────────────────────────────────────────────────────
// Renderer con paginación automática
// ─────────────────────────────────────────────────────────────────
function registerFonts(doc) {
  doc.registerFont('serif',    path.join(FONTS_DIR, FONTS.serif));
  doc.registerFont('serif-it', path.join(FONTS_DIR, FONTS.serifIt));
  doc.registerFont('sans',     path.join(FONTS_DIR, FONTS.sans));
  doc.registerFont('sans-b',   path.join(FONTS_DIR, FONTS.sansBold));
  doc.registerFont('sans-s',   path.join(FONTS_DIR, FONTS.sansSemi));
}

class Renderer {
  constructor(doc, piece) {
    this.doc = doc;
    this.piece = piece;
    this.pageNum = 0;
    this.cursor = BODY_TOP;
    this.skipFirstH1 = true; // el H1 lo pinta drawCover; no lo repetimos en cuerpo
  }

  ensureSpace(needed) {
    if (this.cursor + needed > BODY_BOTTOM) this.newPage();
  }

  newPage() {
    this.doc.addPage();
    this.drawPageChrome();
    this.cursor = BODY_TOP;
  }

  drawPageChrome() {
    this.pageNum++;
    const doc = this.doc;

    // Header negro
    doc.save().rect(0, 0, PAGE_W, HEADER_H).fill(C.ink).restore();
    doc.font('serif').fontSize(16).fillColor(C.white).text('Perfila', M, 15, { continued: true, lineBreak: false });
    doc.font('serif-it').fontSize(16).fillColor(C.match).text('Pro', { lineBreak: false });
    doc.font('sans-s').fontSize(8).fillColor(C.inkPale).text(
      this.piece.title,
      M, 19, { width: CW, align: 'right' }
    );

    // Footer
    doc.font('sans').fontSize(7).fillColor(C.inkSoft).text(
      'PerfilaPro · Kit del agente · perfilapro.es',
      M, PAGE_H - FOOTER_H + 8, { width: CW - 40, align: 'left' }
    );
    doc.font('sans-s').fontSize(7).fillColor(C.inkSoft).text(
      `${this.pageNum}`,
      M, PAGE_H - FOOTER_H + 8, { width: CW, align: 'right' }
    );
  }

  drawCover() {
    const doc = this.doc;
    doc.save().rect(0, 0, PAGE_W, PAGE_H).fill(C.ink).restore();

    // Acento verde superior
    doc.save().rect(0, 0, PAGE_W, 6).fill(C.match).restore();

    // Wordmark grande
    const wy = 110;
    doc.font('serif').fontSize(42).fillColor(C.white)
      .text('Perfila', 0, wy, { width: PAGE_W, align: 'center', continued: true, lineBreak: false });
    doc.font('serif-it').fontSize(42).fillColor(C.match).text('Pro', { lineBreak: false });

    // Eyebrow
    doc.font('sans-s').fontSize(10).fillColor(C.inkPale).text(
      (this.piece.eyebrow || '').toUpperCase(),
      0, wy + 70, { width: PAGE_W, align: 'center', characterSpacing: 2.5 }
    );

    // Línea separadora corta verde
    const lineY = wy + 100;
    doc.save().moveTo(PAGE_W / 2 - 24, lineY).lineTo(PAGE_W / 2 + 24, lineY).lineWidth(1.5).strokeColor(C.match).stroke().restore();

    // Título grande serif
    doc.font('serif').fontSize(36).fillColor(C.white).text(
      this.piece.title,
      M, lineY + 30, { width: CW, align: 'center' }
    );

    // Subtítulo
    doc.font('sans').fontSize(12).fillColor(C.inkPale).text(
      this.piece.subtitle,
      M + 30, doc.y + 18, { width: CW - 60, align: 'center', lineGap: 3 }
    );

    // Caja inferior con metadata
    const metaY = PAGE_H - 130;
    doc.save().rect(M, metaY, CW, 80).strokeColor('#1A3358').lineWidth(0.5).stroke().restore();

    doc.font('sans-s').fontSize(8).fillColor(C.match).text('USO', M + 16, metaY + 14, { width: 70, characterSpacing: 1.5 });
    doc.font('sans').fontSize(10).fillColor(C.white).text('Interno · Equipo comercial', M + 90, metaY + 12, { width: CW - 104 });

    doc.font('sans-s').fontSize(8).fillColor(C.match).text('VERSIÓN', M + 16, metaY + 36, { width: 70, characterSpacing: 1.5 });
    const today = new Date().toISOString().slice(0, 10);
    doc.font('sans').fontSize(10).fillColor(C.white).text(today, M + 90, metaY + 34, { width: CW - 104 });

    doc.font('sans-s').fontSize(8).fillColor(C.match).text('CONTACTO', M + 16, metaY + 58, { width: 70, characterSpacing: 1.5 });
    doc.font('sans').fontSize(10).fillColor(C.white).text('hola@perfilapro.es · perfilapro.es', M + 90, metaY + 56, { width: CW - 104 });

    // Empezamos página de contenido limpia
    doc.addPage();
    this.drawPageChrome();
    this.cursor = BODY_TOP;
  }

  // ─── Bloques ────────────────────────────────────────────────
  renderHeading(level, text) {
    if (level === 1 && this.skipFirstH1) { this.skipFirstH1 = false; return; }

    const cfg = {
      1: { font: 'serif',  size: 22, top: 16, gap: 10, color: C.ink     },
      2: { font: 'serif',  size: 17, top: 18, gap: 8,  color: C.ink     },
      3: { font: 'sans-b', size: 12, top: 14, gap: 6,  color: C.ink     },
      4: { font: 'sans-s', size: 10, top: 10, gap: 4,  color: C.matchDk },
      5: { font: 'sans-s', size: 9.5, top: 8, gap: 3,  color: C.matchDk },
      6: { font: 'sans-s', size: 9,  top: 6,  gap: 2,  color: C.matchDk },
    }[level] || { font: 'sans-s', size: 10, top: 8, gap: 4, color: C.ink };

    this.cursor += cfg.top;
    const measured = this.doc.font(cfg.font).fontSize(cfg.size).heightOfString(text, { width: CW });
    this.ensureSpace(measured + cfg.gap);

    // H2 con regla verde discreta arriba
    if (level === 2) {
      this.doc.save().moveTo(M, this.cursor - 6).lineTo(M + 30, this.cursor - 6).lineWidth(1.5).strokeColor(C.match).stroke().restore();
    }

    this.doc.font(cfg.font).fontSize(cfg.size).fillColor(cfg.color).text(text, M, this.cursor, { width: CW });
    this.cursor = this.doc.y + cfg.gap;
  }

  renderParagraph(text) {
    const measured = this.doc.font('sans').fontSize(10).heightOfString(text, { width: CW, lineGap: 3 });
    this.ensureSpace(measured + 4);
    this._renderInlineFlow(text, M, this.cursor, CW, 10, 3);
    this.cursor = this.doc.y + 6;
  }

  renderList(items, ordered) {
    items.forEach((item, idx) => {
      const marker = ordered ? `${idx + 1}.` : '·';
      const indent = ordered ? 22 : 14;
      const measured = this.doc.font('sans').fontSize(10).heightOfString(item, { width: CW - indent, lineGap: 2 });
      this.ensureSpace(measured + 4);

      this.doc.font('sans-b').fontSize(10).fillColor(C.matchDk).text(
        marker, M, this.cursor, { width: indent - 4 }
      );
      this._renderInlineFlow(item, M + indent, this.cursor, CW - indent, 10, 2);
      this.cursor = this.doc.y + 3;
    });
    this.cursor += 4;
  }

  renderCode(text) {
    const lines = text.split('\n');
    const padding = 10;
    const lineH = 12;
    const boxH = Math.max(lines.length * lineH + padding * 2, 30);

    // Si el code block es muy largo, dejamos que la caja se rompa en páginas.
    // Implementación simple: dibujamos por fragmentos cuando excede.
    let remaining = lines.slice();
    while (remaining.length > 0) {
      const available = BODY_BOTTOM - this.cursor;
      const maxLines = Math.max(1, Math.floor((available - padding * 2) / lineH));
      const chunk = remaining.slice(0, Math.min(maxLines, remaining.length));
      const chunkH = chunk.length * lineH + padding * 2;

      if (chunk.length === 0 || (chunk.length < remaining.length && chunkH > available)) {
        this.newPage();
        continue;
      }
      // Si en esta página caben todas, salimos del while con un único render.
      if (chunk.length < remaining.length && this.cursor === BODY_TOP) {
        // ya hemos saltado de página y aún así no caben todas, segmentamos
      }
      this._drawCodeBox(chunk, padding, lineH, chunkH);
      remaining = remaining.slice(chunk.length);
      if (remaining.length > 0) this.newPage();
    }
  }

  _drawCodeBox(lines, padding, lineH, boxH) {
    const doc = this.doc;
    doc.save().roundedRect(M, this.cursor, CW, boxH, 6).fill(C.codeBg).restore();
    doc.save().roundedRect(M, this.cursor, CW, boxH, 6).lineWidth(0.5).stroke(C.border).restore();
    // Barra acento verde a la izquierda
    doc.save().rect(M, this.cursor, 3, boxH).fill(C.match).restore();

    let y = this.cursor + padding;
    lines.forEach(line => {
      doc.font('sans').fontSize(8.5).fillColor(C.code).text(
        line || ' ',
        M + padding + 4, y,
        { width: CW - padding * 2 - 6, lineBreak: false, ellipsis: true }
      );
      y += lineH;
    });
    this.cursor += boxH + 8;
  }

  renderTable(rows) {
    if (!rows.length) return;
    const cols = rows[0].length || 1;
    const colW = CW / cols;
    const cellPad = 6;

    const rowHeights = rows.map((row, idx) => {
      const font = idx === 0 ? 'sans-s' : 'sans';
      const size = idx === 0 ? 9 : 9.5;
      return Math.max(
        ...row.map(cell =>
          this.doc.font(font).fontSize(size).heightOfString(cell || ' ', { width: colW - cellPad * 2, lineGap: 1.5 })
        )
      ) + cellPad * 2;
    });

    let y = this.cursor;
    rows.forEach((row, rIdx) => {
      const rh = rowHeights[rIdx];
      // Page break entre filas si no cabe la siguiente
      if (y + rh > BODY_BOTTOM) {
        this.newPage();
        y = this.cursor;
      }
      if (rIdx === 0) {
        this.doc.save().rect(M, y, CW, rh).fill(C.crema).restore();
      }
      this.doc.save().moveTo(M, y + rh).lineTo(M + CW, y + rh).lineWidth(0.5).strokeColor(C.border).stroke().restore();

      row.forEach((cell, cIdx) => {
        const x = M + cIdx * colW;
        const font = rIdx === 0 ? 'sans-s' : 'sans';
        const size = rIdx === 0 ? 9 : 9.5;
        const color = rIdx === 0 ? C.inkSoft : C.ink;
        this.doc.font(font).fontSize(size).fillColor(color).text(
          cell || ' ',
          x + cellPad, y + cellPad,
          { width: colW - cellPad * 2, lineGap: 1.5 }
        );
      });
      y += rh;
    });
    this.cursor = y + 8;
  }

  renderBlockquote(text) {
    const measured = this.doc.font('serif-it').fontSize(11).heightOfString(text, { width: CW - 30, lineGap: 3 });
    this.ensureSpace(measured + 18);

    const boxH = measured + 14;
    this.doc.save().rect(M, this.cursor, 3, boxH).fill(C.match).restore();
    this.doc.font('serif-it').fontSize(11).fillColor(C.ink).text(
      text, M + 16, this.cursor + 4,
      { width: CW - 30, lineGap: 3 }
    );
    this.cursor += boxH + 6;
  }

  renderHr() {
    this.cursor += 6;
    this.ensureSpace(14);
    this.doc.save().moveTo(M + 60, this.cursor).lineTo(M + CW - 60, this.cursor).lineWidth(0.5).strokeColor(C.border).stroke().restore();
    this.cursor += 14;
  }

  // ─── Inline flow ────────────────────────────────────────────
  _renderInlineFlow(text, x, y, width, sizeBase, lineGap) {
    const segs = parseInline(text);
    let first = true;
    segs.forEach((seg, idx) => {
      const continued = idx < segs.length - 1;

      switch (seg.kind) {
        case 'bold':
          this.doc.font('sans-b').fontSize(sizeBase).fillColor(C.ink);
          break;
        case 'italic':
          this.doc.font('serif-it').fontSize(sizeBase + 0.5).fillColor(C.ink);
          break;
        case 'code': {
          // Inline code con leve highlight (cambia color, sin background — caro de medir)
          this.doc.font('sans-b').fontSize(sizeBase - 0.5).fillColor(C.matchDk);
          break;
        }
        case 'link':
          this.doc.font('sans-s').fontSize(sizeBase).fillColor(C.matchDk);
          break;
        default:
          this.doc.font('sans').fontSize(sizeBase).fillColor(C.ink);
      }

      const opts = { continued, lineGap, width };
      if (first) { this.doc.text(seg.value, x, y, opts); first = false; }
      else       { this.doc.text(seg.value, opts); }
      // Reset
      this.doc.font('sans').fontSize(sizeBase).fillColor(C.ink);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
function buildPiece(piece) {
  const mdPath = path.join(DOCS_DIR, piece.file);
  if (!fs.existsSync(mdPath)) throw new Error(`no existe ${mdPath}`);
  const md = fs.readFileSync(mdPath, 'utf8');
  const blocks = parseMarkdown(md);

  const outPath = path.join(DOCS_DIR, piece.file.replace(/\.md$/, '.pdf'));
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false,
    info: {
      Title:    `PerfilaPro · ${piece.title}`,
      Author:   'PerfilaPro',
      Subject:  'Kit del agente — material comercial',
      Keywords: 'PerfilaPro, agente, comercial, B2B, autónomos',
    },
  });
  registerFonts(doc);
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // Portada (página 1)
  doc.addPage();
  const r = new Renderer(doc, piece);
  r.drawCover();

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':    r.renderHeading(block.level, block.text); break;
      case 'paragraph':  r.renderParagraph(block.text);            break;
      case 'list':       r.renderList(block.items, block.ordered); break;
      case 'code':       r.renderCode(block.text);                 break;
      case 'table':      r.renderTable(block.rows);                break;
      case 'blockquote': r.renderBlockquote(block.text);           break;
      case 'hr':         r.renderHr();                              break;
    }
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

async function buildAll() {
  const filter = process.argv.slice(2);
  const targets = filter.length
    ? PIECES.filter(p => filter.some(f => p.key === f || p.file.includes(f)))
    : PIECES;

  if (!targets.length) {
    console.error('No matches para:', filter.join(', '));
    console.error('Piezas disponibles:', PIECES.map(p => p.key).join(', '));
    process.exit(1);
  }

  for (const piece of targets) {
    const out = await buildPiece(piece);
    const stat = fs.statSync(out);
    console.log(`✓ ${path.basename(out)} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

buildAll().catch(err => {
  console.error('✗ Error:', err);
  process.exit(1);
});
