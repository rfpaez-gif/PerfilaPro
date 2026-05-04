import { describe, it, expect } from 'vitest';
const { GBP_CATEGORIES, PHOTO_SLOTS, buildDescription, buildPosts, buildSteps } = require('../netlify/functions/lib/gbp-templates.js');

const sampleCard = {
  slug:    'ana-electricista',
  nombre:  'Ana López',
  tagline: 'Electricista en Madrid',
  zona:    'Madrid centro · hasta 25 km',
  servicios: ['Instalación eléctrica · 80€', 'Reparaciones urgencia 24h'],
};

describe('GBP_CATEGORIES', () => {
  it('cubre los 20 sectores de PerfilaPro', () => {
    const expected = ['oficios', 'salud', 'educacion', 'comercial', 'belleza', 'reforma', 'hosteleria', 'tech', 'legal', 'jardineria', 'transporte', 'fotografia', 'eventos', 'automocion', 'seguridad', 'cuidados', 'fitness', 'turismo', 'comercio', 'otro'];
    for (const sector of expected) {
      expect(GBP_CATEGORIES[sector]).toBeDefined();
      expect(GBP_CATEGORIES[sector].length).toBeGreaterThan(0);
    }
  });
});

describe('buildDescription', () => {
  it('incluye nombre, tagline, zona y servicios', () => {
    const desc = buildDescription(sampleCard);
    expect(desc).toContain('Ana López');
    expect(desc).toContain('Electricista en Madrid');
    expect(desc).toContain('Madrid centro');
    expect(desc).toContain('Instalación eléctrica');
  });

  it('respeta límite de 750 caracteres', () => {
    const longCard = {
      ...sampleCard,
      tagline:   'Tagline larguísima con mucho texto descriptivo'.repeat(10),
      servicios: Array(20).fill('Servicio especializado y muy descrito en detalle'),
    };
    const desc = buildDescription(longCard);
    expect(desc.length).toBeLessThanOrEqual(750);
  });

  it('elimina el precio (· 80€) de los servicios listados', () => {
    const desc = buildDescription(sampleCard);
    expect(desc).not.toContain('80€');
    expect(desc).toContain('Instalación eléctrica');
  });

  it('funciona con datos mínimos', () => {
    const desc = buildDescription({ slug: 'x', nombre: 'X' });
    expect(desc).toContain('X');
    expect(desc.length).toBeGreaterThan(20);
  });
});

describe('buildPosts', () => {
  it('genera 5 posts con title, body y cta', () => {
    const posts = buildPosts(sampleCard);
    expect(posts).toHaveLength(5);
    for (const p of posts) {
      expect(p.title).toBeTruthy();
      expect(p.body).toBeTruthy();
      expect(p.cta).toBeDefined();
      expect(p.cta.url).toContain('perfilapro.es/c/ana-electricista');
    }
  });

  it('inserta nombre y zona en al menos un post', () => {
    const posts = buildPosts(sampleCard);
    const allBody = posts.map(p => p.body).join(' ');
    expect(allBody).toContain('Ana');
    expect(allBody).toContain('Madrid');
  });
});

describe('buildSteps', () => {
  it('genera 9 pasos con id, title, body', () => {
    const steps = buildSteps(sampleCard, 'https://perfilapro.es');
    expect(steps).toHaveLength(9);
    for (const s of steps) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.body).toBeTruthy();
    }
  });

  it('algunos pasos tienen action.copy con valor útil', () => {
    const steps = buildSteps(sampleCard, 'https://perfilapro.es');
    const nameStep = steps.find(s => s.id === 'name');
    expect(nameStep.action).toEqual({ type: 'copy', value: 'Ana López' });
    const websiteStep = steps.find(s => s.id === 'website');
    expect(websiteStep.action.value).toBe('https://perfilapro.es/c/ana-electricista');
  });
});

describe('PHOTO_SLOTS', () => {
  it('expone 5 slots con label, spec y tip', () => {
    expect(PHOTO_SLOTS).toHaveLength(5);
    for (const slot of PHOTO_SLOTS) {
      expect(slot.key).toBeTruthy();
      expect(slot.label).toBeTruthy();
      expect(slot.spec).toBeTruthy();
      expect(slot.tip).toBeTruthy();
    }
  });
});
