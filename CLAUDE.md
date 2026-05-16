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

**Demo funnel** (`DEMO_FUNNEL_FREE_ACTIVE=1`) — extensión opcional para que los usuarios reales que entran a `/alta` procedentes de una card demo completen la activación sin fricción de Stripe.

- Frontend (`alta.html` es + ca): lee `?via=demo-*` del URL y lo añade al payload de `register-free`. Si la respuesta lleva `demo_activated: true`, redirige directamente a `edit_url` saltándose la pantalla de éxito (el usuario aterriza viendo su perfil completo con QR + visitas + foto al top).
- Backend (`register-free.js`): si `via.startsWith('demo-')` y el grifo está abierto, después del INSERT delega en `lib/demo-activation.js` → `activateAndSendDemoKit()` (la misma función que usa `/api/activate-demo`). El welcome email free **se sustituye** por el email demo con tarjeta A6 adjunta — no se mandan dos correos.
- Cualquier valor que empiece por `demo-` activa (`demo-wa`, `demo-pill`, `demo-qr`, `demo-rastro`, etc) — sin tocar código se pueden añadir variantes para tracking de canal.
- Apagado: borrar `DEMO_FUNNEL_FREE_ACTIVE`. El frontend sigue mandando `via` pero el backend lo ignora, y el carril free normal (welcome email + banner upgrade Stripe en el editor) vuelve. Las cards ya activadas como demo conservan su `plan='pro'` y `expires_at`.
- Si la activación falla en BD (UPDATE error), el handler cae al carril free normal: la card ya existe como free, el usuario recibe welcome email genérico, no se pierde el alta.

**Diferencia con seed cards**: las cards demo-funnel tienen slugs normales (`pepito-perez`, no `demo-*`), así que NO muestran la pill "Ejemplo" en `/c/:slug`, NO mueven la foto al top en el editor, y SÍ se indexan en Google. Son cards reales de usuarios reales que recibieron Pro gratis como gancho de la campaña. La distinción es importante: el prefijo `demo-*` reserva los tres comportamientos visuales para el material de marketing del founder, no para usuarios captados.

**Eventos PostHog**:
- `whatsapp_click` con `via=demo-*` (desde `/c/demo-*`).
- `signup_completed_demo_funnel` con `via` y `sector` (desde `register-free`).
- `demo_activated` con `slug` y `email_sent` (desde `lib/demo-activation`).

### B2B demo (organizations + /e/:slug)

Sprint reversible para enseñar que PerfilaPro puede alojar un "equipo branded" de profesionales bajo una organización. Activa el scaffolding dormido de la migración 007 (`organizations` + `cards.organization_id`) añadiendo branding (logo + color + slug público + tagline) en migración 019.

**Flujo de gestión** (white-label, marca de cliente configurable sin tocar código):
- **B2B Demo Studio** en `/admin-orgs.html` — UI dedicada protegida por `ADMIN_PASSWORD` + TOTP. Permite crear/editar/eliminar orgs, subir logo con drag-and-drop, elegir color con picker nativo, asignar cards con selector buscable y ver vista previa en vivo de `/e/:slug` en un iframe lateral. Pensado para que el founder o admin demo monte una org branded en 30 segundos durante una conversación comercial.
- Endpoint `POST /api/admin-orgs` (acciones: `list`, `create`, `update`, `delete_org`, `assign_card`, `list_cards_for_assignment`, `org_card_stats`, `send_edit_link`, `get_edit_url`, `delete_card`, `offboard_card`, `invite_team`, `leads_list`, `leads_assign`, `leads_resend`, `download_team_cards`, `download_member_card`). Mismo auth que el resto del admin (password + TOTP).
- Tarjeta de visita 85×55mm para miembros del equipo: cada `invite_team` adjunta `tarjeta-{slug}.pdf` (branded con `color_primary` + logo de la org + nombre + cargo + email del miembro + QR) al email de invitación. El admin puede descargar todas las tarjetas del equipo en un PDF booklet único desde el botón "📥 Descargar tarjetas del equipo (PDF)" del panel de profesionales — action `download_team_cards`. Para previsualizar la tarjeta de un solo miembro sin abrir su buzón ni bajarse el booklet entero, el admin tiene un icono 🪪 en cada fila del listado de miembros — action `download_member_card`, exactamente el mismo render que el adjunto del email de invitación. El render reusa `buildBusinessCardPDF` / `buildBusinessCardsBookletPDF` de `printable-card-utils.js`.
- Volver al Studio desde la card pública del miembro: cuando el admin abre `/c/:slug` desde el botón "↗ Abrir en pestaña" del drawer, la URL lleva `?from=admin-orgs`. `card.js` lo detecta y pinta una franja oscura arriba con un link "← Volver al panel B2B Studio". El click intenta `window.close()` si el tab tiene `window.opener` vivo (el caso normal: cerrar el popup y devolver foco al admin-orgs original con su sesión intacta); si no, cae a navegar a `/admin-orgs.html`. La franja solo aparece con ese query param, así que la card pública compartida no la enseña a visitantes.
- Endpoint `POST /api/upload-org-logo` (auth password + TOTP): recibe `{slug, base64, contentType}`, sube al bucket `Avatars` bajo `org-logos/{slug}-{timestamp}.{ext}` y hace `UPDATE organizations.logo_url` en una sola llamada. Acepta png/jpg/webp/svg, máx 2 MB. La org debe existir antes de subir el logo (404 si no).
- `delete_org` es soft-delete (`deleted_at = NOW()`). Antes de marcar la org, desvincula todas sus cards (`organization_id = NULL`) para que ninguna quede colgando.

