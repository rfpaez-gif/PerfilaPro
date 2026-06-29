'use strict';

// Gate runtime del vertical INMO (rastreo de subastas inmobiliarias).
//
// Todo endpoint del carril (inmo-scrape-subastas, subasta, inmo-list)
// llama a isInmoActive() al entrar y, si está off, no responde / no
// corre. Permite tener el código desplegado en producción pero dormido
// hasta encender la env var.
//
// Mismo patrón que CANTERA_VERTICAL_ACTIVE / LAUNCH_PROMO_ACTIVE: sólo
// el valor exacto '1' enciende; cualquier otra cosa lo deja apagado.

function isInmoActive() {
  return process.env.INMO_VERTICAL_ACTIVE === '1';
}

function inmoDisabledResponse() {
  return {
    statusCode: 410,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Funcionalidad no disponible' }),
  };
}

module.exports = { isInmoActive, inmoDisabledResponse };
