import { describe, it, expect } from 'vitest';
import { makeHandler } from '../netlify/functions/analytics-config.js';

describe('analytics-config handler', () => {
  it('devuelve posthog null si POSTHOG_API_KEY no esta definida', async () => {
    const handler = makeHandler({ getEnv: () => ({}) });
    const res = await handler({});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ posthog: null });
  });

  it('devuelve key + host por defecto cuando POSTHOG_API_KEY existe', async () => {
    const handler = makeHandler({ getEnv: () => ({ POSTHOG_API_KEY: 'phc_xyz' }) });
    const res = await handler({});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      posthog: { key: 'phc_xyz', host: 'https://eu.i.posthog.com' },
    });
  });

  it('respeta POSTHOG_HOST custom cuando se define', async () => {
    const handler = makeHandler({ getEnv: () => ({
      POSTHOG_API_KEY: 'phc_xyz',
      POSTHOG_HOST:    'https://us.i.posthog.com',
    }) });
    const res = await handler({});
    expect(JSON.parse(res.body).posthog.host).toBe('https://us.i.posthog.com');
  });

  it('expone Cache-Control para 5 minutos', async () => {
    const handler = makeHandler({ getEnv: () => ({}) });
    const res = await handler({});
    expect(res.headers['Cache-Control']).toContain('max-age=300');
  });
});
