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

1. **Landing page** (`public/index.html`) — user fills a form with their professional data (name, sector, services, WhatsApp, zone) and selects a plan (Base 90 days / Pro 365 days).
2. **`create-checkout`** — receives the form POST, builds a Stripe Checkout session with all user data packed into `session.metadata` (since Stripe can't store arbitrary data elsewhere), and returns the Checkout URL.
3. **Stripe** processes payment and fires a webhook.
4. **`stripe-webhook`** — verifies the Stripe signature, reads metadata from the session, upserts a row in Supabase `cards` table, and sends a confirmation email via Resend.
5. **`card`** — serves `/c/:slug` routes. Reads the card from Supabase and renders a self-contained HTML page with services, WhatsApp button, and QR code (paid plans only).

### Key design decisions

- **All user data travels through Stripe metadata** — the checkout function serialises `servicios` as JSON string because Stripe metadata values must be strings.
- **Slug is derived from name** at checkout time (normalised, lowercased, max 40 chars) and is the primary key for cards.
- **`card.js` renders HTML server-side** — no frontend framework, pure template string. The QR code is generated as a base64 data URL using the `qrcode` package.
- **Dependency injection for testability** — `stripe-webhook`, `admin-actions`, and `legal-settings` all export `makeHandler(deps)` so tests can inject mocks without touching env vars or real clients.

### Supabase schema

**`cards` table** — one row per professional card:
- `slug` (PK), `nombre`, `tagline`, `whatsapp`, `zona`, `servicios` (jsonb), `foto`, `plan`, `status`, `stripe_session_id`, `expires_at`, `email`, `phone`, `refund_reason`, `refunded_at`

**`settings` table** — key/value store for site config:
- `key` (PK), `value`
- Used for legal identity data: `legal_name`, `legal_nif`, `legal_address`, `legal_email`

### Admin panel (`public/admin.html`)

Protected by `ADMIN_PASSWORD` env var sent as `x-admin-password` header. Calls:
- `admin-data` (GET) — stats + full card list
- `admin-actions` (POST) — `reactivate`, `extend`, `refund` actions per card
- `legal-settings` (GET/POST) — read/write legal identity data

### Legal pages

`public/terminos.html`, `public/privacidad.html`, `public/legal.html` load owner identity data at runtime via `public/js/legal-data.js`, which fetches `/.netlify/functions/legal-settings` and fills `[data-legal="name|nif|address|email"]` attributes.

### Environment variables required

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASE
STRIPE_PRICE_PRO
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_PASSWORD
RESEND_API_KEY
SITE_URL          # e.g. https://perfilapro.es
```

### URL routing (netlify.toml)

- `/c/:slug` → `card` function
- `/api/create-checkout` → `create-checkout` function
- `/api/stripe-webhook` → `stripe-webhook` function
- `/api/admin-data` → `admin-data` function
