'use strict';

/**
 * GET /api/analytics-config
 *
 * Devuelve la configuración pública de analitica para que el frontend
 * pueda inicializar PostHog tras consentimiento. La Project API key
 * de PostHog es publica por diseño (frontend la lee del navegador del
 * usuario), no es un secreto.
 *
 * Si POSTHOG_API_KEY no esta definida, devuelve `{posthog: null}` y el
 * frontend hace no-op silencioso (analitica deshabilitada).
 *
 * El handler es puro (sin DI), lee directamente de process.env. Si en
 * el futuro hace falta DI para tests, exportamos makeHandler como en
 * el resto de funciones.
 */

function makeHandler({ getEnv = () => process.env } = {}) {
  return async () => {
    const env = getEnv();
    const key  = env.POSTHOG_API_KEY  || null;
    const host = env.POSTHOG_HOST     || 'https://eu.i.posthog.com';

    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({
        posthog: key ? { key, host } : null,
      }),
    };
  };
}

exports.handler     = makeHandler();
exports.makeHandler = makeHandler;
