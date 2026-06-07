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
4. **`stripe-webhook`** — verifies the Stripe signature, reads metadata from the session, upserts a row in Supabase `cards` table, generates the printable card PDF + QR PNG + invoice PDF (all non-blocking), and sends a confirmation email via Resend with the three assets attached and the kit re-download links embedded.
5. **`card`** — serves `/c/:slug` routes. Reads the card from Supabase, renders a self-contained HTML page (services list, WhatsApp button, QR code for paid plans), logs the visit, and provides client-side PNG export and vCard download.

### Key design decisions

- **All user data travels through Stripe metadata** — the checkout function serialises `servicios` as a JSON string because Stripe metadata values must be strings.
- **Slug is derived from name** at checkout time (normalised, lowercased, max 40 chars) and is the primary key for cards.
- **`card.js` renders HTML server-side** — no frontend framework, pure template string. The QR code is a base64 data URL generated with the `qrcode` package.
- **Dependency injection for testability** — most functions export `makeHandler(deps)` so tests inject mocks without touching env vars or real clients. Functions that use this pattern: `stripe-webhook`, `admin-actions`, `admin-agents`, `agent-auth`, `agent-data`, `legal-settings`, `edit-card`, `send-edit-link`, `remind-expiry`, `weekly-stats`, `resend-invoice`, `export-data`, `delete-account`, `download-card`, `download-qr`.
- **Edit tokens** — after payment, users receive a 32-byte hex token (64 chars) via email with a 7-day TTL. `send-edit-link` regenerates tokens on demand with a 10-minute rate limit and always returns HTTP 200 to prevent email enumeration.

### Supabase schema

**`cards` table** — one row per professional card:
- `slug` (PK), `nombre`, `tagline`, `whatsapp`, `zona`, `servicios` (jsonb), `foto_url`, `plan`, `status`, `stripe_session_id`, `expires_at`, `email`, `phone`, `refund_reason`, `refunded_at`
- Edit flow extra fields: `edit_token`, `edit_token_expires_at`, `edit_link_sent_at`, `reminder_30_sent`, `reminder_15_sent`, `reminder_7_sent`
- Soft-delete + B2B defensive fields (Sprint 1, migration 007): `deleted_at`, `organization_id` (FK → `organizations.id`, NULL until phase 3 lands).
- Kit tracking (migration 011): `kit_email_sent_at` — timestamp del último envío del welcome email post-pago con tarjeta + QR + factura. Lo setea `stripe-webhook` en el envío inicial; lo refresca `resend-kit` cuando un admin reenvía desde el panel.
- Dirección física + visibilidad (migración 015 + `direccion` desde 003): `direccion` (text, nullable) y `local_publico` (boolean, default false). El render público en `/c/:slug` solo muestra la dirección + link a Google Maps cuando **ambos** están activos — un autónomo a domicilio queda con `local_publico=false` por defecto y nunca expone su casa aunque rellene el campo. El toggle vive en alta.html (Step 3) y editar.html. Backend fuerza `local_publico=false` si la dirección viene vacía o solo whitespace.

**`organizations` table** — usado por la página B2B demo `/e/:slug` (migración 019). Empty hasta que se crea la primera org desde admin:
- `id` (PK), `name`, `nif`, `email`, `created_at`, `deleted_at` (originales de migración 007)
- Branding (migración 019): `slug` text UNIQUE (índice parcial donde `slug IS NOT NULL AND deleted_at IS NULL`), `logo_url` text (whitelist Supabase storage en backend), `color_primary` text con CHECK `^#[0-9a-fA-F]{6}$`, `tagline` text (máx 140 chars, lo limita el backend).
- Contacto físico para tarjeta de visita B2B (migración 023): `address` text (máx 200, sanitizado en backend), `phone` text (máx 40). Sin CHECK a nivel DB. Sirven de **fallback** para la tarjeta de visita 85×55mm del miembro cuando éste no rellena su propia `cards.direccion` — caso típico: despacho con sede única que reparte tarjetas a 20 empleados con la misma dirección.
- Bloque "Acerca de" en `/e/:slug` (migración 026): `description` text (máx 500, sanitizado en backend) y `website` text (validado con `new URL()`, solo http(s), máx 200). Se renderizan en `<section class="pp-org-about">` entre el hero y el grid de profesionales — párrafo de description sobre fondo claro y lista de contactos con iconos (📞 ✉ 🌐 📍) que combina `phone`, `email`, `website` y `address`. El bloque entero se omite si los cinco campos están vacíos: orgs que no rellenen nada extra ven `/e/:slug` exactamente igual que antes. `email` (existente desde 007) queda editable desde el form del Studio (antes solo SQL directo). El campo `slug` se bloquea como read-only al editar para no romper URLs ya repartidas (emails de invite, QR impresos, enlaces externos).
- Panel privado de estadísticas (migración 027): `stats_token` text (32-byte hex / 64 chars) + `stats_token_expires_at` timestamptz, con unique partial index sobre `stats_token` cuando no es NULL. Token generado/refrescado por admin-orgs `org_get_stats_link` (TTL 90 días), expuesto en `/e/:slug/stats?token=…`. Sin tocar el resto del flujo público.

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
- `resend-kit` (POST) — re-send the full post-payment email (welcome + tarjeta PDF + QR PNG + factura). Updates `cards.kit_email_sent_at`. Same auth as `resend-invoice` (password + TOTP). Visible in the cards table as "📦 Kit" button with a tooltip showing how long ago the last kit was sent.
- `admin-agents` (GET/POST) — manage agent accounts and liquidations

### Agent portal (`public/agente.html`, `public/agente-login.html`)

Agents log in with email + password; `agent-auth` returns a JWT (7-day TTL, HS256). Subsequent calls send `Authorization: Bearer <token>`.

`agent-data` returns the agent profile plus a monthly commission breakdown — distinguishing own sales from sub-agent sales, applying a fixed 5% L2-on-L1 override rate.

**Tabs Autónomos / B2B** (Bloque D · UI agente): el portal organiza la información en dos pestañas con el mismo chrome (topbar + liquidaciones compartidas al pie):

- **Autónomos** — enlace de referido tradicional (`${siteUrl}/?ref=${code}`) + KPIs (tarjetas vendidas, ventas red, comisión pendiente combinada cards+B2B) + resumen mensual filtrado a periodos con cards + tabla últimas tarjetas. Misma información que mostraba el portal pre-Bloque D, sólo recolocada.
- **B2B** — dos enlaces de captación con copy-to-clipboard (`${siteUrl}/es/empresas?via=${code}` + `${siteUrl}/ca/empresas?via=${code}`) que el agente comparte con organizaciones + KPIs B2B (orgs activas, MRR estimado dividiendo annual÷12, número de facturas recientes) + resumen mensual filtrado a periodos con facturas B2B + tabla de orgs (nombre · plan tier·cycle · seats · status · renueva) + tabla últimas facturas (paid_at · org_id · tier·cycle · seats · importe).

Los counts en las pestañas (`Autónomos N` / `B2B M`) reflejan `summary.total_sales` y `summary.org_count` para que un agente con sólo un carril sepa de un vistazo dónde tiene cartera. La tabla de liquidaciones queda **fuera de tabs** porque agrega ambos carriles en `commission_amount`.

**Atribución comercial B2B** (Bloque D · captura `?via=`): cuando un agente comparte `/es/empresas?via=agent-XXX` con una organización, el landing JS (en ambos idiomas) valida con `/^[A-Za-z0-9_-]{2,40}$/`, persiste el código en `localStorage.pp_b2b_via` (sobrevive a navegaciones posteriores sin query param) y lo inyecta como `<input type="hidden" name="via">` en el form del lead. `lead-b2b.js` acepta `body.via` o el alias `body.agent_code`, lo persiste en `b2b_leads.agent_code` (migración 030, columna nullable + índice parcial sobre pendientes) y lo añade a la fila *"Referido por"* del email interno al inbox. El Studio (`admin-orgs.html`) pinta un pill verde con el código en la fila del lead. Atribuciones malformadas se silencian (200 sin attribution) — un share link forjado no debe bloquear un lead legítimo. **Carry-over automático (Phase 2 · Bloque D)**: cuando el founder asocia un lead a una org desde el Studio (acción `leads_assign`), si el lead trae `agent_code` y la org **aún no tiene atribución**, el backend copia el código a `organizations.agent_code` sin que el founder lo teclee — cerrando la cadena `b2b_leads.agent_code → organizations.agent_code → org_invoices.agent_code → agent-data.org_commission`. No pisa una atribución existente (p.ej. la que fijó `?via=` en el checkout Stripe) y es best-effort (si el UPDATE de la org falla, la asociación del lead ya quedó hecha). El toast del Studio confirma el carry-over (`agent_code_carried`). El snapshot histórico a `org_invoices.agent_code` lo sigue haciendo el webhook `invoice.paid` leyendo el estado actual de la org.

### Card editing (`public/editar.html`)

Users land here from the edit link in their confirmation or reminder emails. The page calls:
- `edit-card` GET — returns sanitised card data (strips token fields)
- `edit-card` POST — updates allowed fields after sanitisation (`stripTags`, phone/email cleaning)
- `upload-avatar` POST — accepts base64 PNG/JPG ≤2 MB, stores in Supabase `Avatars` bucket, returns public URL. Only Supabase storage URLs are accepted for `foto_url`.

**Hook B2B post-completación** (`lib/team-kit.js`): cuando un miembro B2B (card con `organization_id` + `plan='b2b'`) hace su PRIMER POST a `edit-card` (gated por `cards.kit_email_sent_at IS NULL`), `edit-card` dispara `sendTeamKit` después del UPDATE. Genera la tarjeta de visita 85×55mm con los datos reales del miembro (foto + WhatsApp ya rellenados), la adjunta al email y envía el welcome kit B2B con branding de la org (logo + `color_primary` + nombre bajo "Equipo de"). Paralelo al kit post-pago autónomo (`stripe-webhook → buildEmail()`) pero recortado: **sin factura adjunta** (paga la org, no el miembro), **sin QR PNG suelto** (el QR ya va en la tarjeta), **sin sección "plan / activa hasta"** (el miembro no tiene plan propio). Marca `cards.kit_email_sent_at` en éxito para no re-enviar en saves posteriores. Si el send falla, queda NULL y el admin puede reenviar desde el panel. Email sólo se dispara después de update exitoso del carril B2B locked (que ya exige WhatsApp obligatorio), así que la tarjeta nunca sale con datos a medias.

### GDPR endpoints

Both endpoints reuse the same `edit_token` mechanism as `edit-card` (32-byte hex, 7-day TTL), so the user only needs the link in their confirmation/reminder email to exercise their rights.

- `export-data` GET (`/api/export-data?slug=&token=`) — returns a JSON download (`Content-Disposition: attachment`) with the full card record (minus `edit_token*` fields), all `visits` rows for that slug, and all `facturas` metadata (number + date, no PDF binary).
- `delete-account` POST (`/api/delete-account` with `{slug, token}`) — hard-deletes `visits`, then `facturas`, then the `cards` row, in that order. Returns `{ok: true}` on success or `500` on the first failing step (no partial state moves forward).

### Scheduled functions

| Function | Schedule | Purpose |
|---|---|---|
| `remind-expiry` | Daily at 09:00 | Sends expiry reminder emails at 30, 15, and 7 days before expiry. Marks `reminder_X_sent` to prevent duplicates. |
| `weekly-stats` | Mondays at 09:00 | Sends Pro-plan cards a visit count summary (7-day + 30-day). Adaptive message based on traffic volume. |
| `charge-due-enrollment-concepts` | Daily at 06:00 | CANTERA · cobra los `enrollment_charges` `scheduled` vencidos con mandato guardado (PaymentIntent off-session en la cuenta Connect del club, con application_fee). Idempotente por `idempotencyKey` por cargo. Gateado por `CANTERA_VERTICAL_ACTIVE`. |

### Legal pages

`public/terminos.html`, `public/privacidad.html`, `public/legal.html` load owner identity data at runtime via `public/js/legal-data.js`, which fetches `/.netlify/functions/legal-settings` and fills `[data-legal="name|nif|address|email"]` attributes.

### Invoice generation

`invoice-utils.js` is a shared utility (not a Netlify Function). It exports:
- `buildPDF(card, invoiceRecord)` — generates a PDFKit buffer with 21% IVA, issuer info (hardcoded), and auto-incremented number `FAC-{year}-{count}`.
- `calcIva(amount)`, `roundTwo(n)`, `getNextInvoiceNumber(db, year)`, `PLAN_INFO`.

PDF generation is triggered non-blocking from `stripe-webhook` after card upsert. `resend-invoice` can regenerate and resend at any time.

**Limitation**: PDFs generated here are NOT sent to AEAT (Verifactu). Valid for the demo phase; for live commercial operation, every invoice must be transmitted to the Spanish tax authority via a registered provider (Quipu / Holded / FacturaDirecta).

### Printable kit (post-payment delivery)

`printable-card-utils.js` is a shared utility (not a Netlify Function) that materialises the digital product into tangible assets. Triggered non-blocking from `stripe-webhook` after card upsert; both files are attached to the post-payment email AND linked as direct re-downloads.

