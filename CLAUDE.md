# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is PerfilaPro

SaaS de tarjetas de perfil digital para profesionales independientes españoles (fontaneros, fisios, profesores, comerciales, etc.). El usuario rellena un formulario, paga con Stripe y recibe una tarjeta en `/c/su-slug` con sus servicios, zona, WhatsApp y código QR.

Dominios: **perfilapro.es** y **perfilapro.com** → alojado en Netlify (rama `main`).

---

## Commands

```bash
npm test          # Run all tests (vitest run)
npm run test:watch  # Watch mode
```

No hay build step — `public/` se sirve tal cual. Netlify usa `npm test` como comando de build.

---

## Architecture

### Stack
- **Frontend**: HTML/CSS/JS estático en `public/index.html` (single-file app, sin bundler)
- **Backend**: Netlify Functions (Node.js, CommonJS) en `netlify/functions/`
- **BD**: Supabase — tabla `cards` con RLS pendiente de activar
- **Pagos**: Stripe Checkout (mode: `payment`, no suscripciones)
- **Deploy**: Netlify, rama `main` = producción

### Flujo de pago
1. `public/index.html` → formulario → POST `/api/create-checkout`
2. `create-checkout.js` crea Stripe Checkout Session con metadata (`slug`, `nombre`, `tagline`, `whatsapp`, `zona`, `servicios` JSON, `foto`, `plan`)
3. Stripe redirige a `stripe.com/checkout` → usuario paga → Stripe llama webhook
4. `stripe-webhook.js` verifica firma → evento `checkout.session.completed` → upsert en Supabase `cards` con `status: 'active'` y `expires_at`
5. Usuario llega a `/c/:slug` → redirect en `netlify.toml` → `card.js` → HTML de tarjeta con QR

### Funciones Netlify
| Función | Ruta pública | Propósito |
|---|---|---|
| `create-checkout.js` | `/api/create-checkout` | Crea Stripe Session |
| `stripe-webhook.js` | `/api/stripe-webhook` | Activa tarjeta tras pago |
| `card.js` | `/c/:slug` | Renderiza HTML de tarjeta |
| `admin-data.js` | `/api/admin-data` | Panel admin (auth por header `x-admin-password`) |

### Planes
- `base`: 9 €, 90 días (`STRIPE_PRICE_BASE`)
- `pro`: 19 €, 365 días (`STRIPE_PRICE_PRO`)
- `renovacion`: 5 €, 365 días (mismo price ID que pro — lógica en webhook)

### Variables de entorno (Netlify)
```
STRIPE_SECRET_KEY
STRIPE_PRICE_BASE
STRIPE_PRICE_PRO
STRIPE_WEBHOOK_SECRET
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_PASSWORD
SITE_URL             # https://perfilapro.es  (usado en success_url y QR)
```

**Importante**: en Netlify las env vars deben tener el mismo valor en **todos** los contextos (`all`, `production`, `branch-deploy`, `deploy-preview`). Valores inconsistentes entre contextos causaron errores de pago anteriores. Usar siempre el endpoint de cuenta al gestionar vars por API: `PATCH /api/v1/accounts/{accountId}/env/{key}`.

### Supabase — tabla `cards`
Campos clave: `slug` (PK única), `nombre`, `tagline`, `whatsapp`, `zona`, `servicios` (array), `foto`, `plan`, `status`, `stripe_session_id`, `expires_at`, `created_at`.

- RLS: **pendiente de activar** — actualmente la `SERVICE_KEY` tiene acceso total
- Demo slug `paco-fontanero-alicante` — tiene lógica especial: no muestra botón WhatsApp real

### `public/index.html`
- Todo el CSS, HTML y JS en un único archivo (~1000 líneas)
- Sección `#crear`: formulario de creación de tarjeta con campos sector, servicios (hasta 5), zona, WhatsApp, nombre, plan
- Sección `#ejemplos`: carrusel horizontal con 4 tarjetas de ejemplo (scroll-snap), dots de navegación
- Fuentes: **Instrument Serif** (display) + **Plus Jakarta Sans** (body)
- Color principal: `--primary: #01696f` (verde azulado)
- El slug se genera en `create-checkout.js` normalizando el nombre (lowercase, sin tildes, sin espacios)

### `public/admin.html`
Panel protegido por contraseña (`ADMIN_PASSWORD`). Acceso en `/admin.html`. Muestra stats y tabla de tarjetas con filtros.

### Tests
Únicamente `stripe-webhook.test.js` — prueba la lógica del webhook con mocks de Stripe y Supabase. `makeHandler` exportado para testabilidad.

Hay un test documentado que **falla intencionalmente** (JSON inválido en `servicios` — bug conocido sin `try/catch` alrededor de `JSON.parse`).

---

## DNS y dominios

- DNS externo en Dondomio (nameservers de Dondomio, no de Netlify)
- `perfilapro.com`: A `@` → `75.2.60.5`, CNAME `www` → `perfilapro.netlify.app`
- `perfilapro.es`: misma config — puede necesitar más tiempo de propagación
- Para SSL: los dominios deben estar añadidos en Netlify Dashboard → Domain settings

## Seguridad pendiente (pre-launch)

1. Activar RLS en Supabase tabla `cards`
2. Añadir banner de consentimiento de cookies (obligatorio en España — RGPD/LSSI)
3. Rotar `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` (expuestos en sesión de chat anterior)
