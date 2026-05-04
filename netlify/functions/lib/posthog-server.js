'use strict';

/**
 * Cliente PostHog mini para uso server-side desde Netlify Functions.
 *
 * No-op silencioso si POSTHOG_API_KEY no esta definida (entornos
 * preview o local sin analitica). No bloquea la funcion que lo
 * invoca: el fetch se hace fire-and-forget y los errores se
 * loguean pero no se relanzan.
 *
 * Uso:
 *   const { capture } = require('./lib/posthog-server');
 *   capture('user-slug', 'signup_completed_paid', { plan: 'pro' });
 *
 * No usamos el SDK posthog-node oficial para evitar anadir
 * dependencia npm a un repo sin build step.
 */

const HOST = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
const KEY  = process.env.POSTHOG_API_KEY;

/**
 * Captura un evento server-side.
 *
 * @param {string} distinctId    identificador del usuario (slug, email, etc.)
 * @param {string} event         nombre del evento (snake_case)
 * @param {Object} [properties]  propiedades adicionales del evento
 * @returns {Promise<void>}      no lanza excepciones
 */
async function capture(distinctId, event, properties = {}) {
  if (!KEY) return; // analitica deshabilitada
  if (!distinctId || !event) return;

  const body = JSON.stringify({
    api_key:     KEY,
    event,
    distinct_id: String(distinctId),
    properties:  { ...properties, $lib: 'pp-netlify-fn' },
    timestamp:   new Date().toISOString(),
  });

  try {
    const res = await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`posthog capture ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('posthog capture error:', err.message);
  }
}

module.exports = { capture };
