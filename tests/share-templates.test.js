import { describe, it, expect } from 'vitest';
const { TEMPLATES, buildTemplate } = require('../netlify/functions/lib/share-templates.js');

const sampleCard = {
  slug:    'ana-pro',
  nombre:  'Ana López',
  tagline: 'Electricista en Madrid',
  zona:    'Madrid · 25 km',
};

describe('share-templates', () => {
  it('expone las 4 plantillas con dimensiones correctas', () => {
    expect(TEMPLATES.og).toEqual({ width: 1200, height: 630,  layout: 'horizontal' });
    expect(TEMPLATES.square).toEqual({ width: 1080, height: 1080, layout: 'vertical' });
    expect(TEMPLATES.story).toEqual({ width: 1080, height: 1920, layout: 'vertical' });
    expect(TEMPLATES.linkedin).toEqual({ width: 1200, height: 627, layout: 'horizontal' });
  });

  it('buildTemplate("og") devuelve árbol con width/height correctos', () => {
    const tree = buildTemplate('og', { card: sampleCard, siteUrl: 'https://perfilapro.es' });
    expect(tree.type).toBe('div');
    expect(tree.props.style.width).toBe(1200);
    expect(tree.props.style.height).toBe(630);
  });

  it('buildTemplate("story") usa layout vertical', () => {
    const tree = buildTemplate('story', { card: sampleCard, siteUrl: 'https://perfilapro.es' });
    expect(tree.props.style.flexDirection).toBe('column');
    expect(tree.props.style.height).toBe(1920);
  });

  it('inserta el nombre de la card en algún nodo', () => {
    const tree = buildTemplate('og', { card: sampleCard, siteUrl: 'https://perfilapro.es' });
    const json = JSON.stringify(tree);
    expect(json).toContain('Ana López');
    expect(json).toContain('Electricista en Madrid');
  });

  it('renderiza inicial cuando no hay foto_url', () => {
    const tree = buildTemplate('og', { card: { ...sampleCard, foto_url: null }, siteUrl: 'https://perfilapro.es' });
    const json = JSON.stringify(tree);
    // La inicial se renderiza como children de un div (no como img)
    expect(json).toContain('"children":"A"');
  });

  it('lanza con plantilla desconocida', () => {
    expect(() => buildTemplate('inexistente', { card: sampleCard, siteUrl: '' })).toThrow();
  });
});
