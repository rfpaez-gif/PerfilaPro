import { describe, it, expect, afterEach } from 'vitest';
import { isCanteraActive, canteraDisabledResponse } from '../netlify/functions/lib/cantera-flag.js';

const ORIGINAL = process.env.CANTERA_VERTICAL_ACTIVE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CANTERA_VERTICAL_ACTIVE;
  else process.env.CANTERA_VERTICAL_ACTIVE = ORIGINAL;
});

describe('isCanteraActive', () => {
  it('true sólo con el valor exacto "1"', () => {
    process.env.CANTERA_VERTICAL_ACTIVE = '1';
    expect(isCanteraActive()).toBe(true);
  });
  it('false con cualquier otro valor o ausencia', () => {
    for (const v of ['0', 'true', 'yes', '', ' 1', '1 ']) {
      process.env.CANTERA_VERTICAL_ACTIVE = v;
      expect(isCanteraActive()).toBe(false);
    }
    delete process.env.CANTERA_VERTICAL_ACTIVE;
    expect(isCanteraActive()).toBe(false);
  });
});

describe('canteraDisabledResponse', () => {
  it('devuelve 410 con cuerpo JSON', () => {
    const res = canteraDisabledResponse();
    expect(res.statusCode).toBe(410);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(res.body)).toHaveProperty('error');
  });
});
