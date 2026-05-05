import { describe, it, expect } from 'vitest';
import {
  buildPrintableCardPDF,
  generateQrPngBuffer,
  formatSpanishPhone,
  A6_WIDTH,
  A6_HEIGHT,
} from '../netlify/functions/printable-card-utils.js';

describe('formatSpanishPhone', () => {
  it('formatea E.164 español (34XXXXXXXXX) con espacios', () => {
    expect(formatSpanishPhone('34633816729')).toBe('+34 633 81 67 29');
  });

  it('formatea número local de 9 dígitos', () => {
    expect(formatSpanishPhone('633816729')).toBe('+34 633 81 67 29');
  });

  it('devuelve cadena vacía si phone es falsy', () => {
    expect(formatSpanishPhone(null)).toBe('');
    expect(formatSpanishPhone('')).toBe('');
    expect(formatSpanishPhone(undefined)).toBe('');
  });

  it('devuelve el original si la longitud no es reconocida', () => {
    expect(formatSpanishPhone('1234')).toBe('1234');
    expect(formatSpanishPhone('+1 555 0100')).toBe('+1 555 0100');
  });

  it('limpia caracteres no numéricos antes de formatear', () => {
    expect(formatSpanishPhone('+34 633 81 67 29')).toBe('+34 633 81 67 29');
    expect(formatSpanishPhone('633-81-67-29')).toBe('+34 633 81 67 29');
  });
});

describe('generateQrPngBuffer', () => {
  it('devuelve un Buffer PNG válido (header iVBORw)', async () => {
    const buf = await generateQrPngBuffer('https://perfilapro.es/c/test', 256);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4E);
    expect(buf[3]).toBe(0x47);
  });

  it('respeta el tamaño solicitado (PNG mayor para size mayor)', async () => {
    const small = await generateQrPngBuffer('https://perfilapro.es/c/test', 128);
    const big   = await generateQrPngBuffer('https://perfilapro.es/c/test', 1024);
    expect(big.length).toBeGreaterThan(small.length);
  });
});

describe('buildPrintableCardPDF', () => {
  const baseInput = {
    nombre:   'María Pérez',
    tagline:  'Electricista',
    whatsapp: '34633816729',
    slug:     'maria-electricista',
    cardUrl:  'https://perfilapro.es/c/maria-electricista',
  };

  it('devuelve un Buffer PDF válido (header %PDF-)', async () => {
    const buf = await buildPrintableCardPDF(baseInput);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('genera un PDF con tamaño A6 vertical', async () => {
    // Verificación indirecta: el PDF se genera sin lanzar y tiene tamaño no
    // trivial. Comprobar las dimensiones exactas requeriría parsear el stream.
    expect(A6_WIDTH).toBeCloseTo(297.64, 1);
    expect(A6_HEIGHT).toBeCloseTo(419.53, 1);
    const buf = await buildPrintableCardPDF(baseInput);
    expect(buf.length).toBeGreaterThan(2000); // QR embebido + texto
  });

  it('lanza si falta slug', async () => {
    await expect(buildPrintableCardPDF({ ...baseInput, slug: '' }))
      .rejects.toThrow(/slug/);
  });

  it('lanza si falta cardUrl', async () => {
    await expect(buildPrintableCardPDF({ ...baseInput, cardUrl: '' }))
      .rejects.toThrow(/cardUrl/);
  });

  it('genera PDF aunque tagline o whatsapp estén vacíos', async () => {
    const buf = await buildPrintableCardPDF({
      ...baseInput, tagline: '', whatsapp: '',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('escapa nombre con caracteres no-ASCII (UTF-8 español)', async () => {
    const buf = await buildPrintableCardPDF({
      ...baseInput, nombre: 'Iñaki Muñoz Çavírez', tagline: 'Carpintería',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});
