// Rate limiter en memoria, request-counted, con bucket por endpoint.
//
// Trade-off conocido: el Map vive en el proceso de cada Lambda warmer,
// así que el límite es best-effort por instancia. En Netlify Functions el
// fan-out es bajo (suelen ser 1-3 instancias), suficiente para frenar
// abuso scriptado. Para garantías duras hace falta Redis / Upstash.
//
// Mismo trade-off que ya acepta admin-auth.js para el conteo de fallos.

const buckets = new Map();

function getIp(event) {
  const fwd = event.headers && (event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For']);
  return (fwd || '').split(',')[0].trim() || 'unknown';
}

function checkRateLimit(event, opts) {
  const { bucket, limit, windowMs, key } = opts;
  if (!bucket || !limit || !windowMs) {
    throw new Error('checkRateLimit: bucket, limit y windowMs son obligatorios');
  }

  const id  = key || getIp(event);
  const now = Date.now();

  let map = buckets.get(bucket);
  if (!map) {
    map = new Map();
    buckets.set(bucket, map);
  }

  const rec = map.get(id);
  if (rec && now - rec.firstAt > windowMs) {
    map.delete(id);
  }

  const cur = map.get(id);
  if (cur && cur.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((cur.firstAt + windowMs - now) / 1000));
    return { limited: true, retryAfter };
  }

  const next = cur || { count: 0, firstAt: now };
  next.count++;
  map.set(id, next);
  return { limited: false };
}

function rateLimitResponse(retryAfter) {
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After':  String(retryAfter),
    },
    body: JSON.stringify({
      error: 'Demasiadas peticiones. Inténtalo más tarde.',
    }),
  };
}

// Solo para tests: limpia todos los buckets.
function _resetRateLimit() {
  buckets.clear();
}

module.exports = { checkRateLimit, rateLimitResponse, getIp, _resetRateLimit };
