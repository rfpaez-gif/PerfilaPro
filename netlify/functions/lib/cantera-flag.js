'use strict';

// Gate runtime del carril Cantera (vertical deporte base).
//
// Todo endpoint del carril (register-player, request-transfer, cobros,
// carnet, etc.) llama a isCanteraActive() al entrar y, si está off,
// devuelve canteraDisabledResponse() — 410 Gone. Esto permite tener el
// código desplegado en producción pero dormido hasta que el founder
// encienda la env var.
//
// Patrón idéntico a LAUNCH_PROMO_ACTIVE / DEMO_FUNNEL_FREE_ACTIVE:
// sólo el valor exacto '1' enciende; cualquier otra cosa (vacío,
// '0', 'true', undefined) lo deja apagado.

function isCanteraActive() {
  return process.env.CANTERA_VERTICAL_ACTIVE === '1';
}

// Respuesta 410 estándar cuando el carril está apagado. Plain object
// (no depende del helper jsonResponse local de cada función), mismo
// estilo que panel-auth.unauthorizedResponse().
function canteraDisabledResponse() {
  return {
    statusCode: 410,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Funcionalidad no disponible' }),
  };
}

module.exports = {
  isCanteraActive,
  canteraDisabledResponse,
};
