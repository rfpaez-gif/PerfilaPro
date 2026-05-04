import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('posthog-server capture', () => {
  let originalFetch;
  let originalKey;
  let originalHost;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalKey   = process.env.POSTHOG_API_KEY;
    originalHost  = process.env.POSTHOG_HOST;
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined)  delete process.env.POSTHOG_API_KEY;
    else                            process.env.POSTHOG_API_KEY = originalKey;
    if (originalHost === undefined) delete process.env.POSTHOG_HOST;
    else                            process.env.POSTHOG_HOST = originalHost;
  });

  it('no llama a fetch si POSTHOG_API_KEY no esta definida', async () => {
    delete process.env.POSTHOG_API_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const { capture } = await import('../netlify/functions/lib/posthog-server.js');
    await capture('user-1', 'test_event', { foo: 'bar' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no llama a fetch si falta distinctId o event', async () => {
    process.env.POSTHOG_API_KEY = 'phc_xyz';
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const { capture } = await import('../netlify/functions/lib/posthog-server.js');
    await capture('', 'test_event');
    await capture('user-1', '');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hace POST al endpoint /capture/ con payload correcto', async () => {
    process.env.POSTHOG_API_KEY = 'phc_xyz';
    process.env.POSTHOG_HOST    = 'https://eu.i.posthog.com';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchSpy;
    const { capture } = await import('../netlify/functions/lib/posthog-server.js');
    await capture('ana-electricista', 'signup_completed_paid', { plan: 'pro' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/capture/');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.api_key).toBe('phc_xyz');
    expect(body.event).toBe('signup_completed_paid');
    expect(body.distinct_id).toBe('ana-electricista');
    expect(body.properties.plan).toBe('pro');
    expect(body.properties.$lib).toBe('pp-netlify-fn');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('no relanza errores de red (silencioso)', async () => {
    process.env.POSTHOG_API_KEY = 'phc_xyz';
    global.fetch = vi.fn().mockRejectedValue(new Error('network fail'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { capture } = await import('../netlify/functions/lib/posthog-server.js');
    await expect(capture('u1', 'evt')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