Exports:
- `buildPrintableCardPDF({ nombre, tagline, whatsapp, slug, cardUrl })` — A6 vertical PDF (105×148mm), no photo, with a prominent QR + identity (name, tagline, WhatsApp, URL). Helvetica only (no font loading). The PDF is vector + embedded high-res QR PNG, so it scales cleanly: print as-is for pocket size, ×2 for A5 wall poster, ×0.5 for ~A7 hand-out.
- `buildBusinessCardPDF({ card, org, logoBuffer, siteUrl })` — variante B2B formal en formato tarjeta de visita ISO 7810 (85×55mm horizontal). Franja superior con `color_primary` + logo + nombre de la org; cuerpo con nombre del miembro en serif grande + cargo + 3 líneas de contacto (☎ ✉ 📍); QR auxiliar de ~14mm en la esquina (no protagonista). Single-side, listo para mandar a cualquier imprenta digital. La dirección cae a `org.address` si la card no tiene `direccion` propia (fallback equipo distribuido vs sede única).
- `buildBusinessCardsBookletPDF({ cards, org, siteUrl })` — PDF multi-página con una tarjeta de visita por miembro (mismo formato 85×55mm). Pensado para descarga masiva del admin desde Studio antes de un evento. Logo fetched una sola vez y reusado en todas las páginas.
- `fetchLogoAsPngBuffer(url, opts)` — fetch defensivo del logo de la org a Buffer PNG para embeber en el PDF. Acepta PNG/JPG nativos y SVG (vía Resvg); WEBP y formatos no soportados → null. Timeout 3s, try/catch silencioso (si falla devuelve null, el PDF sigue sin logo).
- `generateQrPngBuffer(cardUrl, size)` — standalone QR PNG (default 1024px, max 2048px) for use in Instagram bios, escaparates, vinilos.
- `formatSpanishPhone(phone)` — pretty-prints Spanish numbers (`34633816729` → `+34 633 81 67 29`).

**Re-download endpoints** (auth via `edit_token`, same mechanism as `edit-card`):
- `download-card.js` — `/api/download-card?slug=&token=` returns the PDF. Es B2B-aware: si la card tiene `organization_id` válido (org no soft-deleted), resuelve la org y devuelve la tarjeta de visita 85×55mm branded (`buildBusinessCardPDF`, misma pieza que adjunta el welcome kit B2B y `invite_team`). Sin `organization_id`, devuelve el A6 vertical del autónomo (`buildPrintableCardPDF`). Antes era ciego al carril y el botón "Descargar tarjeta ↓" del welcome kit B2B devolvía la A6 aunque el adjunto del propio email fuera la 85×55mm.
- `download-qr.js` — `/api/download-qr?slug=&token=&size=` returns the PNG.

Both are rate-limited (10 req / 10 min per IP) and cached as `private, no-store` to prevent leakage. Visible to paid users from the editor's "Tu kit físico" section (`#kitBanner` in `editar.html`, complementary to `#freeBanner` for free users).

**Admin re-send** (`resend-kit.js`): cuando el usuario pierde el email completo o pide soporte, el admin puede regenerar y reenviar todo (welcome email + tarjeta + QR + factura) con un clic. Auth admin password + TOTP, mismo patrón que `resend-invoice`. Reusa la factura existente si la hay; si no, la regenera. Marca `cards.kit_email_sent_at` en éxito para visibilidad en el panel.

**Difference vs `qr-download.js`**: that endpoint is public (anyone with a Pro slug can pull a QR), used from the public card page. The new `download-qr.js` requires the owner's token and works for Base too — both Base and Pro paid for and receive the kit.

### Post-payment email structure ("caja de entrega")

`stripe-webhook.js` → `buildEmail()` produces an email organised as 5 visual compartments rather than a flat receipt. Each section is a separate HTML email-defensive table (Outlook-safe, no rgba, no CSS variables). Order is intentional — the asset (live URL) comes first, downloads second:

1. **Hero** — URL as a physical object in a bordered box + "Ver mi perfil →" CTA
2. **Tu kit físico** — descriptive box with two re-download buttons (PDF + PNG); also notes the attachments are in the email
3. **Lo que has contratado** — plan / fecha vence + secondary "Editar mi perfil" button
4. **Dónde ponerlo** — three reinforcing use cases (redes / WhatsApp / furgo-escaparate)
5. **Pie** — factura adjunta + reply-to-this-email + cierre personal

Hex colors hardcoded in `lib/email-layout.js` (synchronised with `tokens.css`). Any palette change must touch both files in the same commit.

### Promo de lanzamiento (acción comercial 100% bonificada)

Acción comercial reversible para que los primeros usuarios completen el flujo de activación sin pagar. Se enciende con `LAUNCH_PROMO_ACTIVE=1` (env var). Cualquier otro valor lo apaga limpiamente.

**Flujo del usuario:**
1. Alta gratuita por `/alta` → `register-free`. Card en `status='active', plan='base'` (free), sin `kit_email_sent_at`.
2. En `/editar` aparece el banner promo dentro de `#freeBanner`: chip *"🎉 Promo lanzamiento"*, copy *"100% bonificado"*, planes con precio tachado (`<s>9€</s> Gratis`), CTA *"Activar gratis · Promo lanzamiento →"*.
3. Click → POST `/api/claim-launch-promo` (auth = slug + edit_token). Stripe NO interviene.
4. Backend: pasa `plan` y `expires_at` (90/365 días), marca `kit_email_sent_at`, genera tarjeta PDF + QR PNG + Comprobante de Promoción PDF, manda email con prefix `[Promo lanzamiento]` / `[Promo llançament]`. Redirect a `/{idioma}/success?slug=&promo=1`.

**Comprobante de Promoción** (NO factura): `invoice-utils.buildPDF` acepta `promo: true` + `bonificacion: 9|19`. Cambia el header a `COMPROBANTE DE PROMOCIÓN`, intercala una línea *"Bonificación lanzamiento: -9,00€"* antes del total y deja `TOTAL: 0,00 €`. Footer: *"Documento informativo. No es una factura. Bonificación 100% durante la campaña de lanzamiento."* La numeración usa prefijo `PROMO-YYYY-...` para no colisionar con la serie `FAC-YYYY-...` ni alimentar Verifactu (sin contraprestación = sin obligación fiscal).

**Idempotencia**: si la card ya está `status='active'` con `plan` distinto de `'free'`, devuelve 409 sin reactivar. La gate del `#freeBanner` en el editor mira `!stripe_session_id && !kit_email_sent_at`, así un perfil promo-redimido oculta el banner correctamente al recargar `/editar`.

**Apagado**: borrar la env var. El editor vuelve a llamar a `create-checkout` (Stripe), el endpoint `/api/claim-launch-promo` devuelve 410 Gone, los perfiles ya redimidos conservan su plan + expires_at sin cambios.

### Cards demo (marketing wedge)

Material de captación: tarjetas reales en producción que representan a profesionales-tipo (Mariola peluquera, Paco reformista, etc) y se reparten físicamente (QRs en El Rastro, posters, redes). Sirven dos funciones simultáneas — escaparate de producto y embudo de captación.

**Slug pattern** `demo-*` — todas las seed cards las crea manualmente el founder con un nombre que normalice a slug `demo-...` (ej. "Demo Paco Reparaciones del Hogar" → `demo-paco-reparaciones-del-hogar`). Tres comportamientos se gatan por este prefijo:

1. **Render en `/c/demo-*`** (`card.js`): pinta una pill verde "Ejemplo · Crea la tuya gratis" sobre la card, emite `robots noindex,nofollow`, y el botón WhatsApp + pill canalizan al alta con tracking: `href` → `/{idioma}/alta?via=demo-wa` (WhatsApp) o `?via=demo-pill` (CTA). El número personal del founder no se expone — la card parece completa pero los CTAs redirigen al funnel.
2. **Editor en `/editar?slug=demo-*`** (`editar.html`): JS detecta el prefijo y mueve la foto al top, encima del `#freeBanner` de upgrade, para que la card parezca completa al visualizarse.
3. **Activación seed**: `/api/activate-demo` (POST con slug + edit_token). Gate por prefijo `demo-*` — sin el prefijo devuelve 403 aunque el token sea válido. Marca `plan='pro'`, `expires_at` a +365 días, `kit_email_sent_at` y manda email recortado (subject `[Demo]`, footer "Sin valor fiscal", tarjeta A6 adjunta · **sin factura · sin QR PNG suelto · sin comprobante**). Idempotente: re-llamadas devuelven 200 sin re-tocar. Se llama desde la pantalla de éxito de `alta.html` cuando el slug recién creado empieza por `demo-*`.

**Auto-activación gratuita** — dos puertas independientes y reversibles en `register-free.js` que activan la card como Pro tras el INSERT, sustituyendo el welcome email por el demo email con tarjeta A6 adjunta. Ambas reusan `lib/demo-activation.js → activateAndSendDemoKit()` (la misma función que usa `/api/activate-demo`).

- **`DEMO_FUNNEL_FREE_ACTIVE=1`** → solo altas con `?via=demo-*` (campaña dirigida desde cards seed). Cualquier valor que empiece por `demo-` activa (`demo-wa`, `demo-pill`, `demo-qr`, `demo-rastro`, etc) — sin tocar código se pueden añadir variantes para tracking de canal.
- **`WEB_FUNNEL_FREE_ACTIVE=1`** → TODA alta orgánica (con o sin `via`) entra como Pro. Es el wedge B2C → B2B llevado al extremo: el autónomo individual nunca paga, la red de profesionales se hace grande, el revenue viene de organizaciones (Sprint 3 + Quipu). Cuando este flag está activo, Stripe queda dormido para el carril autónomo pero presente en código por si la conversación cambia más adelante.
- Precedencia: si ambas envvars están activas con `via=demo-*`, demo gana (evento PostHog `signup_completed_demo_funnel`). Web es el catch-all (evento `signup_completed_web_funnel`).
- Frontend (`alta.html` es + ca): lee `?via` del URL, lo añade al payload, y si la respuesta lleva `demo_activated: true` redirige directamente a `edit_url` saltándose la pantalla de éxito (el usuario aterriza viendo su perfil Pro completo, con QR + visitas).
- Si la activación falla en BD (UPDATE error), el handler cae al carril free normal: la card ya existe como free, el usuario recibe welcome email genérico, no se pierde el alta.
- Apagado: borrar la env var correspondiente. Las cards ya activadas conservan `plan='pro'` y `expires_at`. El frontend sigue mandando `via` pero el backend lo ignora; el banner Stripe del editor vuelve.

**Diferencia con seed cards**: las cards demo-funnel tienen slugs normales (`pepito-perez`, no `demo-*`), así que NO muestran la pill "Ejemplo" en `/c/:slug`, NO mueven la foto al top en el editor, y SÍ se indexan en Google. Son cards reales de usuarios reales que recibieron Pro gratis como gancho de la campaña. La distinción es importante: el prefijo `demo-*` reserva los tres comportamientos visuales para el material de marketing del founder, no para usuarios captados.

**Eventos PostHog**:
- `whatsapp_click` con `via=demo-*` (desde `/c/demo-*`).
- `signup_completed_demo_funnel` con `via` y `sector` (desde `register-free`).
- `demo_activated` con `slug` y `email_sent` (desde `lib/demo-activation`).

### B2B demo (organizations + /e/:slug)

Sprint reversible para enseñar que PerfilaPro puede alojar un "equipo branded" de profesionales bajo una organización. Activa el scaffolding dormido de la migración 007 (`organizations` + `cards.organization_id`) añadiendo branding (logo + color + slug público + tagline) en migración 019.

**Flujo de gestión** (white-label, marca de cliente configurable sin tocar código):
- **B2B Demo Studio** en `/admin-orgs.html` — UI dedicada protegida por `ADMIN_PASSWORD` + TOTP. Permite crear/editar/eliminar orgs, subir logo con drag-and-drop, elegir color con picker nativo, asignar cards con selector buscable y ver vista previa en vivo de `/e/:slug` en un iframe lateral. Pensado para que el founder o admin demo monte una org branded en 30 segundos durante una conversación comercial.
- Endpoint `POST /api/admin-orgs` (acciones: `list`, `create`, `update`, `delete_org`, `assign_card`, `list_cards_for_assignment`, `org_card_stats`, `org_get_stats_link`, `send_edit_link`, `get_edit_url`, `delete_card`, `offboard_card`, `invite_team`, `cantera_enrollment_invite`, `leads_list`, `leads_assign`, `leads_resend`, `download_team_cards`, `download_member_card`, `transfer_resolve`). Mismo auth que el resto del admin (password + TOTP). `transfer_resolve` (CANTERA · capa 3b) es el override del founder sobre un traspaso atascado: `decision='force_accept'` ejecuta la RPC atómica `cantera_execute_transfer` con `granted_by_role='founder'`; `decision='cancel'` marca el `club_transfers` cancelado.
- El botón **"Invitar"** de cada org en el Studio es **consciente del `kind`**: para `business` abre el modal B2B de operarios (`invite_team` → crea cards + tarjeta de visita). Para `sports_club` abre el modal **"Invitar familias"** que dispara `cantera_enrollment_invite` (gateada por `isCanteraActive()`): manda el enlace de la campaña de inscripción ABIERTA del club a una lista de emails (espejo founder de `org-panel → enrollment_invite`, reusa `lib/enrollment-invite`). NO crea cards (el padre rellena la ficha del menor al inscribirse, LOPD-limpio); 409 si el club no tiene inscripciones abiertas. Auditada en `admin_audit_log`. Es la alternativa correcta al invite B2B para clubes — el invite de "operarios" no aplica a un club que inscribe jugadores con su tutor.

