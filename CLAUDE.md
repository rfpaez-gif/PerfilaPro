# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests (single pass)
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest@1.6.0 run tests/stripe-webhook.test.js

# Deploy happens automatically via Netlify on push to main
```

> Note: `vitest` is not in PATH — always use `npx vitest@1.6.0 run` directly.

## Architecture

PerfilaPro is a **serverless digital business card platform** deployed on Netlify. It has no build step — `public/` is served as-is and Netlify Functions handle all backend logic.

### Request flow

1. **Landing page** (`public/index.html`) — user fills a form with professional data (name, sector, services, WhatsApp, zone) and selects a plan (Base 90 days / Pro 365 days).
2. **`create-checkout`** — receives the form POST, builds a Stripe Checkout session with all user data packed into `session.metadata` (Stripe metadata values must be strings, so `servicios` is JSON-serialised), and returns the Checkout URL.
3. **Stripe** processes payment and fires a webhook.
4. **`stripe-webhook`** — verifies the Stripe signature, reads metadata from the session, upserts a row in Supabase `cards` table, generates a PDF invoice (non-blocking), and sends a confirmation email via Resend that includes the edit-card link.
5. **`card`** — serves `/c/:slug` routes. Reads the card from Supabase, renders a self-contained HTML page (services list, WhatsApp button, QR code for paid plans), logs the visit, and provides client-side PNG export and vCard download.

### Key design decisions

- **All user data travels through Stripe metadata** — the checkout function serialises `servicios` as a JSON string because Stripe metadata values must be strings.
- **Slug is derived from name** at checkout time (normalised, lowercased, max 40 chars) and is the primary key for cards.
- **`card.js` renders HTML server-side** — no frontend framework, pure template string. The QR code is a base64 data URL generated with the `qrcode` package.
- **Dependency injection for testability** — most functions export `makeHandler(deps)` so tests inject mocks without touching env vars or real clients. Functions that use this pattern: `stripe-webhook`, `admin-actions`, `admin-agents`, `agent-auth`, `agent-data`, `legal-settings`, `edit-card`, `send-edit-link`, `remind-expiry`, `weekly-stats`, `resend-invoice`.
- **Edit tokens** — after payment, users receive a 32-byte hex token (64 chars) via email with a 7-day TTL. `send-edit-link` regenerates tokens on demand with a 10-minute rate limit and always returns HTTP 200 to prevent email enumeration.

### Supabase schema

**`cards` table** — one row per professional card:
- `slug` (PK), `nombre`, `tagline`, `whatsapp`, `zona`, `servicios` (jsonb), `foto_url`, `plan`, `status`, `stripe_session_id`, `expires_at`, `email`, `phone`, `refund_reason`, `refunded_at`
- Edit flow extra fields: `edit_token`, `edit_token_expires_at`, `edit_link_sent_at`, `reminder_30_sent`, `reminder_15_sent`, `reminder_7_sent`

**`settings` table** — key/value store for site config:
- `key` (PK), `value`
- Used for legal identity data: `legal_name`, `legal_nif`, `legal_address`, `legal_email`

**`facturas` table** — invoice records:
- `id`, `numero` (e.g. `FAC-2024-0001`), `slug`, `pdf_base64`, `created_at`
- Numbers auto-increment per year via `getNextInvoiceNumber()`

**`agents` table** — sales agent accounts:
- `id`, `code`, `name`, `email`, `password_hash`, `commission_rate`, `parent_agent_id`, `nif`, `address`, `business_name`, `created_at`

**`agent_liquidations` table** — commission payment records:
- `id`, `agent_id`, `period` (YYYY-MM), `paid_at`

**`visits` table** — card view log (non-blocking inserts):
- `id`, `slug`, `visited_at`

### Admin panel (`public/admin.html`)

Protected by `ADMIN_PASSWORD` env var sent as `x-admin-password` header. Optionally enforces TOTP 2FA via `ADMIN_TOTP_SECRET` (RFC 6238, ±1 step clock-skew tolerance). Rate-limited to 10 failed auth attempts per 15-minute window per IP before returning 429.

Calls:
- `admin-data` (GET) — stats + full card list ordered by `created_at` desc
- `admin-actions` (POST) — `reactivate`, `extend`, `refund` actions per card
- `legal-settings` (GET/POST) — read/write legal identity data
- `admin-invoices` (GET) — list invoices or download a PDF by number
- `resend-invoice` (POST) — re-send invoice PDF to card's email
- `admin-agents` (GET/POST) — manage agent accounts and liquidations

### Agent portal (`public/agente.html`, `public/agente-login.html`)

Agents log in with email + password; `agent-auth` returns a JWT (7-day TTL, HS256). Subsequent calls send `Authorization: Bearer <token>`.

`agent-data` returns the agent profile plus a monthly commission breakdown — distinguishing own sales from sub-agent sales, applying a fixed 5% L2-on-L1 override rate.

### Card editing (`public/editar.html`)

Users land here from the edit link in their confirmation or reminder emails. The page calls:
- `edit-card` GET — returns sanitised card data (strips token fields)
- `edit-card` POST — updates allowed fields after sanitisation (`stripTags`, phone/email cleaning)
- `upload-avatar` POST — accepts base64 PNG/JPG ≤2 MB, stores in Supabase `Avatars` bucket, returns public URL. Only Supabase storage URLs are accepted for `foto_url`.

### Scheduled functions

| Function | Schedule | Purpose |
|---|---|---|
| `remind-expiry` | Daily at 09:00 | Sends expiry reminder emails at 30, 15, and 7 days before expiry. Marks `reminder_X_sent` to prevent duplicates. |
| `weekly-stats` | Mondays at 09:00 | Sends Pro-plan cards a visit count summary (7-day + 30-day). Adaptive message based on traffic volume. |

### Legal pages

`public/terminos.html`, `public/privacidad.html`, `public/legal.html` load owner identity data at runtime via `public/js/legal-data.js`, which fetches `/.netlify/functions/legal-settings` and fills `[data-legal="name|nif|address|email"]` attributes.

### Invoice generation

`invoice-utils.js` is a shared utility (not a Netlify Function). It exports:
- `buildPDF(card, invoiceRecord)` — generates a PDFKit buffer with 21% IVA, issuer info (hardcoded), and auto-incremented number `FAC-{year}-{count}`.
- `calcIva(amount)`, `roundTwo(n)`, `getNextInvoiceNumber(db, year)`, `PLAN_INFO`.

PDF generation is triggered non-blocking from `stripe-webhook` after card upsert. `resend-invoice` can regenerate and resend at any time.

### Environment variables required

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASE
STRIPE_PRICE_PRO
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_PASSWORD
ADMIN_TOTP_SECRET     # optional — enables TOTP 2FA for admin panel
RESEND_API_KEY
SITE_URL              # e.g. https://perfilapro.es
AGENT_JWT_SECRET      # signs agent JWT tokens
```

