import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { icon, listIcons, ICONS } from '../netlify/functions/lib/icons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, '..', 'public', 'assets', 'icons');

const CANONICAL_NAMES = [
  'arrow-left', 'arrow-right', 'building', 'check-circle',
  'clock', 'copy', 'download', 'external-link',
  'mail', 'map-pin', 'pencil', 'phone',
  'qr-code', 'search', 'user', 'whatsapp',
];

const STROKE_WIDTH_EXCEPTIONS = ['check-circle', 'qr-code', 'whatsapp'];

describe('icons pack v1', () => {
  it('exports exactly the 16 canonical icons', () => {
    expect(listIcons().sort()).toEqual([...CANONICAL_NAMES].sort());
  });

  it('every .svg file in public/assets/icons/ has a matching key in icons.js', () => {
    const filenames = fs
      .readdirSync(ICONS_DIR)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace(/\.svg$/, ''));
    for (const name of filenames) {
      expect(ICONS).toHaveProperty(name);
    }
  });

  it('every key in icons.js has a matching .svg file', () => {
    for (const name of listIcons()) {
      const filePath = path.join(ICONS_DIR, `${name}.svg`);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('every icon string in icons.js matches its .svg file content', () => {
    for (const name of listIcons()) {
      const fileContent = fs
        .readFileSync(path.join(ICONS_DIR, `${name}.svg`), 'utf8')
        .trim();
      expect(ICONS[name].trim()).toBe(fileContent);
    }
  });

  it('every icon has viewBox="0 0 24 24"', () => {
    for (const name of listIcons()) {
      expect(ICONS[name]).toContain('viewBox="0 0 24 24"');
    }
  });

  it('every linear icon has stroke-width="1.8"', () => {
    const lineales = listIcons().filter(
      (n) => !STROKE_WIDTH_EXCEPTIONS.includes(n)
    );
    expect(lineales.length).toBeGreaterThan(0);
    for (const name of lineales) {
      expect(ICONS[name]).toContain('stroke-width="1.8"');
    }
  });

  it('no icon contains <style>, <defs> or id attribute (CSP-safe)', () => {
    for (const name of listIcons()) {
      expect(ICONS[name]).not.toContain('<style');
      expect(ICONS[name]).not.toContain('<defs');
      expect(ICONS[name]).not.toMatch(/\bid="/);
    }
  });

  it('whatsapp uses fill="currentColor" without stroke', () => {
    expect(ICONS['whatsapp']).toContain('fill="currentColor"');
    expect(ICONS['whatsapp']).not.toContain('stroke=');
  });
});

describe('icon() helper', () => {
  it('returns the raw svg string when called with just a name', () => {
    expect(icon('arrow-right')).toBe(ICONS['arrow-right']);
  });

  it('overrides width and height on the root <svg>', () => {
    const out = icon('arrow-right', { width: 16, height: 16 });
    expect(out).toContain('width="16"');
    expect(out).toContain('height="16"');
    expect(out).not.toContain('width="24"');
    expect(out).not.toContain('height="24"');
  });

  it('does not affect inner element widths/heights when overriding root', () => {
    // qr-code tiene <rect width="5" ...> que NO debe cambiar
    const out = icon('qr-code', { width: 16 });
    expect(out).toContain('width="16"');
    expect(out).toContain('width="5"');
  });

  it('injects class attribute on the root <svg>', () => {
    const out = icon('arrow-right', { class: 'pp-icon pp-icon--lg' });
    expect(out).toContain('class="pp-icon pp-icon--lg"');
    expect(out.indexOf('class=')).toBeLessThan(out.indexOf('viewBox='));
  });

  it('combines width, height and class overrides', () => {
    const out = icon('user', { width: 20, height: 20, class: 'pp-icon' });
    expect(out).toContain('width="20"');
    expect(out).toContain('height="20"');
    expect(out).toContain('class="pp-icon"');
  });

  it('throws helpful error on unknown icon', () => {
    expect(() => icon('nonexistent')).toThrow(/Unknown icon: "nonexistent"/);
    expect(() => icon('nonexistent')).toThrow(/Available:/);
  });
});

describe('listIcons()', () => {
  it('returns an array of strings', () => {
    const names = listIcons();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(16);
    for (const n of names) expect(typeof n).toBe('string');
  });
});
