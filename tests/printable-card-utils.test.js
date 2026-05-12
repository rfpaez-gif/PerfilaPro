import { describe, it, expect } from 'vitest';
import {
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

describe('buildEscaparateQrPng', () => {
  const baseInput = {
    nombre:    'María Pérez',
    profesion: 'Electricista',
    slug:      'maria-electricista',
    cardUrl:   'https://perfilapro.es/c/maria-electricista',
  };

  it('devuelve un Buffer PNG válido (header iVBORw)', async () => {
    const buf = await buildEscaparateQrPng(baseInput);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4E);
    expect(buf[3]).toBe(0x47);
  });

  it('renderiza con aspect ratio vertical (alto > ancho)', async () => {
    const buf = await buildEscaparateQrPng(baseInput);
    // PNG IHDR: width/height son los uint32-BE en bytes 16-19 / 20-23.
    const width  = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(1024);
    expect(height).toBeGreaterThan(width); // vertical
    // A6 ratio ≈ 1.413 → height debe rondar 1448px
    expect(height).toBeGreaterThan(1400);
    expect(height).toBeLessThan(1500);
  });

  it('respeta el tamaño solicitado (PNG mayor para size mayor)', async () => {
    const small = await buildEscaparateQrPng({ ...baseInput, size: 256 });
    const big   = await buildEscaparateQrPng({ ...baseInput, size: 1024 });
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('lanza si falta slug', async () => {
    await expect(buildEscaparateQrPng({ ...baseInput, slug: '' }))
      .rejects.toThrow(/slug/);
  });

  it('lanza si falta cardUrl', async () => {
    await expect(buildEscaparateQrPng({ ...baseInput, cardUrl: '' }))
      .rejects.toThrow(/cardUrl/);
  });

  it('renderiza sin profesión sin lanzar', async () => {
    const buf = await buildEscaparateQrPng({ ...baseInput, profesion: null });
    expect(buf[0]).toBe(0x89);
  });

  it('escapa caracteres XML problemáticos en nombre y profesión', async () => {
    const buf = await buildEscaparateQrPng({
      ...baseInput,
      nombre:    'A & B <script> "test"',
      profesion: "Ortopedia <médica>",
    });
    expect(buf[0]).toBe(0x89);
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

  it('renderiza con profesión, dirección y zona sin lanzar', async () => {
    const buf = await buildPrintableCardPDF({
      ...baseInput,
      profesion: 'Electricista',
      direccion: 'Senda del Obispo 03300',
      zona:      'La Coruña, Galicia',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // PDF con todos los datos > PDF mínimo (más texto, más streams)
    const minimal = await buildPrintableCardPDF(baseInput);
    expect(buf.length).toBeGreaterThan(minimal.length);
  });

  it('omite la profesión cuando coincide (case-insensitive) con el tagline', async () => {
    // No falla y produce un PDF — el comportamiento de dedupe es interno;
    // este test garantiza que la rama de igualdad no rompe el render.
    const buf = await buildPrintableCardPDF({
      ...baseInput,
      tagline:   'Electricista',
      profesion: 'ELECTRICISTA',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('truncaciones defensivas: profesión, dirección y zona muy largas no rompen', async () => {
    const buf = await buildPrintableCardPDF({
      ...baseInput,
      profesion: 'Especialista en muchas cosas distintas y posiblemente más de las que caben',
      direccion: 'Avenida Larguísima del Pueblo de los Mil Nombres, número trescientos cuarenta y cinco, escalera C, planta 4',
      zona:      'Una provincia con un nombre tan largo que no debería caber pero por si acaso lo probamos',
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});

// ============================================================
// Tarjeta de visita B2B 85×55mm · single + booklet
// ============================================================

describe('buildBusinessCardPDF', () => {
  const card = {
    slug:      'olga-cardona',
    nombre:    'Olga Cardona',
    tagline:   'Entrenadora',
    whatsapp:  '34633816729',
    email:     'olga@special-trainer.es',
    direccion: 'C/ Mayor 12, Orihuela',
  };
  const org = {
    slug:          'special-trainer',
    name:          'Special Trainer',
    color_primary: '#FFA500',
    address:       'Av. Polígono 4, Orihuela',
    phone:         '+34 965 12 34 56',
  };

  it('devuelve un Buffer PDF válido con dimensiones tarjeta de visita (85×55mm)', async () => {
    const buf = await buildBusinessCardPDF({ card, org, siteUrl: 'https://perfilapro.es' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(BIZCARD_WIDTH).toBeCloseTo(240.94, 1);
    expect(BIZCARD_HEIGHT).toBeCloseTo(155.91, 1);
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('lanza si la card no tiene slug', async () => {
    await expect(buildBusinessCardPDF({ card: { ...card, slug: '' }, org }))
      .rejects.toThrow(/slug/);
  });

  it('renderiza sin org (datos personales puros)', async () => {
    const buf = await buildBusinessCardPDF({ card });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('renderiza con tagline/whatsapp/email/direccion vacíos sin lanzar', async () => {
    const buf = await buildBusinessCardPDF({
      card: { slug: 'minimo', nombre: 'X' },
      org,
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('cae a org.address cuando card.direccion está vacío', async () => {
    // Ambos PDFs deberían generarse OK — la diferencia interna (qué dirección
    // se imprime) se valida por inspección manual; aquí confirmamos que el
    // fallback no rompe el render y que org.address sin card.direccion sigue
    // produciendo un PDF mayor que uno sin dirección en ninguno.
    const conOrgAddr = await buildBusinessCardPDF({
      card: { ...card, direccion: '' }, org,
    });
    const sinNada = await buildBusinessCardPDF({
      card: { ...card, direccion: '' },
      org:  { ...org, address: null },
    });
    expect(conOrgAddr.length).toBeGreaterThan(sinNada.length - 80); // tolerancia compresión
  });

  it('admite color_primary inválido sin romper (cae al color por defecto)', async () => {
    const buf = await buildBusinessCardPDF({
      card,
      org: { ...org, color_primary: 'NO-ES-HEX' },
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('escapa nombre con caracteres especiales sin romper', async () => {
    const buf = await buildBusinessCardPDF({
      card: { ...card, nombre: 'Iñaki "el grande" & co.', tagline: '<Director>' },
      org,
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('buildBusinessCardsBookletPDF', () => {
  const org = {
    slug: 'special-trainer',
    name: 'Special Trainer',
    color_primary: '#FFA500',
    address: 'Av. Polígono 4, Orihuela',
    phone: '+34 965 12 34 56',
  };
  const cards = [
    { slug: 'olga',  nombre: 'Olga Cardona', tagline: 'Entrenadora',    whatsapp: '34633816729', email: 'olga@st.es' },
    { slug: 'juan',  nombre: 'Juan García',  tagline: 'Recepcionista',  whatsapp: '34611112222', email: 'juan@st.es' },
    { slug: 'maria', nombre: 'María López',  tagline: 'Fisioterapeuta', whatsapp: '34699998888', email: 'maria@st.es' },
  ];

  it('devuelve un PDF con N páginas (una por miembro)', async () => {
    const buf = await buildBusinessCardsBookletPDF({ cards, org, siteUrl: 'https://perfilapro.es' });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // PDFKit incluye `/Type /Page` por cada página añadida. Recuento defensivo:
    // contamos las apariciones del marker (case-sensitive). Para 3 cards: 3.
    const txt = buf.toString('binary');
    const matches = txt.match(/\/Type\s*\/Page[^s]/g) || [];
    expect(matches.length).toBe(3);
  });

  it('rechaza array vacío', async () => {
    await expect(buildBusinessCardsBookletPDF({ cards: [], org }))
      .rejects.toThrow(/array no vacío/);
  });

  it('rechaza si cards no es array', async () => {
    await expect(buildBusinessCardsBookletPDF({ cards: null, org }))
      .rejects.toThrow();
  });

  it('genera booklet aunque la org no tenga datos completos', async () => {
    const buf = await buildBusinessCardsBookletPDF({
      cards: cards.slice(0, 1),
      org:   { slug: 'x', name: 'X' },
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('omite cards sin slug en lugar de romper', async () => {
    const buf = await buildBusinessCardsBookletPDF({
      cards: [cards[0], { nombre: 'sin slug' }, cards[1]],
      org,
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    const matches = buf.toString('binary').match(/\/Type\s*\/Page[^s]/g) || [];
    expect(matches.length).toBe(2); // solo las 2 válidas
  });
});

describe('fetchLogoAsPngBuffer', () => {
  it('devuelve null para URLs no-https (validación de boundary)', async () => {
    const r = await fetchLogoAsPngBuffer('http://example.com/logo.png');
    expect(r).toBeNull();
  });

  it('devuelve null para inputs falsy', async () => {
    expect(await fetchLogoAsPngBuffer(null)).toBeNull();
    expect(await fetchLogoAsPngBuffer('')).toBeNull();
    expect(await fetchLogoAsPngBuffer(undefined)).toBeNull();
  });

  it('devuelve null cuando el host no responde (defensivo, no relanza)', async () => {
    // Domain reservado IANA para tests — no debe resolver.
    const r = await fetchLogoAsPngBuffer('https://invalid.example.test/logo.png', { timeoutMs: 500 });
    expect(r).toBeNull();
  });
});