### URL routing (netlify.toml)

| Public path | Netlify Function |
|---|---|
| `/c/:slug` | `card` |
| `/api/create-checkout` | `create-checkout` |
| `/api/stripe-webhook` | `stripe-webhook` |
| `/api/admin-data` | `admin-data` |
| `/api/admin-actions` | `admin-actions` |
| `/api/admin-invoices` | `admin-invoices` |
| `/api/admin-agents` | `admin-agents` |
| `/api/legal-settings` | `legal-settings` |
| `/api/card-status` | `card-status` |
| `/api/edit-card` | `edit-card` |
| `/api/send-edit-link` | `send-edit-link` |
| `/api/upload-avatar` | `upload-avatar` |
| `/api/agent-auth` | `agent-auth` |
| `/api/agent-data` | `agent-data` |
| `/api/resend-invoice` | `resend-invoice` |

### Testing conventions

- All tests live in `tests/` and use Vitest.
- `tests/setup.js` sets mock env vars so modules that initialise clients at import time don't throw.
- Tests use the `makeHandler(deps)` pattern — never call the real `handler` export in unit tests.
- Mock the `db` object as `{ from: () => ({ select, upsert, update, eq, single, ... }) }` chain.
- Mock `emailClient` as `{ emails: { send: vi.fn() } }`.
- Mock `stripe` with only the methods each test needs.
- Use `vi.setSystemTime()` when testing time-sensitive logic (TOTP windows, token expiry, scheduled reminders).

### Security features

