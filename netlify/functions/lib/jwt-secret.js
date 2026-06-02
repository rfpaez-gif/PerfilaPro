'use strict';

// Resuelve un secreto para firmar/verificar JWT a partir de la primera env
// var disponible de la lista de candidatos. Si NINGUNA está configurada,
// lanza un error en lugar de degradar a un secreto público conocido.
//
// Motivación (auditoría de lanzamiento · S1): el patrón previo
// `process.env.X || 'changeme'` significaba que, si la env var no estaba
// configurada en producción, los JWT (agente, panel B2B, panel del tutor de
// un menor, sesión admin) se firmaban con un secreto público → cualquiera
// podía forjar tokens y suplantar identidades. Fallar de forma ruidosa
// (fail-closed) es preferible a operar con seguridad rota silenciosamente.
//
// En tests, `tests/setup.js` fija `AGENT_JWT_SECRET`, que es el último
// fallback de todas las cadenas, así que la resolución nunca lanza ahí.
function resolveJwtSecret(label, ...envNames) {
  for (const name of envNames) {
    const v = process.env[name];
    if (v && v.trim()) return v;
  }
  throw new Error(
    `${label}: no hay secreto JWT configurado (probadas: ${envNames.join(', ')}). ` +
    'Configura al menos una de esas env vars antes de firmar o verificar tokens.'
  );
}

module.exports = { resolveJwtSecret };