**Consola de incidencias del founder (CANTERA)** — acciones `cantera_*` en el mismo endpoint `admin-orgs` (auth password+TOTP), lógica en `lib/cantera-incidents.js`, cada acción sensible auditada en `admin_audit_log` (acción + slug + ip). Cuatro familias: (1) **traspasos+membresías** — `cantera_player_overview` (vista de investigación: card + membresías + admins + consents + transfers), `cantera_edit_membership` (dorsal/posición/equipo/categoría de una membresía abierta), `cantera_close_membership` (baja vía RPC), `cantera_reassign_club` (reasignación atómica de club reusando `cantera_execute_transfer`); (2) **tutores** — `cantera_revoke_admin`, `cantera_add_admin` (genera `edit_token`); (3) **consentimiento+visibilidad** — el overview expone el audit `card_consents` read-only, `cantera_set_visibility` fuerza/revoca `public_card`; (4) **PII+LOPD** — `cantera_reveal_birthdate` (descifra `birth_date_encrypted` para soporte, auditado), `cantera_delete_player` (soft-delete `deleted_at` por defecto; `hard:true` borra la card → cascade member_club_seasons + card_admins, pero `card_consents` es RESTRICT y protege el audit trail). Sin migración ni env nuevos. **UI**: sección colapsable "🚑 Incidencias Cantera" en `admin-orgs.html` — buscador por slug → `cantera_player_overview` → ficha + membresías + tutores + consents (read-only) + traspasos, con botones por acción (revelar fecha, visibilidad, reasignar, baja/editar membresía, revocar/añadir tutor, borrar soft/hard, forzar/cancelar traspaso).
- Tarjeta de visita 85×55mm para miembros del equipo: cada `invite_team` adjunta `tarjeta-{slug}.pdf` (branded con `color_primary` + logo de la org + nombre + cargo + email del miembro + QR) al email de invitación. El admin puede descargar todas las tarjetas del equipo en un PDF booklet único desde el botón "📥 Descargar tarjetas del equipo (PDF)" del panel de profesionales — action `download_team_cards`. Para previsualizar la tarjeta de un solo miembro sin abrir su buzón ni bajarse el booklet entero, el admin tiene un icono 🪪 en cada fila del listado de miembros — action `download_member_card`, exactamente el mismo render que el adjunto del email de invitación. El render reusa `buildBusinessCardPDF` / `buildBusinessCardsBookletPDF` de `printable-card-utils.js`.
- Volver al Studio desde la card pública del miembro: cuando el admin abre `/c/:slug` desde el botón "↗ Abrir en pestaña" del drawer, la URL lleva `?from=admin-orgs`. `card.js` lo detecta y pinta una franja oscura arriba con un link "← Volver al panel B2B Studio". El click intenta `window.close()` si el tab tiene `window.opener` vivo (el caso normal: cerrar el popup y devolver foco al admin-orgs original con su sesión intacta); si no, cae a navegar a `/admin-orgs.html`. La franja solo aparece con ese query param, así que la card pública compartida no la enseña a visitantes.
- Endpoint `POST /api/upload-org-logo` (auth password + TOTP): recibe `{slug, base64, contentType}`, sube al bucket `Avatars` bajo `org-logos/{slug}-{timestamp}.{ext}` y hace `UPDATE organizations.logo_url` en una sola llamada. Acepta png/jpg/webp/svg, máx 2 MB. La org debe existir antes de subir el logo (404 si no).
- `delete_org` es soft-delete (`deleted_at = NOW()`). Antes de marcar la org, desvincula todas sus cards (`organization_id = NULL`) para que ninguna quede colgando.

**Render público**:
- `/e/:slug` (función `org.js`) — hero con fondo `color_primary`, logo de la org y tagline; debajo, grid de profesionales activos (`pp-dir-grid` reusado de `dir-utils`). 404 si la org no existe o está soft-deleted. Solo español por ahora. Emite `<meta name="robots" content="noindex,nofollow">` siempre — las páginas B2B se difunden por URL directa, no via Google, y noindex protege de fugas de branding de terceros mientras el piloto no esté cerrado.
- `/e/:slug/stats?token=…` (función `org-stats-page.js` + `org-stats.js` JSON) — panel privado de estadísticas agregadas de la organización. Token-protegido (`organizations.stats_token`, 32-byte hex, TTL 90 días) generado por el founder desde admin-orgs (acción `org_get_stats_link`) y compartido manualmente con el cliente. Renderiza KPIs (visitas 7d/30d/all + profesionales activos), sparkline SVG inline de los últimos 30 días y tabla de miembros ordenada por visitas 30d. `Cache-Control: private, no-store` + `X-Robots-Tag: noindex`. Rate-limited a 60 req/10min/IP. La acción admin reutiliza el token vigente si existe; con `force_refresh: true` rota (invalida el enlace antiguo).
- `/c/:slug` (función `card.js`) — cuando la card tiene `organization_id` resuelto, pinta una franja superior de 6px con `color_primary`, una atribución al pie ("Parte de [Org]") que enlaza a `/e/:slug`, y emite `robots noindex,nofollow`. Sin `organization_id` la card se renderiza idéntica que antes y se indexa normalmente (cambios gateados defensivamente).

**Validaciones backend** (`lib/org-utils.js`):
- `isValidOrgSlug` — `[a-z0-9-]{2,40}`, sin guiones al inicio/fin.
- `isValidHex` — solo `#RRGGBB`.
- `isSafeLogoUrl` — solo `https://` + sufijo `supabase.co/storage` o `supabase.in/storage` (mismo whitelist que `cards.foto_url` en `edit-card.js`).
- `isValidTagline` — string ≤140 chars.

**Reversibilidad**: si la demo se descarta basta con (a) borrar la route `/e/:slug` y `/api/admin-orgs` en `netlify.toml`, (b) quitar el bloque condicional `if (data.organization_id) { ... }` en `card.js`. Las columnas SQL pueden dejarse dormidas sin coste o eliminarse con una contramigración. Como `organization_id` es NULL por defecto, cero cards existentes se ven afectadas si nunca se asigna.

**Fuera de scope** (deuda consciente):
- Stripe billing B2B / facturación a la organización en lugar de al autónomo → Sprint 3.
- Catalán en `/e/:slug` → la página solo renderiza en español; se añade cuando haya un lead B2B catalanoparlante real.
- `organizations.idioma` o multilingüismo por org → diferido hasta tener cliente.
- Tab integrada en `admin.html` para gestión de orgs → vive en su propia página `/admin-orgs.html` para no abultar el dashboard principal. Cuando el B2B sea producto estable se valora consolidar.

### Panel cliente B2B self-serve (`/panel.html`)

Sprint Bloque 2 #1. Permite al **responsable de una organización** gestionar branding, equipo y estadísticas sin pasar por el founder. Activado por magic-link al email registrado en `organizations.email`.

**Auth model — passwordless + JWT 7d:**
- Cliente abre `/panel.html` → introduce email de su organización → `POST /api/panel-auth { email }`.
- Backend hace lookup en `organizations.email` (índice parcial `organizations_email_active_idx` creado por migración 028). Si match: firma un JWT con `{ purpose:'org-panel', orgId, orgSlug }`, TTL 7d, secreto `ORG_PANEL_JWT_SECRET` (fallback `AGENT_JWT_SECRET`), y manda email con `${SITE_URL}/panel.html?session=<jwt>`.
- Devuelve **siempre 200** (anti-enumeration, mismo patrón que `send-edit-link`).
- Cliente abre email → click → frontend extrae `session=` de la URL, lo guarda en `localStorage.pp_panel_session`, limpia el query string con `history.replaceState`, carga el dashboard.
- Visitas posteriores: localStorage tiene el JWT → bypasses login.
- Logout = `localStorage.removeItem`.

**Endpoint `org-panel.js`** (`POST /api/org-panel`, header `Authorization: Bearer <jwt>`):

Toda acción está forzosamente scoped a `orgId` del JWT. No existe `org_slug` en el body — un cliente NUNCA puede operar sobre otra org porque no puede falsificar el JWT. Si la org del JWT está soft-deleted, la sesión queda inservible (401).

| Action | Función |
|---|---|
| `get_org` | Devuelve org + lista de miembros + stats agregadas (totals 7d/30d/all + sparkline 30d). Marca `panel_last_login_at` best-effort para que el founder vea desde admin-orgs si el cliente usa el panel. |
| `update_branding` | Actualiza `tagline`, `description`, `website`, `address`, `phone`, `color_primary`. **NO permite** cambiar `name`, `slug`, `email` ni `logo_url` (founder-only por riesgo de auto-bloqueo / ruptura de URLs / sin upload-org-logo scoped a cliente). |
| `invite_team` | Alta en lote (≤100). Reusa `lib/team-invite.js` (extracción de la lógica de `admin-orgs.js → invite_team`). Cada miembro recibe email de invitación con tarjeta de visita PDF branded adjunta. |

Rate-limit 120 req / 10 min por IP — holgado para operativa normal (cargar panel + editar branding + invitar lote).

**Reusable `lib/team-invite.js`**: la lógica del loop de invite_team (sanitizar plantilla, cachear logo, generar slug + token + PDF + email + marcar `edit_link_sent_at` por miembro) vive aquí. La importan tanto `admin-orgs.js` (founder) como `org-panel.js` (cliente self-serve). Si añadimos un campo de plantilla nuevo, se añade una sola vez.

**Frontend (`public/panel.html`)**: SPA vanilla JS (sin framework). 3 tabs: Estadísticas (KPIs + sparkline SVG inline), Equipo (tabla ordenada por visitas 30d + form de invite con plantilla colapsable + filas dinámicas), Branding (form con color picker sincronizado a hex input + textarea con maxlength). Login screen con copy "Sin contraseñas" para resaltar el flow. Topbar negra con enlace "Ver página pública ↗" a `/e/:slug`.

**Migración 028**:
- `organizations.panel_last_login_at timestamptz NULL` — visibility para founder.
- Índice parcial `organizations_email_active_idx` sobre `email` donde `email IS NOT NULL AND deleted_at IS NULL` — lookup rápido del magic-link.