- **TOTP 2FA** — RFC 6238 (HMAC-SHA1, 30s window, ±1 step). Implemented in `admin-auth.js` without external libraries; base32 decoded inline.
- **IP rate limiting** — in-memory map; 10 auth failures per 15 min triggers 429.
- **Edit token TTL** — 32-byte hex (crypto.randomBytes), 7-day expiry stored in `cards`.
- **Email enumeration prevention** — `send-edit-link` always returns 200.
- **Field allowlisting** — `legal-settings` and `edit-card` ignore unknown fields; `edit-card` additionally strips HTML tags and validates phone/email format.
- **Avatar URL whitelist** — `edit-card` only accepts `foto_url` values that start with the configured Supabase storage URL.
- **XSS prevention** — `card.js` escapes all user content via `esc()` before rendering HTML; `stripTags()` sanitises inputs on write.

## Pending work (rama `claude/resume-seed-generation-CWNDw`)

### 1. Renovación de imágenes seed desde Admin — Fase 1 (por tarjeta)
- **Refactor**: extraer la lógica de generación de `scripts/generate-seeds.js` a `netlify/functions/lib/seed-generator.js`. Debe exportar:
  - `generateImage(prompt, opts)` — con backoff exponencial (ya implementado en el script).
  - `regenerateSeedCard(db, slug)` — localiza el arquetipo, regenera la imagen, sube a Storage con cache-bust (path `seeds/<slug>-<timestamp>.jpg` o `?v=ts` en `foto_url`), actualiza `cards.foto_url`.
- **Endpoint síncrono** `netlify/functions/admin-regenerate-seed.js` (POST `{ slug }`) protegido por `x-admin-password`. Devuelve `{ foto_url }`. Patrón `makeHandler(deps)`.
- **Redirect** en `netlify.toml`: `/api/admin-regenerate-seed` → función.
- **UI** en `public/admin.html`: botón ↻ por fila de seed, spinner durante la llamada, swap de `<img>` cuando vuelve la respuesta.
- **Tests** en `tests/admin-regenerate-seed.test.js`: éxito, slug inexistente, fallo de generación, auth fallida.

### 2. Renovación masiva de seeds — Fase 2 (background)
- **Netlify Background Function** `admin-regenerate-seeds-background.js` (15 min timeout, fire-and-forget) con filtros: `{ sector, missing_photo, all }`.
- **Tracking de estado**: añadir columna `regen_status` (`pending`/`running`/`done`/`failed`) y `regen_started_at` a `cards`, o usar Netlify Blobs.
- **UI** en admin: botón "Regenerar todas las semillas" + indicador de progreso (consulta periódica de `regen_status`).
- **No programar cron**: la renovación se dispara siempre manualmente.

### 3. Diversidad — refactor de arquetipos  ✅ COMPLETADO
Hecho en commits `85da94d` (bloque 1), `f9b994c` (bloque 2), `d42182c`
(bloque 3) y `ef96106` (bloque 4). Histórico de decisiones y running
totals en `scripts/archetypes-progress.md`. Resumen:

- Las 75 entradas de `scripts/archetypes.json` reescritas con acento
  demográfico. Cuotas finales cuadran exactamente con el target
  (52/10/6/3/2/2 origen, 15/34/19/7 edad, 37F/38M).
- 9 disonancias estratégicas, 11 cambios de nombre, 3 roles
  neutralizados (Albañil→Albañilería, Peluquera→Peluquería,
  Técnico→Técnica emergencias).
- `scripts/generate-seeds.js` migrado de Pollinations a
  `gemini-2.5-flash-image` con recompresión a JPEG ~85 vía `sharp`
  (añadida a `devDependencies`). Backoff de 6 reintentos y checkpoint
  preservados.
- **Acción manual pendiente del usuario antes de ejecutar el script**:
  borrar `Avatars/seeds/*` en Supabase Storage y
  `DELETE FROM cards WHERE is_seed=true;`. Después: `node scripts/generate-seeds.js`.

### 4. Otros pendientes del kickoff
- Tras la limpieza manual, ejecutar `node scripts/generate-seeds.js`
  (checkpoint y backoff ya integrados, retoma solo si se corta).
- Construir búsqueda Petri en home (`¿Qué necesitas?`).
- Combobox de especialidad con sugerencias locales en `alta.html` y `editar.html`.

