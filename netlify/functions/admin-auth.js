// Rate limiting por IP para endpoints de admin
// Módulo-level: se resetea en cold start, pero disuade ataques de fuerza bruta sostenidos

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

const failures = new Map();

function checkAdminAuth(event) {
  const ip = (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();

  // Limpiar ventana expirada
  const record = failures.get(ip);
  if (record && now - record.firstAt > WINDOW_MS) {
    failures.delete(ip);
  }

  // Bloquear si supera el límite
  const current = failures.get(ip);
  if (current && current.count >= MAX_FAILURES) {
    return { authorized: false, blocked: true };
  }

  const pwd = event.headers['x-admin-password'];
  if (!pwd || pwd !== process.env.ADMIN_PASSWORD) {
    const rec = failures.get(ip) || { count: 0, firstAt: now };
    if (rec.count === 0) rec.firstAt = now;
    rec.count++;
    failures.set(ip, rec);
    return { authorized: false, blocked: false };
  }

  // Éxito — limpiar fallos previos de esta IP
  failures.delete(ip);
  return { authorized: true, blocked: false };
}

function unauthorizedResponse(blocked) {
  return {
    statusCode: blocked ? 429 : 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: blocked ? 'Demasiados intentos. Espera 15 minutos.' : 'No autorizado' }),
  };
}

module.exports = { checkAdminAuth, unauthorizedResponse };