**Fuera de scope MVP** (Bloque 2 #1):
- ❌ Offboard de miembros con cortesía 90 días → founder-only via admin-orgs.
- ❌ Borrar cards / soft-delete miembro → founder-only.
- ❌ Download PDF de tarjetas del equipo → founder-only.
- ❌ Resend edit-link a miembro individual → founder-only.
- ✅ Upload de logo → cliente vía `upload-org-logo-panel.js` (Bloque E).
- ❌ Ver/rotar `stats_token` → el link público a `/e/:slug/stats` lo sigue generando founder.
- ❌ Cambiar `slug`, `name`, `email` propios → founder-only (riesgo de auto-bloqueo).
- ❌ Múltiples admins / roles por org → modelo actual asume 1 admin por org (organizations.email). Se añade tabla `org_admins` cuando un cliente lo pida.

### Wizard onboarding post-checkout (`/panel.html` · Bloque E)

Cuando un cliente B2B aterriza por primera vez en su panel desde el magic-link del welcome email (Bloque B), `loadDashboard()` detecta que `organizations.logo_url IS NULL` y muestra un **wizard de 3 pasos lineales** en lugar del dashboard normal. Cada paso es saltable individualmente — el cliente puede dimissar el wizard en cualquier momento y completar el branding desde la pestaña Branding como antes.

**Pasos:**
1. **Logo** — dropzone con drag-and-drop + file picker (PNG/JPG/WEBP/SVG, ≤2 MB). Preview local antes de subir. Al pulsar "Subir y continuar →", POST a `upload-org-logo-panel.js` con base64 + contentType.
2. **Color** — grid de 12 swatches preseleccionados (PerfilaPro verde, tinta, azul, rojo, naranja, mostaza, violeta, rosa, cyan, gris, burdeos, oliva) + color picker nativo + input hex sincronizados. Al guardar → POST a `org-panel.js update_branding { color_primary }`.
3. **Equipo** — formulario simple (nombre + email + cargo opcional) que invita al primer miembro. Reusa `org-panel.js invite_team` con `team: [{...}]`. Al saltar entra directamente al dashboard.

**Triggers de visibilidad:**
- Se muestra cuando `org.logo_url == null && !localStorage.pp_panel_wizard_dismissed_<slug>`.
- Se dimisses (set localStorage flag) al completar el step 3 (botón "Entrar al panel →") o al pulsar "Saltar y entrar al panel" en cualquier paso final que termine el wizard.
- Una vez dimissado, el wizard no vuelve a aparecer aunque el cliente no haya subido logo — para no agobiar a quien explícitamente dijo "ahora no".

**Endpoint nuevo `upload-org-logo-panel.js`** (`POST /api/upload-org-logo-panel`):
- Espejo de `upload-org-logo.js` pero auth via JWT del panel (`lib/panel-auth.authFromEvent`) en lugar de admin password + TOTP.
- Body: `{ base64, contentType }` — **sin `slug`**. La org se resuelve desde `session.orgId` del JWT, así que el cliente NUNCA puede subir el logo de otra org aunque manipule el body.
- Mismo bucket (`Avatars/org-logos/{slug}-{timestamp}.{ext}`), mismo MAX_BYTES (2 MB), misma whitelist MIME.
- Rate-limited a 20 req / 10 min por IP — cubre re-subir el logo varias veces sin permitir abuso del bucket.
- Devuelve 401 si la org está soft-deleted (sesión inservible, mismo patrón que `org-panel.js`).

**Reversibilidad**: borrar la route `/api/upload-org-logo-panel` en `netlify.toml`, el archivo del handler, los pasos del wizard en `panel.html` y la condición `logo_url == null` en `loadDashboard()`. El bucket queda intacto y `upload-org-logo.js` (admin) sigue funcionando.

**Reversibilidad**: borrar las rutas `/api/panel-auth`, `/api/org-panel`, `/panel` en `netlify.toml` + los 3 archivos. La columna `panel_last_login_at` puede dejarse dormida sin coste.

### Landing B2B (`/es/empresas` + `/ca/empresas`)

Página pública (indexable, no requiere auth) que vende el producto a **organizaciones con red profesional**: empresas, despachos, colegios profesionales, asociaciones, administraciones públicas, ONGs. URL `/es/empresas` por SEO ("empresas" tiene volumen de búsqueda, "organizaciones" no), pero el copy es de amplio espectro. La versión catalana `/ca/empresas` es traducción 1:1; ambas se cruzan con `<link rel="alternate" hreflang>` + `og:locale:alternate`. El header B2C (es y ca) enlaza directo a su versión del landing — espejo simétrico del "Soy autónomo / Sóc autònom →" que el landing B2B tiene hacia el B2C.
- **Hero** con un claim único + 2 CTAs: form de demo (primario) + scroll al vídeo. Subtítulo enumera explícitamente los tipos de organización para que el visitante "se vea" en el primer scroll.
- **Switcher sectorial** con 4 ángulos preconfigurados — Empresas y redes (retención de marca), Despachos y consultoras (imagen homogénea), Colegios y asociaciones (pertenencia como activo digital), Sector público y ONGs (identidad institucional sin CMS interno). Cada uno con su copy, sin reload — vanilla JS.
- **Disclaimer del sector público**: el panel "Sector público y ONGs" incluye una nota visible advirtiendo que requisitos específicos (ENS, residencia de datos en España, accesibilidad WCAG AA, contratación por pliego) se evalúan caso por caso. Evita sobre-prometer compliance que el producto no tiene certificado.
- **Sección de vídeo** `<video>` apuntando a `/videos/b2b-studio-demo.mp4`. Si el archivo no existe (404 o timeout 2.5 s), se muestra un fallback "Vídeo en breve" en lugar de un reproductor roto. Para activar la demo en vídeo: grabar Studio en acción → exportar MP4 < 5 MB → subir a `public/videos/b2b-studio-demo.mp4` + poster a `public/videos/b2b-studio-demo-poster.png`.
- **Form** con honeypot (campo `website` oculto; si viene relleno, devolvemos 200 sin enviar). Campos: nombre, organización, email, tamaño de equipo (enum), tipo de organización (enum: `empresa`, `despacho`, `colegio`, `publico`, `ong`, `otro`), mensaje opcional, **`plan_interes`** (hidden, enum `equipo`|`organizacion`|`enterprise`|`no_se`) — lo prellena el JS al pulsar el CTA de un tier en la sección de pricing.
- **Sección Pricing** entre los pasos y el vídeo. Tres tarjetas (Equipo, Organización, Enterprise) con toggle anual/mensual: anual 4/5/desde 6 €/profesional/mes con 2 meses gratis · mensual 5/6/desde 7 €/profesional/mes. La tarjeta «Organización» va destacada con badge «Más popular». Cada CTA hace scroll al form y prellena `plan_interes` con el tier correspondiente para que el founder sepa por qué entrada llega el lead.
- **Sección Garantías** (reembolso 30 días, sin permanencia, datos exportables, founding partner 50 %) en fondo verde-light, debajo de pricing.
- **FAQ** con 6 preguntas frecuentes (facturación por profesional, offboarding limpio, tarjetas físicas en PDF, prueba antes de pagar, sector público / requisitos especiales, facturación legal). Cada item es `<details>` con summary clickable; el `<style>` reemplaza el marker nativo por un `+` que rota a `−` cuando se abre.
- **Trust signals** + **footer** con enlace cruzado a la landing B2C ("¿Eres autónomo individual?").

**Endpoint `lead-b2b.js`** (`POST /api/lead-b2b`): valida campos, ejecuta el honeypot, persiste el lead en `b2b_leads` (con `invite_token` reservado pero **no enviado al lead automáticamente**) y manda dos emails vía Resend — uno interno a `B2B_LEAD_INBOX` (siempre en español, con el magic-link visible para el founder) y un **acuse de recibo** al lead localizado según `body.idioma` (`LEAD_ACK_STRINGS = { es, ca }`). El acuse **no contiene el magic-link**: solo confirma recepción y anuncia contacto en 24-48h. Los mensajes de validación HTTP devueltos al frontend también respetan el idioma (`ERROR_STRINGS = { es, ca }`) — un lead catalán que se equivoque al rellenar el form recibe el error en catalán. Sin auth (es un form público), pero defensa via honeypot + validación estricta de enums + tamaño máximo de campos.

**Gate manual del magic-link**: el magic-link se manda al lead a mano desde el Studio (admin-orgs → acción `leads_resend`) una vez el founder ha hablado con él. Si para entonces el founder ha creado la organización en admin-orgs y ha asociado el lead, `buildLeadEmail` recibe `org={name, logoUrl, color}` y pinta un banner branded en el email (logo + `color_primary` + nombre de la org bajo el label "Demo personalizada"/"Demo personalitzada"). Sin org asociada, el email va con identidad PerfilaPro genérica. Si la org existe pero está soft-deleted, fallback a genérico también. Este flujo evita que cualquier formulario público genere un onboarding-link funcional antes de que haya conversación comercial.

**Env vars**:
- `B2B_LEAD_INBOX` — email que recibe los leads (ej. `leads@perfilapro.es`, o un Forward del founder). Si no está configurado, el endpoint devuelve 500.

**Reversibilidad**: si el ángulo B2B no encaja, basta con borrar `public/es/empresas.html` + `public/ca/empresas.html` + la route `/api/lead-b2b` en `netlify.toml` + `lead-b2b.js`. Sin BD, sin dependencias.

### Observability (PostHog)

Sprint 1: analítica de producto vía PostHog Cloud (región EU). Carga **solo tras consentimiento explícito** del usuario en el banner de privacidad.

**Frontend** (`public/js/posthog-init.js`):
- Define `window.ppLoadAnalytics`, que el banner (`privacy-banner.js`) invoca cuando el usuario acepta cookies. Si rechaza o `POSTHOG_API_KEY` no está configurada en backend, no se carga PostHog.
- La key se obtiene vía `GET /api/analytics-config` (función `analytics-config.js`), no se hardcodea en HTML — permite cambiarla sin tocar código y desactivar la analítica con solo borrar la env var.
- Helpers globales seguros de llamar (no-op si PostHog no está cargado): `window.ppEvent(name, props)`, `window.ppIdentify(id, traits)`, `window.ppReset()`.

**Server-side** (`netlify/functions/lib/posthog-server.js`):
- `capture(distinctId, event, properties)` hace `POST` a `${POSTHOG_HOST}/capture/`. No-op silencioso si la env var no está. Errores se loguean pero no se relanzan; el llamador hace `.catch(() => {})`.

**Eventos emitidos hoy**:
- Frontend: `signup_step_view` (alta paso 1/2/3), `signup_submit_started`, `signup_completed_free` (con `ppIdentify`), `whatsapp_click` (en `/c/:slug`).
- Server: `signup_completed_free` desde `register-free`, `signup_completed_paid` desde `stripe-webhook`.

**Banner consentimiento** (`public/js/privacy-banner.js`): refactor de informativo a consent gate con dos botones (Aceptar / Rechazar). Flag `pp_privacy_ack` en `localStorage` con valores `accepted` / `rejected` (compat con valor legacy `1` = `accepted`).

### B2B Stripe Subscription (Bloque A — monetización recurrente por org)

Carril en construcción para llevar las orgs a Stripe Subscription en lugar del flujo manual de admin-orgs. Modelo: **seat-based** (€/profesional/mes con Stripe `quantity`), comisión **recurring** sobre cada `invoice.paid` para el agente que cerró la org, **Enterprise gated** vía form `lead-b2b` (no precio recurrente self-serve).

**Endpoint `create-org-checkout.js`** (`POST /api/create-org-checkout`):
- Body: `{ tier: 'team'|'org', cycle: 'monthly'|'annual', seats: int 1-500, org_name, email, agent_code?, slug?, idioma? }`.
- Mapea `(tier, cycle)` a uno de los 4 prices Stripe (`STRIPE_PRICE_TEAM_MONTHLY`/`_ANNUAL`, `STRIPE_PRICE_ORG_MONTHLY`/`_ANNUAL`). Si el env var está vacío → 503 (permite activar tiers por separado).
- `mode='subscription'`, `line_items: [{ price, quantity: seats }]` — Stripe controla el MRR; cambios futuros de seats van via `customer.subscription.updated`.
- `agent_code` (de `?via=agent-XXXX` en la landing) viaja en `session.metadata` **Y** en `subscription_data.metadata` para que el webhook lo encuentre en `invoice.paid` sin tener que retro-buscar la session original. `agent_code` malformado se silencia (cae a venta directa).
- Sin `agent_code` → `organizations.agent_code = NULL` post-webhook (bolsa founder; el admin podrá reasignar desde admin-orgs en Bloque D).
- Rate-limit 10 req / 10 min / IP, mismo patrón que `create-checkout`.
- `success_url` / `cancel_url` apuntan a `/${idioma}/empresas` con flag `?subscribed=1` en success.

**Schema (migración 029)** — extiende `organizations` y crea `org_invoices`:
- `organizations.agent_code text NULL` — atribución comercial. NULL = bolsa founder. Indexado parcial.
- `organizations.stripe_customer_id text NULL` — para resolver org desde `customer.subscription.*` (Stripe sólo manda el customer en algunos eventos).
- `organizations.stripe_subscription_id text NULL UNIQUE` — clave de upsert en eventos de subscription.
- `organizations.tier text NULL` — CHECK `'team' | 'org' | 'enterprise'`.
- `organizations.cycle text NULL` — CHECK `'monthly' | 'annual'`.
- `organizations.seats integer NULL` — cantidad actual.
- `organizations.subscription_status text NULL` — mirror del estado Stripe (`active`, `past_due`, `canceled`, etc). Sin CHECK para no acoplarse al enum si Stripe añade estados.
- `organizations.current_period_end timestamptz NULL` — para notificaciones y display de "renueva el ...".
- `org_invoices` — histórico de `invoice.paid`. Permite al portal de agentes calcular comisión recurrente sin re-llamar a Stripe. `agent_code` se persiste como snapshot al momento del invoice (atribución histórica estable si la org se reasigna). Indexada por `(agent_code, paid_at DESC)` y por `organization_id`.

**agent-data.js extendido**:
- Carga `org_invoices` propias (`agent_code = agentCode`) y de sub-agentes (`in subCodes`).
- Carga `organizations` activas atribuidas al agente para calcular MRR estimado (monthly → directo, annual → /12).
- `months[]` ahora incluye `card_commission`, `org_commission` y un `commission` total. Cada periodo también lleva `own_org_invoices` y `sub_org_invoices`.
- Nuevos campos en `summary`: `org_count` (orgs activas), `org_mrr_eur`.
- Nuevos campos top-level: `recent_org_invoices` (últimos 20), `orgs` (todas las atribuidas, no soft-deleted).
- Comisión org: `agentRate%` directo sobre `amount_cents`. L2-on-L1 override 5% sobre invoices de sub-agentes (mismo modelo que cards).
- Try/catch defensivo en las queries de `org_invoices` y `organizations` — si la migración 029 aún no se ha ejecutado en un entorno, agent-data sigue funcionando para el carril autónomo.

**Eventos Stripe (Bloque B)** — `stripe-webhook.js` delega los 4 eventos de subscription al lib `lib/org-subscription.js`:

| Evento Stripe | Acción |
|---|---|
| `checkout.session.completed` con `metadata.kind='org-subscription'` | Inserta `organizations` con slug único (resuelve colisiones con sufijo `-2/-3/…`), persiste `tier/cycle/seats/agent_code/stripe_customer_id/stripe_subscription_id`, envía welcome email con magic-link al panel (`signPanelSession` 7d). Idempotente: replay del mismo `stripe_subscription_id` devuelve `replayed=true` sin re-insert. |
| `customer.subscription.updated` y `customer.subscription.created` | UPDATE en `organizations` por `stripe_subscription_id`: `subscription_status`, `seats` (de `items.data[0].quantity`), `current_period_end`. Si la sub aún no está en BD (carrera con el checkout), no-op silencioso — el siguiente evento la encontrará. |
| `customer.subscription.deleted` | UPDATE `subscription_status='canceled'`. **No** soft-deleta la org (los cards públicos siguen funcionando hasta `current_period_end`). El admin decide la limpieza efectiva desde admin-orgs. |
| `invoice.paid` con `subscription` no-null | UPSERT en `org_invoices` con `onConflict='stripe_invoice_id'`. Snapshot de `agent_code/tier/cycle/seats` preferentemente de la org en BD (refleja estado actual); fallback a `subscription_details.metadata` si la org aún no existe. Invoices sin subscription (one-shot autónomo) se ignoran. |

El carril autónomo (`checkout.session.completed` sin `metadata.kind`) sigue intacto.

**Welcome email B2B** (`buildOrgWelcomeEmail` en `lib/org-subscription.js`):
- Asunto + cuerpo localizados es/ca según `session.metadata.idioma`.
- CTA principal: `${siteUrl}/panel.html?session=<jwt>` (JWT firmado por `signPanelSession`, TTL 7d).
- Bloque "¿Qué hacer ahora?" con 3 pasos: logo+color, invitar equipo en lote, compartir `/e/:slug`.
- Si Resend falla, el cliente puede pedir el magic-link estándar en `/panel.html` con su email — `panel-auth.js` lo regenera.

**Bloques aterrizados**:
- Bloque A — `create-org-checkout` (Stripe Subscription).
- Bloque B — `stripe-webhook` enruta 4 eventos de subscription al lib `org-subscription`.
- Bloque C — migración 029 + `agent-data` con comisión B2B recurrente.
- Bloque D — UI agente (tabs Autónomos/B2B + generador `?via=`) + captura de atribución en landing → `b2b_leads.agent_code` (migración 030). **Phase 2** ✅ — carry-over automático `b2b_leads.agent_code → organizations.agent_code` al asociar el lead a la org desde el Studio (`leads_assign`), sin pisar atribución existente.
- Bloque E — wizard onboarding 3 pasos en `/panel.html` cuando `logo_url IS NULL` + `upload-org-logo-panel.js` scoped al JWT del cliente.

### Quipu integration (Verifactu/AEAT)

`netlify/functions/lib/quipu-client.js` is a **skeleton** with the contract (`createInvoice`, `voidInvoice`, `getInvoice`) but no real implementation — every method throws `not implemented`. It is intentionally unwired so that any accidental call fails loudly instead of silently emitting nothing to AEAT.

The implementation lands in Sprint 3, after:
- the provider is selected (Quipu preferred, plan B Holded, plan C FacturaDirecta) and the API validation week closes with a GO,
- the issuer's autónomo registration is formalised (NIF active),
- Stripe live and Stripe Subscription are activated.

Env vars (see `.env.example`): `QUIPU_CLIENT_ID`, `QUIPU_CLIENT_SECRET`, `QUIPU_API_BASE`, `QUIPU_ENV`.

### Cantera · vertical deporte base

Carril sports_club montado sobre la infra B2B existente (no es un fork, es una extensión gateada por discriminadores). Activación runtime con `CANTERA_VERTICAL_ACTIVE=1`; cualquier otro valor lo apaga limpiamente. Las tablas y columnas creadas por la migración 033 quedan dormidas — cero impacto en autónomos y B2B genérico.

> **Estado actual del sprint + decisiones pendientes**: ver `docs/cantera-handoff.md`. Cuando arranque un hilo nuevo, leerlo después de esta sección.

**Decisiones-marco** (D1/D2/D3 — heredadas, no re-debatir):

- **D1** · Una sola tabla `cards` con discriminador `card_kind` (`autonomo` | `player` | `club_staff`). Reusa foto_url, edit_token, kit_email_sent_at, visits, slug-as-PK, idioma, downloads. Campos no aplicables (sector, servicios, whatsapp comercial) quedan NULL para cards no-autónomas.
- **D2** · `cards.organization_id` se mantiene como "club actual activo" (estado denormalizado, fast queries). La verdad histórica vive en `member_club_seasons`. El handoff entre clubes = transacción que cierra la fila vieja, abre la nueva y actualiza `cards.organization_id`. Esto preserva `card.js` y `org.js` sin tocarlos.
- **D3** · `organizations.kind` (`business` | `sports_club`) + `organizations.sport` (`futbol`, `baloncesto`, …) permiten que despachos/consultoras y clubes deportivos convivan. El Studio, panel cliente y `/e/:slug` ramifican por `kind`. Multi-deporte está por diseño aunque el seed sólo contiene fútbol.

**Tablas (migración 033)**:

- **`cards` extendida** — `card_kind` (default `'autonomo'`), `birth_date_encrypted` (bytea; cifrado AES-256-GCM app-side con `CANTERA_PII_KEY` vía `lib/pii-crypto.js` — ver nota de capa 1 abajo), `birth_year` (en claro, único campo necesario para queries de categoría), `gender` (`M`/`F`/`X` nullable), `public_card` (boolean; para `card_kind='player'` arranca `false` hasta consentimiento parental, gatea `/c/:slug`).
- **`organizations` extendida** — `kind`, `sport`, `stripe_connect_account_id`, `stripe_connect_charges_enabled`, `stripe_connect_payouts_enabled`. Connect Standard (la responsabilidad fiscal queda 100% en el club; PerfilaPro cobra `application_fee_percent`).
- **`card_admins`** — multi-admin sobre la card del jugador. Roles: `tutor_legal`, `tutor_secundario`, `player_self`, `club_admin`. Cada admin tiene su propio `edit_token` (32-byte hex). Reemplaza el modelo single-token `cards.edit_token` sólo cuando `card_kind='player'`; para autónomos sigue intacto.
- **`card_consents`** — audit trail LOPDGDD append-only. Tipos: `parental_initial`, `data_processing`, `public_visibility`, `club_handoff`, `image_rights`, `transfer_to_player`. RLS bloquea UPDATE/DELETE (`REVOKE UPDATE, DELETE ... FROM PUBLIC`) incluso para service_role — blindaje contra un endpoint mal escrito que borre evidencias.
- **`sports_categories`** — lookup multi-deporte. Sport + code (`alevin`, `infantil`, `cadete`, …) + display_name_es/ca + offsets birth_year. Seed inicial sólo fútbol (7 categorías). Read-only público vía policy.
- **`member_club_seasons`** — *core relacional*. Una fila por `(card, club, temporada, role)`. Para jugadores: dorsal + position + category + stats_jsonb. Para staff (entrenador, delegado, médico, fisio, preparador, presidente, directiva): mismos campos pero sin dorsal/position. CHECK `dorsal IS NULL OR role='jugador'` lo garantiza. Índice único parcial `idx_player_active_globally` (sobre `card_slug WHERE left_at IS NULL AND role='jugador'`) implementa la regla federativa de "un jugador no puede estar fichado por dos clubes a la vez" (se relaja a `(card_slug, sport)` cuando se active multi-deporte). Al cerrar fila (`left_at NOT NULL`), `closed_snapshot_jsonb` congela stats + dorsal + categoría — histórico inmutable aunque luego cambien las stats por correcciones.
- **`card_print_orders`** — pedido de carnet PVC + NFC. Status (`pending` → `paid` → `sent_to_printer` → `shipped` → `delivered`). Kind (`setup`/`renewal`/`replacement`). El cobro va directo a PerfilaPro (no Connect): 12€ setup, 6€ renovación anual. NFC UID se registra al impresionar; índice único parcial sobre `nfc_uid` para que un chip no pueda asignarse a dos cards.
- **`parent_subscriptions`** — cuotas mensuales padre→club vía Stripe Connect. Diferenciada de `org_invoices` (que es B2B genérico no-Connect). Cobro a la cuenta conectada del club; `application_fee_bps` cae en la cuenta platform.
- **`match_stats`** — eventos crudos de partido. Opcional (clubes que usen la app de stats). Lo agrega `member_club_seasons.stats_jsonb` periódicamente.

**Tablas/columnas (migración 034 · capa 0.5)** — aterriza Q1=sí (Bizum/efectivo en MVP) y Q2=texto libre (histórico pre-plataforma) del handoff:

- **`external_payments`** — cobros manuales fuera de Stripe Connect (Bizum personal del coordinador, efectivo, transferencia). Una fila por pago: `card_slug` + `organization_id` + `period` (mes facturado, nullable para pagos sueltos) + `amount_cents` + `currency` + `method` (`bizum`/`efectivo`/`transferencia`/`otro`) + `recorded_by` (email del admin que lo apuntó) + `paid_at` + `receipt_number` (nullable, número del recibo informativo si el padre lo pide) + `notes` + `concepto` (migración 042, nullable; nombre del concepto del plan a medida que cubre el cobro, p.ej. "Inscripción" — espejo de texto, no FK; lo usa la matriz de Cobros para casar el pago manual con su columna cuando el club cobra por plan). La pestaña **Cobros** del Studio une `parent_subscriptions` (Stripe) + `external_payments` (manual) en una sola vista de "quién pagó". **NO es registro fiscal**: la factura/recibo SEPA legal la emite el club fuera de PerfilaPro; `receipt_number` es para el recibo informativo (plantilla "recibo", no "factura", de `invoice-utils.js`). FK sin `ON DELETE` (mismo criterio que `parent_subscriptions`): un cobro no se borra en cascada al limpiar la card. Índice único parcial sobre `receipt_number` cuando no es NULL.
- **`member_club_seasons.previous_club_name`** (text, nullable) — nombre legible del club del que llega el jugador cuando ese club **no** está en PerfilaPro (caso dominante en fase 1: casi todos los fichajes entrantes vienen de clubes off-platform). No enlaza a `organizations` — es captura de histórico legible, no relación. El handoff transaccional entre clubes PerfilaPro sigue usando `organization_id`.

**Helpers (capa 1)** — ladrillos puros que reusan todos los endpoints del carril; cada uno aislado y testeado (`tests/lib-cantera-*.test.js`, `lib-card-kind`, `lib-pii-crypto`, `lib-sports-categories`, `lib-external-payments`):

- **`lib/cantera-flag.js`** — `isCanteraActive()` (true sólo con `CANTERA_VERTICAL_ACTIVE='1'`) + `canteraDisabledResponse()` (410 Gone). El gate que abre cada endpoint del carril.
- **`lib/card-kind.js`** — constantes `CARD_KINDS` + guards `isAutonomo/isPlayer/isClubStaff/isClubMember`. `cardKindOf` normaliza undefined/null/'' → `'autonomo'` (default de BD), así una card legacy nunca se confunde con player.
- **`lib/pii-crypto.js`** — **decisión de implementación**: la fecha de nacimiento se cifra con **AES-256-GCM en Node** (no pgcrypto DB-side). Motivo: pgcrypto vía supabase-js exigiría funciones SQL SECURITY DEFINER y pasar la clave a la BD en cada query; con AES app-side la clave nunca sale del entorno Netlify y es testeable offline. La columna sigue siendo `bytea` (se guarda el blob `[iv|authTag|ciphertext]` como hex `\x…`). `CANTERA_PII_KEY` se lee LAZY (importar el módulo nunca rompe si falta la env var). `decryptBirthDate` es defensivo (devuelve null, no lanza). `birthYearFromDate` puebla el `birth_year` en claro.
- **`lib/sports-categories.js`** — resuelve categoría desde `birth_year` + offsets del catálogo, relativos al año de inicio de temporada (`categoryForBirthYear`). `currentSeasonStartYear` usa cutoff julio (temporada española arranca en verano). `parseSeasonStartYear`/`formatSeason` manejan `YYYY-YY`. `listSportsCategories(db, sport)` carga el catálogo ordenado.
- **`lib/external-payments.js`** — `PAYMENT_METHODS` + `buildPaymentRow` (valida/normaliza, devuelve `{row,error}` sin tocar BD) + `recordExternalPayment` (inserta tras validar) + `listPaymentsByClub`/`listPaymentsByCard`. Period opcional `YYYY-MM`, amount entero ≥ 0, currency default `eur`.

**Ownership y portabilidad de la card**:

La card pertenece al jugador, no al club. Cuando un chaval cambia de club, su `cards` row no se duplica — viaja con él. Lo que cambia es:

1. `member_club_seasons` cierra la fila vieja (`left_at = NOW()`, `exit_reason = 'fichaje'`, `closed_snapshot_jsonb` = stats finales).
2. Inserta fila nueva (mismo `card_slug`, nuevo `organization_id`, dorsal/categoría del club nuevo).
3. `cards.organization_id` se actualiza al nuevo club.
4. `card_consents` recibe insert con `consent_type = 'club_handoff'` y `related_club_id = club_anterior`.

Las 4 ops viven en una transacción. El visit log (`visits`), foto, edit_tokens de los tutores y todo el histórico previo queda intacto.

**Roles y permisos**:

- **Tutor legal** (padre/madre con potestad) — admin completo de la card del menor mientras éste no haya transferido la titularidad. Aprueba handoffs entre clubes. Único que puede ejercer `delete-account` y `export-data` para datos del menor.
- **Tutor secundario** (segundo progenitor, abuelo, tutor pedagógico) — admin compartido. Puede editar foto/datos, no puede aprobar handoff ni ejercer derechos LOPD.
- **Club admin** — escribe `dorsal`, `category`, `position`, `team_name`, `stats_jsonb` mientras la membership esté activa. No toca nombre, foto ni datos del menor. Pierde acceso al cerrar `left_at`.
- **Player self** — se activa a los 16 años con opt-in parental (`consent_type='transfer_to_player'`). Los tutores NO se revocan automáticamente; el chaval decide si los mantiene o no.

**Consentimiento parental LOPDGDD (art. 7 LO 3/2018)**:

Doble verificación obligatoria antes de marcar `public_card=true`, antes del primer handoff y antes de cualquier `image_rights`. Mecanismo: (1) click en magic-link enviado al `tutor_legal.email`, (2) confirmación adicional via code SMS al teléfono que el club registró al fichar o validación NIF parcial. Sólo entonces se inserta `card_consents` con `granted_by_email`, `ip_address`, `user_agent` y `evidence_jsonb` con snapshot del documento aceptado + hash. El audit trail es append-only por construcción RLS.

**Implementación (capa 3c)** — `parent-consent.js` (`POST /api/parent-consent`) + `lib/consent.js`. Auth parent-panel (1er factor = control del email). **2º factor MVP = la fecha de nacimiento del menor** (`body.birth_date`, verificada contra `birth_date_encrypted` vía `lib/pii-crypto`, con fallback a `birth_year` si no hay `CANTERA_PII_KEY`): es el dato que el club registró al fichar, un factor de conocimiento sin infra extra, **reemplazable/reforzable por OTP SMS** cuando se cablee un proveedor (solo toca `lib/consent.verifySecondFactor`). Tipos que concede el tutor: `parental_initial`, `data_processing`, `public_visibility` (pone `cards.public_card=true`), `image_rights`. `lib/consent.recordConsent` inserta en `card_consents` con `evidence_jsonb` = `{document_version, document_hash (sha256), second_factor, accepted_at, ip_address, user_agent}`. El gate del 2º factor también se aplica en **`accept-transfer`** (el handoff exige doble verificación): sin `birth_date` correcto, el traspaso no se ejecuta. `club_handoff` lo graba la RPC de 3b; `transfer_to_player` (opt-in jugador 16+) queda fuera de MVP.

**Cobros · Stripe Connect (capa 4)**:

- **Onboarding (capa 4a)** — `stripe-connect-onboard.js` (`POST /api/stripe-connect-onboard`, auth org-panel del club, solo `kind='sports_club'`). Connect **Standard** (NIF/IBAN/responsabilidad fiscal del club; PerfilaPro cobra `application_fee` sobre las cuotas). Onboarding **API-based vía Account Links** (no OAuth → no necesita `STRIPE_CONNECT_CLIENT_ID`): `action:'onboard'` crea la cuenta `standard` si falta (persiste `stripe_connect_account_id`) y devuelve un Account Link hospedado; `action:'status'` hace retrieve y persiste `stripe_connect_charges_enabled`/`payouts_enabled`. 503 si Stripe no está configurado. El Studio (capa 6) consumirá ambos. La frescura proactiva de los flags vendrá del evento `account.updated` en la capa 4d.
- **Cuota mensual padre→club (capa 4b)** — `create-parent-checkout.js` (`POST /api/create-parent-checkout`, auth parent-panel del tutor). Q3=voluntario: el tutor activa la cuota de su hijo/a desde el panel. Checkout Session en modo `subscription` como **direct charge sobre la cuenta conectada del club** (header `stripeAccount`), con `price_data` inline (€ mensual = `organizations.cantera_monthly_fee_cents`, migración 036) y `application_fee_percent = STRIPE_PLATFORM_FEE_BPS/100` (omitido si 0). 409 si el club no está conectado / sin `charges_enabled` / sin cuota configurada / ya hay cuota activa para el jugador. La fila `parent_subscriptions` la materializa el webhook (capa 4d); aquí solo se genera la sesión. La cuota por club (no por categoría) es MVP; per-categoría es refinamiento futuro.
- **Setup-fee carnet + cobros manuales (capa 4c)** — `create-setup-fee-checkout.js` (auth org-panel): el club paga a PerfilaPro la impresión de carnets PVC+NFC (12€ setup / 6€ renovación, Stripe Price IDs `STRIPE_PRICE_PLAYER_SETUP_FEE`/`_RENEWAL`) en una Checkout Session modo `payment` **directa a la plataforma** (no Connect), `quantity` = nº de jugadores válidos del club. Crea filas `card_print_orders` `pending` enlazadas a la sesión (`stripe_payment_intent_id=session.id`); el webhook (4d) las marca `paid`. `record-external-payment.js` (auth org-panel, acciones `record`/`list`) registra cobros manuales Bizum/efectivo/transferencia en `external_payments` (vía `lib/external-payments`), `recorded_by='org:<slug>'`, solo jugadores del propio club — NO mueve dinero, es la "lista de quién pagó" que une Stripe + manual en la pestaña Cobros.
- **Eventos webhook Connect (capa 4d)** — `lib/cantera-webhook.js`, enrutado desde `stripe-webhook.js` ANTES del carril B2B/autónomo. Verificación de firma **dual**: primero `STRIPE_WEBHOOK_SECRET`, fallback a `STRIPE_CONNECT_WEBHOOK_SECRET` (las cuotas direct-charge llegan desde cuentas conectadas y pueden ir firmadas con secreto separado). Eventos: `account.updated` → refresca `stripe_connect_charges_enabled`/`payouts_enabled` del club; `checkout.session.completed kind=cantera-parent-fee` → upsert `parent_subscriptions` (idempotente por `stripe_subscription_id`); `customer.subscription.{created,updated,deleted}` con `metadata.kind=cantera-parent-fee` → estado/periodo/importe (deleted → `canceled`); `checkout.session.completed kind=cantera-print` → marca `card_print_orders` `paid` por `stripe_payment_intent_id=session.id`; `invoice.paid` de cuota padre se reconoce (`subscription_details.metadata`) y se ACKea sin tocar el handler B2B. Sin migración ni route nueva (reusa el endpoint webhook existente).

**Plan de pagos a medida cobrado por Stripe (migración 039 · 4 fases)**:

El plan de pagos a medida de la campaña (conceptos con fecha en `enrollment_campaigns.concepts_jsonb`) se puede cobrar por Stripe Connect (no solo manual), para que el dinero — y la `application_fee` — pase por Stripe. **Manual (`external_payments`) sigue como alternativa** para clubes sin Stripe.

- **`enrollment_charges` (migración 039)** — un cargo por concepto y jugador: `concepto`, `amount_cents`, `due_date`, `status` (`scheduled`/`processing`/`paid`/`failed`/`canceled`/`manual`), `application_fee_cents` (snapshot), `stripe_customer_id`, `stripe_payment_method_id` (mandato guardado), `stripe_payment_intent_id`. RLS on + REVOKE. Índice parcial `(due_date) WHERE status='scheduled'` para el cron.
- **`lib/enrollment-charges.js`** (puro) — `splitPlanByDue` (qué vence ya vs futuro, ventana 14 días), `buildChargeRows`, `applicationFeeCents`, `sumCents`.
- **Inscripción online (Fase 2)** — cuando el club tiene Connect activo y la campaña tiene plan, `enrollment-page` ofrece "pagar online (SEPA/tarjeta)". `create-enrollment-checkout` detecta el plan → materializa los `enrollment_charges` (todos `scheduled`) y abre un Checkout `kind='cantera-plan'`: modo `payment` que cobra lo que vence ya **con `setup_future_usage='off_session'`** (guarda el mandato) + `application_fee_amount`; modo `setup` si nada vence aún. Idempotente por jugador.
- **Webhook (`lib/cantera-webhook.handlePlanCheckoutCompleted`)** — `checkout.session.completed kind=cantera-plan`: resuelve el `payment_method` (vía PI/SetupIntent en `event.account`), lo guarda + `customer` en los cargos del jugador, y marca `paid` los que vencían ya.
- **Cron (Fase 3, `charge-due-enrollment-concepts`)** — diario 06:00: cobra los `scheduled` vencidos con mandato (PaymentIntent off-session, `idempotencyKey` por cargo). `handlePlanPaymentIntent` cierra el estado en `payment_intent.succeeded/payment_failed` (metadata `kind=cantera-plan` + `charge_id`) — cubre tarjeta y la liquidación SEPA diferida (`processing` → `paid`/`failed`).
- **Cobros (Fase 4)** — acción org-panel `plan_charges` agrupa los cargos por jugador (estado por concepto + cobrado/total); `panel.html` lo pinta en la pestaña Cobros con un pill por concepto (✅ pagado · ⏳ programado · ⌛ en curso · ⚠️ fallido).

**Matriz de Cobros consciente del modelo (migración 042)** — la "Matriz de la temporada" de la pestaña Cobros se adapta al modelo de cobro del club, que fija la campaña (`enrollment_campaigns`): si la campaña tiene un plan a medida (`concepts_jsonb.plan`), `billing_matrix` devuelve `model:'plan'` con una **columna por concepto** (Inscripción, Material, 2º plazo…) en vez de por mes; si no, `model:'monthly'` con la rejilla mensual de siempre (matrícula + N mensualidades). En modo plan, el estado de cada concepto concilia dos fuentes casadas por nombre de concepto: `enrollment_charges` (Stripe, estado granular paid/scheduled/processing/failed) y `external_payments.concepto` (cobros manuales Bizum/efectivo apuntados a ese concepto). El modal "Apuntar pago manual" muestra un selector de concepto en lugar del campo de mes cuando el club está en modelo plan, y `record-external-payment` persiste `concepto`. Así un club tipo *Murcia Promesas* ve su propia estructura de cobro en vez de la rejilla de mensualidades genérica.

Los **KPIs de la pestaña Cobros y la tabla "Estado por jugador"** también ramifican por modelo: `get_club_stats` carga la campaña abierta y, si lleva plan, devuelve `payments.model='plan'` con la semántica del plan en vez de la mensual — "Al día"→**Plan completo** (jugadores con todos los conceptos pagados), "Pendientes"→**Plan pendiente**, "MRR estimado"→**Recaudado** (`collected_cents`), "Cobertura"→**cobertura del plan** (`collected_cents ÷ expected_cents`, con `expected_cents = plan_total × nº jugadores`), más `concepts_paid/concepts_total` y un array `players[]` con el progreso por jugador (`status` paid/partial/pending + `concepts_paid/concepts_total` + cobrado/total). La tabla "Estado por jugador" pasa a columnas Jugador · Categoría · Plan (X/Y conceptos) · Cobrado/Total. La reconciliación reusa `computePlanBilling` (Stripe `enrollment_charges` + `external_payments.concepto`), el mismo núcleo que la matriz. Sin plan, `payments.model='monthly'` y los KPIs mensuales (cuota/MRR del periodo vigente) quedan idénticos. Los chips de cobros de la pestaña Estadísticas (`renderClubStats`) se adaptan al mismo `payments.model`.

**Carnet físico PVC + NFC**:

`printable-card-utils.js` extendido con `buildPlayerCardPVC({ card, club, season, nfcUrl })` — formato ISO 7810 (85×55mm, mismas dims que la tarjeta de visita B2B), branded con `color_primary` del club, escudo (logo_url fetcheado defensivo), foto del jugador (`card.foto_url`), dorsal grande, categoría/equipo y QR que apunta a `/c/:slug` (objetivo del NFC). `buildPlayerCardsBookletPDF({ players, club, siteUrl })` genera el booklet multi-página (un carnet por jugador, escudo cacheado una vez, fotos en paralelo). Setup fee 12€ por fichaje / 6€ renovación los cobra la capa 4c.

**Export e impresión (capa 5)** — `print-order-export.js` (`POST /api/print-order-export`, auth founder password+TOTP): `format='csv'` (default) devuelve el lote de `card_print_orders` filtrado por `status` (default `paid`) y opcional `org_slug`, con el nombre del jugador resuelto — es el CSV que el founder manda a la imprenta (`PRINT_PROVIDER='manual'`); `format='pdf'` arma el booklet de carnets (`buildPlayerCardsBookletPDF`) para los pedidos del club, devuelto como `pdf_base64`. `nfc-register.js` (`POST /api/nfc-register`, auth founder): el operario registra el `nfc_uid` del chip al impresionar (por `order_id` o último pedido del `card_slug`), avanza el estado a `sent_to_printer`; colisión de UID (índice único parcial de la 033) → 409.

**Studio del club** (`/panel.html` con `org.kind='sports_club'`):

Tabs: Plantilla (acordeón de categorías + grid de jugadores/staff por categoría con dorsal/cuota), Stats (KPIs club + partidos), Fichajes (bandeja entrante/saliente + form alta), Carnets (impresión batch + tracking), Cobros (MRR del club + status cuotas + onboarding Stripe Connect), Branding (escudo + colores, reusa B2B), ⚙ (legal + cuota por categoría + invitar otros admins). La barra de pestañas reflota a varias filas en móvil (`flex-wrap` bajo `@media (max-width:600px)`) — antes desbordaba en horizontal sin affordance y Carnets/Cobros/Branding quedaban ocultas.

**Modelo de cobro único en Inscripciones** — el club elige UN modelo con el selector `#enrModel`: **plan de pagos a medida** (conceptos con fecha, cobrable por Stripe) o **cuota mensual simple** (matrícula + mensualidades). `applyEnrollModel()` muestra solo los campos del modelo activo (`#enrPlan` vs `#enrMonthlyFields`); al abrir la campaña el modelo queda fijado por sus datos (concepts presentes → plan) y el selector se bloquea. El handler de "Abrir inscripciones" envía únicamente los campos del modelo elegido (plan → solo `concepts`, exige ≥1; mensual → matrícula/cuota/mensualidades + `concepts:[]`), así la campaña abierta nunca queda con los dos modelos mezclados.

**Equipos gestionados del club (migraciones 040 + 041)** — el coordinador define los equipos reales del club, pero un equipo NO es texto libre: es **el club encuadrado en una competición** del cuadro federativo (la competición ya define la categoría de edad). Tabla `club_teams` (`organization_id`, `name` —derivado—, `category_id` FK → `sports_categories` nullable, `competition_id` FK → `sports_competitions`, `label` sufijo A/B, `color` opcional `#RRGGBB`, `sort_order`, soft-delete) + columna `member_club_seasons.team_id` (FK → `club_teams`, `ON DELETE SET NULL`). `team_name` se conserva como **espejo denormalizado** (lo leen `billing_matrix`/CSV): cuando hay `team_id`, `org-panel` sincroniza `team_name`; sin `team_id`, el texto libre antiguo se sigue mostrando.

**Catálogo de competiciones (migración 041)** — `sports_competitions` es un catálogo de lectura pública (mismo patrón que `sports_categories`) sembrado con el cuadro de la Federación de Murcia, masculino + femenino: `sport`, `region` ('murcia'), `gender` ('M'/'F'/'X'), `category_group` (cabecera 'Cadetes', 'Femenino'…), `category_id` (FK → `sports_categories`, NULL cuando la competición cruza edades), `name` ('Primera Cadete'), `format` ('F-11'/'F-8'/'F-9'/'F-5'), `sort_order`. El equipo se crea eligiendo una competición; nombre = `name` + `label` opcional, categoría = la de la competición.
- Backend (`org-panel.js`, auth org-panel, gate flag + `sports_club`): acciones `teams_list` / `team_create` (recibe `competition_id` + `label` + `color`, deriva nombre y categoría) / `team_update` (recalcula nombre desde la competición resultante) / `team_delete` (soft-delete + desasigna `team_id=team_name=NULL`). `get_roster` devuelve `teams` (con `category_name`, `competition_id`, `label`, `player_count`) y `competitions` (catálogo agrupado para el desplegable), y resuelve `team_name` desde `team_id`. `enrollment_assign` acepta `team_id` por jugador, valida que pertenece a ESTE club (cross-club → fila fallida) y denormaliza `team_name`. Validaciones puras en `lib/club-teams.js` (`normalizeTeamColor` hex, `normalizeTeamLabel` ≤8, `isValidTeamId` uuid).
- Frontend (pestaña Plantilla): bloque plegable **"⚙ Gestionar equipos"** donde se crea/edita cada equipo con un **`<select>` agrupado de competiciones** (optgroups = `category_group`) + etiqueta A/B + color (CRUD inline) + **barra de filtros** (buscar por nombre · equipo · categoría · estado de cuota, client-side sin re-render) + **toggle "Agrupar por: Categoría ▸ Equipo"**. La columna **Equipo** del roster es un `<select>` con los equipos de la categoría del jugador (los de categoría NULL —competición que cruza edades— aparecen para todos) + "Sin equipo"; el encuadre en lote envía `team_id`.

**Panel del padre** (`/panel.html` con JWT de `card_admins`):

Vista simple: card del hijo (o tabs si tiene varios hijos), stats temporada, histórico de clubes. Banner contextual cuando llega solicitud de handoff con doble verificación inline.

El bloque de cobro se reconcilia con el modelo del club (`parent-data` devuelve `child.plan`): si hay **plan de pagos** (cargos materializados en `enrollment_charges` o campaña abierta con conceptos), oculta "Cuota mensual"/"Estado del pago" y pinta el desglose por concepto con su estado (✅/⏳/⌛/⚠️) + cobrado/total; el botón "Pagar el plan de la temporada" (solo cuando `plan.payable`, i.e. aún sin cargos) llama a `create-enrollment-checkout` con `campaign_id`. Si es **cuota mensual**, mantiene los campos de cuota + "Pagar la cuota con tarjeta" (sin `campaign_id`). El padre **ya no puede dar de baja del club** desde su panel (la baja la tramita el club ante la federación): `cancel-membership` queda restringido a auth org-panel; los derechos LOPD (exportar/borrar datos del menor) se conservan aparte por la vía del edit-token.

**Auth del tutor (capa 2)** — `parent-auth.js` (`POST /api/parent-auth { email, idioma? }`) es el espejo de `panel-auth.js` para padres/tutores. Magic-link passwordless: si el email coincide con al menos un `card_admins` activo de rol `tutor_legal`/`tutor_secundario`/`player_self` (NO `club_admin` — ése entra por el Studio B2B), firma un JWT `purpose:'parent-panel'` (TTL 7d, secreto `PARENT_PANEL_JWT_SECRET` con fallback `ORG_PANEL_JWT_SECRET` → `AGENT_JWT_SECRET`) y manda `${SITE_URL}/panel.html?session=<jwt>`. La sesión está scoped al **email**, no a una card: un tutor con varios hijos administra todas las cards donde aparece con ese email. Siempre devuelve 200 (anti-enumeration, igual que `send-edit-link`/`panel-auth`); gateado por `isCanteraActive()` (410 si el carril está off); rate-limit 5 req / 10 min / IP. Las primitivas JWT (`signParentSession`/`verifyParentSession`/`parentAuthFromEvent`) viven en `lib/panel-auth.js` junto a las de org, aisladas por el claim `purpose` (un token org-panel nunca verifica como parent-panel y viceversa).

**Alta de jugador/staff (capa 3a)** — `register-player.js` (`POST /api/register-player`). Lo llama el admin del club desde el Studio (auth JWT **org-panel**, scoped a `session.orgId`; el alta queda forzosamente atada a ese club). Crea: (1) una `cards` con `card_kind='player'` (o `'club_staff'` si `role!='jugador'`), slug **opaco `p-xxxxxxxx`** (anti-doxxing de menores, NO derivado del nombre), `public_card=false` (el menor no es público hasta consentimiento, capa 3c), `birth_year` en claro + `birth_date_encrypted` (si `CANTERA_PII_KEY` está configurada, vía `lib/pii-crypto`); (2) una fila `member_club_seasons` de la temporada vigente (cutoff julio) con dorsal/posición/categoría — la categoría se resuelve con `lib/sports-categories` desde `birth_year` + `organizations.sport`; (3) los `card_admins` (tutor legal obligatorio + tutor secundario opcional, cada uno con su `edit_token`). Cubre dos de los tres caminos del fichaje: **nuevo en plataforma** y **llega de club off-platform** (campo libre `previous_club_name`); el tercero (handoff entre clubes PerfilaPro) es la capa 3b sobre una card existente — `register-player` SIEMPRE crea card nueva. Email best-effort al tutor legal con magic-link parent-panel. Sin transacción multi-statement en la Data API: ante fallo de membership o admins se compensa borrando la card (FK `ON DELETE CASCADE`). Gateado por `isCanteraActive()` (410 off).

**Handoff transaccional entre clubes (capa 3b · migración 035)** — el traspaso de un jugador de un club PerfilaPro a otro (camino 2 del fichaje). A diferencia del alta (3a, compensación app-side), la atomicidad vive en **funciones `SECURITY DEFINER` que corren en una sola transacción Postgres** — un fallo a media operación revierte todo. Migración 035 crea `club_transfers` (solicitud `pending`/`accepted`/`cancelled`/`rejected`, único índice parcial de un pendiente por jugador) + dos RPCs:
- `cantera_execute_transfer(p_transfer_id, p_actor_email, p_actor_role)` — cierra la `member_club_seasons` activa (snapshot inmutable, `exit_reason='fichaje'`), resuelve la categoría en el club nuevo (birth_year + offsets), abre la membresía nueva, actualiza `cards.organization_id` y graba `card_consents(club_handoff)`.
- `cantera_close_membership(p_card_slug, p_exit_reason, p_actor_email)` — cierra la membresía y deja la card sin club activo (baja / fichaje off-platform), cancelando cualquier traspaso pendiente.

Flujo: el club que ficha llama `request-transfer.js` (auth org-panel; valida player con membresía activa en OTRO club; crea `club_transfers pending`; avisa al tutor con magic-link). El **tutor legal** aprueba con `accept-transfer.js` (auth parent-panel; verifica `tutor_legal` activo; dispara `cantera_execute_transfer`). `cancel-membership.js` (auth **solo org-panel** del club dueño — el founder impersonando al club llega con el mismo `purpose`; el tutor NO da de baja desde su panel, la baja la tramita el club ante la federación) cierra la membresía vía `cantera_close_membership` (jugador) o app-side (cuerpo técnico, la RPC es player-only). La migración 035 amplía el CHECK de `card_consents.granted_by_role` con `'founder'` para el override de admin-orgs (`transfer_resolve`). La 2ª verificación LOPDGDD (SMS/NIF) sobre `accept-transfer` la añade la capa 3c; hoy la prueba de identidad del tutor es el control del email (magic-link). Las RPCs se invocan solo desde service_role (`REVOKE ... FROM PUBLIC` + `GRANT EXECUTE TO service_role`).

**Tres operaciones distintas sobre la plantilla (no mezclar)** — el front del club las separa por diseño: (1) **cambiar de equipo** dentro del club = desplegable Equipo + `enrollment_assign` → NO cierra membresía, NO toca cobro; (2) **baja del club** = botón "Baja" (`cancel-membership`) / consola founder (`cantera_close_membership`) → cierra membresía Y desconecta el cobro; (3) **traspaso a otro club** = `cantera_execute_transfer` → el jugador sigue activo en otro club, NO se desconecta cobro aquí (lo monta el club nuevo). El roster (`getRoster`), KPIs (`get_club_stats`), Cobros (`billing_matrix`) y el contador de inscripciones (`enrollment_get`) filtran todos `left_at IS NULL`, así que una baja desaparece de todas las vistas a la vez.

**Teardown de cobro en la baja** (`lib/cantera-billing-teardown.js → teardownPlayerBilling`): SOLO se invoca en la baja del club (cancel-membership camino jugador + founder `cantera_close_membership`), nunca en cambio de equipo ni traspaso. Scoped a `(card_slug, organization_id)`: (a) `enrollment_charges` `scheduled` → `canceled` (plazos futuros del plan sin cobrar; no toca paid/processing/failed); (b) `parent_subscriptions` activas → `stripe.subscriptions.cancel(sub, {stripeAccount})` en la cuenta Connect del club + marca `canceled`. Best-effort y honesto: si Stripe falla o no se puede cancelar (sin cliente/cuenta) NO marca `canceled` (mentiría: Stripe seguiría cobrando) e incrementa `sub_errors`; la baja se completa igual. La respuesta devuelve `{ billing: { charges_canceled, subs_canceled, sub_errors } }` y el front lo muestra en el toast. `cancel-membership` y `admin-orgs` reciben el cliente Stripe inyectable (`makeHandler(db, stripe)` / `makeHandler(db, emailClient, stripe)`).

**Env vars Cantera** (todas opcionales — el carril se apaga limpio borrándolas):

```
CANTERA_VERTICAL_ACTIVE          # "1" enciende. Sin ella, endpoints devuelven 410 Gone.
CANTERA_PII_KEY                  # AES key (32 bytes hex, `openssl rand -hex 32`) para AES-256-GCM app-side sobre birth_date_encrypted (lib/pii-crypto.js). NO rotar con datos cifrados sin re-cifrar.
STRIPE_CONNECT_CLIENT_ID         # OAuth client ID Standard accounts.
STRIPE_CONNECT_WEBHOOK_SECRET    # Webhook secret separado para eventos Connect.
STRIPE_PLATFORM_FEE_BPS          # bps comisión platform sobre cuota padre. Default 0.
CANTERA_CARNET_FEE_CENTS         # Carnet embebido: importe (céntimos) que PerfilaPro skimea del primer pago del plan vía application_fee. Default 0 (off → carnet por fallback al club). Ej. 1200 = 12€.
STRIPE_PRICE_PLAYER_SETUP_FEE    # 12€ carnet setup.
STRIPE_PRICE_PLAYER_RENEWAL      # 6€ renovación anual.
STRIPE_PRICE_PARENT_PREMIUM      # 4-6€/mes premium padre (opcional Sprint 2).
STRIPE_PRICE_CARD_MAINTENANCE    # 1€/mes mantenimiento entre clubes (opcional Sprint 2).
PRINT_PROVIDER                   # 'manual' (founder exporta CSV) | 'helloprint' | 'tarjetasdpvc'.
PRINT_PROVIDER_API_KEY           # sólo si PRINT_PROVIDER != 'manual'.
PARENT_PANEL_JWT_SECRET          # fallback a ORG_PANEL_JWT_SECRET si no está.
```

**Reversibilidad**:

- Apagado runtime: borrar `CANTERA_VERTICAL_ACTIVE`. Las orgs `kind='sports_club'` siguen existiendo pero ningún endpoint del carril responde.
- Apagado quirúrgico (pieza a pieza): borrar la env var del precio Stripe correspondiente o de la pieza concreta. Por ejemplo `PRINT_PROVIDER` vacío → carnet físico off.
- Apagado total: contramigración SQL al final de `033_cantera_v1.sql` (DROP en orden inverso). Cero efecto sobre autónomos y B2B genérico — `card_kind` default `'autonomo'` y `organizations.kind` nullable preservan el comportamiento legacy.

**Fuera de scope MVP** (deuda consciente):

- W3C Verifiable Credentials firmadas — el `card_consents.evidence_jsonb` es preparación; firma + DID llega en fase 2.
- `org_admins` con permisos diferenciados dentro del club (presidente vs coordinador vs entrenador) — modelo actual asume 1 admin por club.
- Integración federativa autonómica — fase 2 cuando haya primera federación firmada.
- Sincronización con Verifactu/Quipu del cobro padre→club — la factura SEPA al padre la emite el club fuera de PerfilaPro hasta Sprint 3.
- App nativa móvil — todo email + web al menos 12 meses.
- Marketplace de ojeadores, vídeo highlights, multi-idioma fuera es/ca — explícitamente post-MVP.

### Environment variables required

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASE
STRIPE_PRICE_PRO
STRIPE_PRICE_MONTHLY  # Legacy dormido (sprint 3 antiguo) — no usado por carril B2B
STRIPE_PRICE_ANNUAL   # Legacy dormido (sprint 3 antiguo) — no usado por carril B2B
STRIPE_PRICE_TEAM_MONTHLY  # Bloque A B2B — €/profesional/mes, tier Team
STRIPE_PRICE_TEAM_ANNUAL   # Bloque A B2B — €/profesional/año, tier Team
STRIPE_PRICE_ORG_MONTHLY   # Bloque A B2B — €/profesional/mes, tier Organización
STRIPE_PRICE_ORG_ANNUAL    # Bloque A B2B — €/profesional/año, tier Organización
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_PASSWORD
ADMIN_TOTP_SECRET     # optional — enables TOTP 2FA for admin panel
ADMIN_JWT_SECRET      # signs admin session JWT (fallback: AGENT_JWT_SECRET)
ADMIN_SESSION_TTL_MINUTES # optional — admin session TTL, default 60, min 5
RESEND_API_KEY
GEMINI_API_KEY        # Google AI Studio — used by lab-gemini + seed regeneration. Empty disables those tools.
SITE_URL              # e.g. https://perfilapro.es
AGENT_JWT_SECRET      # signs agent JWT tokens
ORG_PANEL_JWT_SECRET  # signs B2B client panel JWT (fallback: AGENT_JWT_SECRET)
POSTHOG_API_KEY       # PostHog project key — empty disables analytics
POSTHOG_HOST          # default https://eu.i.posthog.com
B2B_LEAD_INBOX        # email que recibe los leads del form /es/empresas y /ca/empresas
LAUNCH_PROMO_ACTIVE   # "1" activa la promo de lanzamiento 100% bonificada
DEMO_FUNNEL_FREE_ACTIVE # "1" activa Pro gratis para usuarios que entran a /alta vía ?via=demo-*
WEB_FUNNEL_FREE_ACTIVE # "1" activa Pro gratis para TODA alta orgánica (wedge B2C → B2B)
QUIPU_CLIENT_ID       # Sprint 3 — Verifactu/AEAT invoice provider
QUIPU_CLIENT_SECRET   # Sprint 3
QUIPU_API_BASE        # Sprint 3 — default https://getquipu.com/api/v2
QUIPU_ENV             # Sprint 3 — sandbox | production
```

### URL routing (netlify.toml)

| Public path | Netlify Function |
|---|---|
| `/c/:slug` | `card` |
| `/e/:slug` | `org` |
| `/api/create-checkout` | `create-checkout` |
| `/api/create-org-checkout` | `create-org-checkout` |
| `/api/stripe-webhook` | `stripe-webhook` |
| `/api/admin-data` | `admin-data` |
| `/api/admin-actions` | `admin-actions` |
| `/api/admin-invoices` | `admin-invoices` |
| `/api/admin-agents` | `admin-agents` |
| `/api/admin-orgs` | `admin-orgs` |
| `/e/:slug/stats` | `org-stats-page` |
| `/api/org-stats` | `org-stats` |
| `/api/upload-org-logo` | `upload-org-logo` |
| `/api/upload-org-logo-panel` | `upload-org-logo-panel` |
| `/panel` (→ `/panel.html`) | (static) |
| `/api/panel-auth` | `panel-auth` |
| `/api/org-panel` | `org-panel` |
| `/api/lead-b2b` | `lead-b2b` |
| `/api/legal-settings` | `legal-settings` |
| `/api/card-status` | `card-status` |
| `/api/edit-card` | `edit-card` |
| `/api/send-edit-link` | `send-edit-link` |
| `/api/upload-avatar` | `upload-avatar` |
| `/api/agent-auth` | `agent-auth` |
| `/api/agent-data` | `agent-data` |
| `/api/resend-invoice` | `resend-invoice` |
| `/api/export-data` | `export-data` |
| `/api/delete-account` | `delete-account` |
| `/api/analytics-config` | `analytics-config` |
| `/api/download-card` | `download-card` |
| `/api/download-qr` | `download-qr` |
| `/api/resend-kit` | `resend-kit` |
| `/api/claim-launch-promo` | `claim-launch-promo` |
| `/api/activate-demo` | `activate-demo` |
| `/api/register-free` | `register-free` |
| `/api/register-b2b` | `register-b2b` |
| `/api/ocupaciones-search` | `ocupaciones-search` |
| `/api/cp-lookup` | `cp-lookup` |
| `/api/parent-auth` | `parent-auth` (CANTERA) |
| `/api/register-player` | `register-player` (CANTERA) |
| `/api/request-transfer` | `request-transfer` (CANTERA) |
| `/api/accept-transfer` | `accept-transfer` (CANTERA) |
| `/api/cancel-membership` | `cancel-membership` (CANTERA) |
| `/api/parent-consent` | `parent-consent` (CANTERA) |
| `/api/stripe-connect-onboard` | `stripe-connect-onboard` (CANTERA) |
| `/api/create-parent-checkout` | `create-parent-checkout` (CANTERA) |
| `/api/create-setup-fee-checkout` | `create-setup-fee-checkout` (CANTERA) |
| `/api/record-external-payment` | `record-external-payment` (CANTERA) |
| `/api/print-order-export` | `print-order-export` (CANTERA) |
| `/api/nfc-register` | `nfc-register` (CANTERA) |
| `/api/create-enrollment-checkout` | `create-enrollment-checkout` (CANTERA · inscripción) |
| `/api/enrollment-submit` | `enrollment-submit` (CANTERA · inscripción) |
| `/{es,ca}/inscripcion/:token` | `enrollment-page` (CANTERA · inscripción) |

### Internacionalización (es / ca)

PerfilaPro sirve dos idiomas: español (default) y catalán. Estructura:

- **Archivos**: las páginas client-facing viven bajo `public/es/*.html` y `public/ca/*.html` (mismos nombres de archivo). Las URLs son `/es/alta`, `/ca/alta`, etc. (Netlify pretty URLs sin `.html`).
- **Detección de idioma en `/`**: edge function `netlify/edge-functions/lang-detect.js` intercepta la raíz, lee cookie `pp_lang` o `Accept-Language` (catalán solo si es la primera preferencia del navegador) y redirige 302 a `/es/` o `/ca/`.
- **Legacy redirects**: 14 reglas 301 en `netlify.toml` mapean `/alta`, `/alta.html`, `/editar`, `/editar.html`, etc. a su equivalente bajo `/es/` para preservar links externos antiguos y emails enviados antes de la migración. URLs con query string (ej. `/editar?slug=&token=`) las preserva Netlify automáticamente.
- **SEO multilingüe**: cada HTML lleva `<link rel="alternate" hreflang="es|ca|x-default" href="...">` + `<link rel="canonical" href="...">` apuntando a la versión absoluta en `https://perfilapro.es/{lang}/{page}`.

**Cards.idioma** (migración 017) — cada autónomo tiene un idioma persistente:
- `idioma text NOT NULL DEFAULT 'es' CHECK (idioma IN ('es','ca'))`
- Lo elige el front (alta.html `/es/` o `/ca/` envía `idioma` en el JSON del POST a `/api/register-free` o `/api/create-checkout`).
- `create-checkout` lo añade a `session.metadata.idioma` y ajusta `success_url`/`cancel_url` a `${siteUrl}/${idioma}/success`.
- `stripe-webhook` lo lee de la metadata y lo upserta en `cards`.
- `card.js` lee `data.idioma` para renderizar la tarjeta pública (`/c/:slug`) en el idioma del autónomo — independientemente del idioma del visitante. Usa el dict `CARD_T = { es:{...}, ca:{...} }` para todas las strings (HTML + JS embebido + WhatsApp pre-fill + og:locale).
- Migración añade el campo con default `'es'`, así que perfiles pre-017 conservan el comportamiento actual.

**Emails transaccionales** (todos respetan `cards.idioma`):
- `lib/email-layout.js` acepta `opts.idioma` y traduce header tagline + footer + enlaces legales (`/${lang}/terminos`, etc.).
- Cada función tiene su propio dict de strings (`*_STRINGS = { es: {...}, ca: {...} }`) y recibe `idioma` desde el handler:
  - `stripe-webhook.buildEmail()` — `POST_PAY_EMAIL_STRINGS`, post-pago con kit + factura.
  - `register-free.buildWelcomeEmail()` — `WELCOME_EMAIL_STRINGS`, alta gratuita.
  - `remind-expiry.buildReminderEmail()` — `REMINDER_STRINGS`, urgencias 30/15/7 días + locale para `toLocaleDateString`.
  - `weekly-stats.buildStatsEmail()` — `STATS_STRINGS`, lunes Pro con visitas semana+mes.
  - `send-edit-link.buildEditLinkEmail()` — `EDIT_LINK_STRINGS`, enlace de edición (CTA → `/${lang}/editar`).
  - `resend-invoice` y `resend-kit` reusan `buildEmail()` / `sendConfirmationEmail()` y propagan `idioma`. El prefix admin se localiza también: `[Reenvío]` (es) / `[Reenviament]` (ca).

**Banner de privacidad** (`public/js/privacy-banner.js`): consciente del idioma — lee `document.documentElement.lang` y elige strings + link a privacidad en es o ca.

**Páginas legales**: las versiones `/ca/terminos`, `/ca/privacidad`, `/ca/legal` traducen el copy pero los datos del titular (nombre, NIF, dirección, email) se siguen cargando dinámicamente vía `/api/legal-settings` (no se traducen, son nombres propios).

**Fuera de scope inicial**: `directorio/` y los slugs SEO de directorio + `/p/:slug` (perfil-publico SEO) siguen monolingües en español. Admin (`admin.html`) y portal de agentes (`agente-login.html`, `agente.html`) tampoco se traducen — son back-office interno.

### Catálogo SEPE/SISPE de ocupaciones

**`ocupaciones` table** (migración 014) — catálogo oficial de ocupaciones del SEPE (CNO-SISPE 2011, 2.221 entradas de 8 dígitos en lenguaje natural). Mapeadas a sectores PerfilaPro vía mapping subgrupo→sector embebed en el procesamiento. Alimenta el autocomplete del picker `No me veo` en `alta.html`:

- `code` text PK (8 dígitos)
- `name` text
- `name_normalized` text (lowercase + sin acentos, indexado con GIN trigram para ILIKE rápido)
- `sector_slug` text (CHECK contra los 20 sectores internos)

`cards.ocupacion_code` (text, nullable) preserva el código si el alta usó el catálogo. El nombre canónico SEPE se persiste en `cards.specialty_custom` para que la tarjeta y la página pública muestren el oficio real (ej. "Mecánicos de Motor de Aviación").

`/api/ocupaciones-search?q=fonta&limit=10` (función `ocupaciones-search.js`) hace ILIKE doble pase (starts-with + contains) y devuelve top N. Cache CDN 5 min, rate limit 60 req / 10 min por IP.

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