**Render público**:
- `/e/:slug` (función `org.js`) — hero con fondo `color_primary`, logo de la org y tagline; debajo, grid de profesionales activos (`pp-dir-grid` reusado de `dir-utils`). 404 si la org no existe o está soft-deleted. Solo español por ahora. Emite `<meta name="robots" content="noindex,nofollow">` siempre — las páginas B2B se difunden por URL directa, no via Google, y noindex protege de fugas de branding de terceros mientras el piloto no esté cerrado.
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

### Landing B2B (`/es/empresas` + `/ca/empresas`)

Página pública (indexable, no requiere auth) que vende el producto a **organizaciones con red profesional**: empresas, despachos, colegios profesionales, asociaciones, administraciones públicas, ONGs. URL `/es/empresas` por SEO ("empresas" tiene volumen de búsqueda, "organizaciones" no), pero el copy es de amplio espectro. La versión catalana `/ca/empresas` es traducción 1:1; ambas se cruzan con `<link rel="alternate" hreflang>` + `og:locale:alternate`. El header B2C (es y ca) enlaza directo a su versión del landing — espejo simétrico del "Soy autónomo / Sóc autònom →" que el landing B2B tiene hacia el B2C.
- **Hero** con un claim único + 2 CTAs: form de demo (primario) + scroll al vídeo. Subtítulo enumera explícitamente los tipos de organización para que el visitante "se vea" en el primer scroll.
- **Switcher sectorial** con 4 ángulos preconfigurados — Empresas y redes (retención de marca), Despachos y consultoras (imagen homogénea), Colegios y asociaciones (pertenencia como activo digital), Sector público y ONGs (identidad institucional sin CMS interno). Cada uno con su copy, sin reload — vanilla JS.
- **Disclaimer del sector público**: el panel "Sector público y ONGs" incluye una nota visible advirtiendo que requisitos específicos (ENS, residencia de datos en España, accesibilidad WCAG AA, contratación por pliego) se evalúan caso por caso. Evita sobre-prometer compliance que el producto no tiene certificado.
- **Sección de vídeo** `<video>` apuntando a `/videos/b2b-studio-demo.mp4`. Si el archivo no existe (404 o timeout 2.5 s), se muestra un fallback "Vídeo en breve" en lugar de un reproductor roto. Para activar la demo en vídeo: grabar Studio en acción → exportar MP4 < 5 MB → subir a `public/videos/b2b-studio-demo.mp4` + poster a `public/videos/b2b-studio-demo-poster.png`.
- **Form** con honeypot (campo `website` oculto; si viene relleno, devolvemos 200 sin enviar). Campos: nombre, organización, email, tamaño de equipo (enum), tipo de organización (enum: `empresa`, `despacho`, `colegio`, `publico`, `ong`, `otro`), mensaje opcional.
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

### Quipu integration (Verifactu/AEAT)

`netlify/functions/lib/quipu-client.js` is a **skeleton** with the contract (`createInvoice`, `voidInvoice`, `getInvoice`) but no real implementation — every method throws `not implemented`. It is intentionally unwired so that any accidental call fails loudly instead of silently emitting nothing to AEAT.

The implementation lands in Sprint 3, after:
- the provider is selected (Quipu preferred, plan B Holded, plan C FacturaDirecta) and the API validation week closes with a GO,
- the issuer's autónomo registration is formalised (NIF active),
- Stripe live and Stripe Subscription are activated.

Env vars (see `.env.example`): `QUIPU_CLIENT_ID`, `QUIPU_CLIENT_SECRET`, `QUIPU_API_BASE`, `QUIPU_ENV`.

### Environment variables required

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_BASE
STRIPE_PRICE_PRO
STRIPE_PRICE_MONTHLY  # Sprint 3 — recurring price (subscription)
STRIPE_PRICE_ANNUAL   # Sprint 3 — recurring price (subscription)
SUPABASE_URL
SUPABASE_SERVICE_KEY
ADMIN_PASSWORD
ADMIN_TOTP_SECRET     # optional — enables TOTP 2FA for admin panel
RESEND_API_KEY
SITE_URL              # e.g. https://perfilapro.es
AGENT_JWT_SECRET      # signs agent JWT tokens
POSTHOG_API_KEY       # PostHog project key — empty disables analytics
POSTHOG_HOST          # default https://eu.i.posthog.com
B2B_LEAD_INBOX        # email que recibe los leads del form /es/empresas y /ca/empresas
LAUNCH_PROMO_ACTIVE   # "1" activa la promo de lanzamiento 100% bonificada
DEMO_FUNNEL_FREE_ACTIVE # "1" activa Pro gratis para usuarios que entran a /alta vía ?via=demo-*
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
| `/api/stripe-webhook` | `stripe-webhook` |
| `/api/admin-data` | `admin-data` |
| `/api/admin-actions` | `admin-actions` |
| `/api/admin-invoices` | `admin-invoices` |
| `/api/admin-agents` | `admin-agents` |
| `/api/admin-orgs` | `admin-orgs` |
| `/api/upload-org-logo` | `upload-org-logo` |
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
