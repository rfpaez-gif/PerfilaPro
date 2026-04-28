import { getStore } from "@netlify/blobs";

const MAX_ATTEMPTS = 10;
const WINDOW_SECS  = 900; // 15 min

export default async function handler(request, context) {
  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";

  const store = getStore("rate-limits");
  const key   = `rl:${ip}`;

  let record = { count: 0 };
  try {
    record = (await store.get(key, { type: "json" })) || { count: 0 };
  } catch {
    // Blobs no disponible — fail open para no bloquear peticiones legítimas
  }

  if (record.count >= MAX_ATTEMPTS) {
    return new Response(
      JSON.stringify({ error: "Demasiados intentos. Espera 15 minutos." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(WINDOW_SECS),
        },
      }
    );
  }

  const response = await context.next();

  try {
    if (response.status === 401) {
      await store.set(key, { count: record.count + 1 }, { ttl: WINDOW_SECS });
    } else if (response.status === 200 && record.count > 0) {
      await store.delete(key);
    }
  } catch (err) {
    console.error("rate-limiter write error:", err.message);
  }

  return response;
}
