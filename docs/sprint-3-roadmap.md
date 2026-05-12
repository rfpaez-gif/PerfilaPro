# Sprint 3 — Roadmap & handoff

Documento de continuidad entre hilos. Resume el estado real de producción
al cierre del sprint B2B Demo Studio (mayo 2026) y empaqueta el siguiente
sprint (monetización + onboarding B2B) para retomarlo en limpio.

> **Lectura previa obligatoria**: `CLAUDE.md`. Este documento NO repite la
> arquitectura general — sólo lo nuevo y lo pendiente.

## Estado a fecha de cierre

Todo lo que sigue está en `main`. No queda nada en ramas sin mergear.

| Commit | PR | Qué |
|---|---|---|
| `1f781c5` | #92 | Sprint B2B completo: `/es/empresas` (form leads), `/e/:slug` (org pages), `/admin-orgs.html` (B2B Demo Studio), endpoints `admin-orgs` + `upload-org-logo` + `lead-b2b`, atribución gated en `card.js`, migraciones 019 + 020. |
| `6ea56e9` | #93 | CTA "Crea tu perfil gratis →" al pie de `/e/:slug` (reusa `buildShowcaseCta` de `dir-utils`). |
| `3f89426` | #95 | Sprint 3 · pieza A: onboarding B2B con pre-relleno desde el lead. Migración `021_b2b_leads.sql`, endpoint `onboarding-prefill`, página `public/es/onboarding.html`, integración en `register-free` / `create-checkout`, sección "Leads B2B" en Studio. |
| `8c21fc2` | #96 | Carril propio `plan='b2b'` para perfiles de empresa. Migración `022_cards_plan_b2b.sql`. Resuelve que las cards B2B no se confundieran con free/base. |
| `5369fc1` | – | Action `invite_agent` en `admin-orgs` (preámbulo de #97). |
| `0d0a7f4` | – | Hotfix: expandir `cards_plan_check` para aceptar `'b2b'`. |
| `5c92001` | – | Hotfix: render público no marcaba cards b2b como Free. |
| `b8468e8` | – | **Resuelve la deuda "alta" del TOTP**: admin-session emite JWT de 60 min al primer login válido (password + TOTP). Las acciones siguientes envían sólo el token. Ya no caducaba la sesión a los 90s. |
| `550bd63` | – | Hotfix: grid de `/e/:slug` enlaza a `/c/` (no a `/p/`) y trata b2b como paid. |
| `821c8ab` | – | Preámbulo de #97: invitar equipo en bloque + candado de campos en `/editar`. |
| `28a9d05` | #97 | Sprint 3 · pieza B (parcial): invitar equipo end-to-end con candado + sesión JWT. |
| `193124f` | #98 | Pulido del panel B2B (este hilo). Ver "Estado tras #98" abajo. |

Env vars añadidas en Netlify durante esta sesión:
- `B2B_LEAD_INBOX = hola@perfilapro.es` ✓

Decisiones tomadas y aplicadas:
- Landing `/es/empresas` recortada a 2 sectores (Empresas + Despachos). Los otros 3 (Colegios / Sector público / ONGs) siguen permitidos por el backend (`SECTORS` allowlist en `lead-b2b.js`), reactivables sólo añadiendo el `<option>`.
- `/es/empresas` con `<meta name="robots" content="noindex, follow">` hasta que Sprint 3 cierre.
- Home `/es/index.html` sección `#equipos`: precio fijo (95€/año) + WhatsApp → reemplazado por CTA secundario a `/es/empresas`.

## Smoke test pendiente (lo debe hacer el usuario, 5 min)

No bloqueante para Sprint 3, pero confirma que el sprint B2B vive bien
en producción antes de construir encima.

- [ ] **Crear org PerfilaPro** en `https://perfilapro.es/admin-orgs.html`
  - slug `perfilapro` · color `#00C277` (verde marca; usar `#003781` repite la identidad de Allianz)
  - tagline candidato: *"Tu trabajo merece verse"*
  - logo: `https://perfilapro.es/assets/brand/svg/perfilapro-isotype-verde.svg`
  - **Importante**: tras meter password + TOTP, dale a "Crear" **inmediatamente** — el TOTP cachea en sessionStorage y caduca a los ~90s; si vence el primer create, los siguientes devolverán 401. Es UX-bug conocido, ver "Sprint 3 — deudas conocidas" abajo.
- [ ] Hacer una card propia en `/es/alta` (flujo autónomo normal).
- [ ] Asignar esa card a PerfilaPro desde Studio.
- [ ] Verificar `/e/perfilapro` (grid con tu card + CTA al pie).
- [ ] Verificar `/c/{slug-de-tu-card}` (franja verde superior + footer "Parte de PerfilaPro").
- [ ] Si todo cuadra, decidir si dejar la org en producción (dogfood público) o borrarla (soft-delete desde Studio).

Si algo falla, anotar en este archivo antes de seguir a Sprint 3.

## Estado tras #98 — pulido del panel B2B

Hilo cerrado el 2026-05-12. Cuatro commits squasheados en un único `193124f`:

1. **CSV/Excel paste en el bulk invite** (`public/admin-orgs.html`).
   El parser `parseTeamList` ahora auto-detecta separador (tab > `;` > `,`),
   salta cabeceras CSV si la primera celda no contiene `@`, respeta comillas
   dobles tipo RFC 4180 y preserva el legacy de "Pérez, Pedro" sin
   entrecomillar. Botón **📄 Subir CSV** lee `.csv/.tsv/.txt` (máx 200 KB) y
   vuelca al textarea. El contador en vivo usa el parser → refleja
   exactamente lo que se enviará al backend.

2. **Modal unificado a un solo modo**. Las pestañas "Uno solo" / "Equipo
   (varios)" hacían lo mismo: el modo equipo ya permite rellenar campos
   comunes y soporta 1..100 invitaciones. Eliminadas las tabs, el bloque
   "Uno solo" del HTML, la action `invite_agent` del backend y sus 8 tests
   redundantes. `invite_team` con array de 1 elemento es el camino único.
   Diff neto: −345 / +39 líneas.

3. **Editar y borrar tarjeta desde el Studio**. Cada card del listado tiene
   ✏️ Editar (abre `/{idioma}/editar?slug=&token=` en nueva pestaña;
   ventana abierta síncrona al click para no caer en popup blocker; el
   backend reusa `edit_token` vigente y solo regenera si está ausente o
   expirado, sin romper magic-links activos del agente) y 🗑️ Borrar
   (soft-delete con `deleted_at = NOW()` siguiendo el patrón de
   `delete-account.js` — el job `purge-deleted` se encarga de visits +
   facturas a los 30 días, preservando AEAT y dando ventana de
   recuperación). Dos nuevas actions en `admin-orgs.js`: `get_edit_url`
   + `delete_card`, con 9 tests cubriendo token vigente reusado, regeneración
   por ausencia y caducidad, idioma `ca`, 404 y validación.

4. **Fix edge function en deploy previews**. `lang-detect.js` tenía un
   whitelist estricto a `perfilapro.es` / `www.perfilapro.es` para evitar
   el doble prefijo `/ca/ca/` de #83. Como efecto colateral los previews
   `deploy-preview-N--perfilapro.netlify.app` caían en `context.next()` y
   Netlify intentaba servir `public/index.html` (que no existe en el repo).
   Ahora `*.netlify.app` está incluido en el whitelist; los previews reciben
   detección por cookie + Accept-Language. Los hosts `perfilapro.cat/.com`
   siguen excluidos, conservando el fix de #83.

**Tests**: 51 archivos, 731 tests verdes. Los 9 nuevos cubren las actions
`get_edit_url` y `delete_card`.

**Smoke tests manuales pendientes** (no bloqueantes, los marca el usuario al
acabar la revisión visual del deploy):
- [ ] Pegar lista desde Google Sheets en el textarea → contador refleja N.
- [ ] Subir CSV con cabecera `Email,Nombre` → se importa sin la fila de header.
- [ ] Invitar 1 persona desde el modal unificado → idéntico al antiguo `invite_agent`.
- [ ] Click ✏️ en una card → abre el editor en nueva pestaña con la card cargada.
- [ ] Click 🗑️ → confirm → card desaparece del listado y queda con `deleted_at` en BD.

## Estado tras #100-#103 — branded hero, white-label y offboarding humano

Cuatro PRs squash-mergeados a `main` el 2026-05-12, todos sobre el flujo
B2B (`/e/:slug`, `/c/:slug`, `admin-orgs.html`). El paquete sube la
calidad B2B del "puedo asignar una card a una org" a un mini-producto
white-label coherente para el primer cliente de pago.

1. **Branded hero en `/c/:slug` (#100, `35f03b7`).** Cuando la card tiene
   `organization_id` resuelto, se pinta un hero completo arriba (logo en
   pill blanco + nombre serif + tagline opcional sobre `color_primary`).
   Mismo lenguaje visual que el hero de `/e/:slug` escalado al ancho de
   la card. El cliente B2B siente la marca como dueña del espacio. La
   atribución al pie ("Parte de [Org]") quedó absorbida — el hero es
   ahora la cabecera clickeable hacia `/e/:slug`. Fetch de la org usa
   `getOrgById` (con `tagline`) en vez del SELECT inline previo.

2. **White-label en contexto B2B (#101, `41d7345`).** `dir-utils.htmlPage`
   acepta `noPromo` (default false). Cuando true, oculta el CTA
   *"Crea tu perfil →"* del header y el link *"Directorio"* del footer;
   deja el logo PerfilaPro y los links legales (Términos/Privacidad) como
   atribución SaaS mínima. `org.js` pasa `noPromo: true` siempre y elimina
   `buildShowcaseCta` del body. `card.js` cuando hay `organization_id`:
   oculta `pp-free-banner`, sustituye el bloque "Creado con PerfilaPro ·
   Crea tu propio perfil" por un escueto `Powered by PerfilaPro` sin link,
   y oculta el `pp-page-foot`. Cards sin org se renderizan idénticas a
   antes. El visitante de Special Trainer ya no recibe ofertas de
   PerfilaPro B2C compitiendo por su atención.

3. **"Quitar del equipo" con cortesía 90 días (#102, `9053763`).** Nueva
   acción `offboard_card` en `admin-orgs.js`. No es desvincular seco:
   setea `organization_id=NULL`, `plan='base'`, `expires_at=NOW+90d`,
   resetea `reminder_30/15/7_sent`. El cron `remind-expiry` ya envía
   automáticamente los avisos a 30/15/7 días antes del fin de cortesía —
   **cero código nuevo en el cron**, todo es reuso. Si la card tenía un
   `expires_at` posterior, se preserva el más generoso. Regenera
   `edit_token` si está caducado (30 días TTL). Email transaccional al
   trabajador respetando `cards.idioma` (es/ca) con URL de su tarjeta +
   magic-link para seguir editando. Email no-bloqueante: si Resend falla,
   el offboard ya está en BD. El botón "Quitar" del listado de
   profesionales asignados ahora llama a `offboardCard()` con modal
   explicativo que diferencia "Quitar (cortesía 90d)" de "Eliminar
   definitivamente" (🗑️ sigue siendo `delete_card`/soft-delete).

4. **Cargo individual per-miembro en `invite_team` (#103, `d14ef25`).**
   El array `team` ahora acepta `ocupacion` por miembro (sanitizada,
   140 chars max). Si está, gana sobre `template.tagline`; si no, fallback
   al template. Compatibilidad total con invitaciones previas. UI:
   `parseTeamList` extrae la 3ª columna como `ocupacion` desde CSV/Excel
   paste; placeholder y hint actualizados con ejemplo realista
   (Entrenadora / Recepcionista / Fisioterapeuta). En `/e/:slug` cada
   profesional aparece bajo su nombre con su rol específico en lugar de
   un tagline genérico común.

### Deuda B2B explícita parqueada (re-evaluar antes de Sprint 3)

Tres piezas que el usuario y yo discutimos y aparcamos conscientemente
porque hoy no aportan al caso de uso real (founder operando como
super-admin de confianza). Re-evaluar cuando arranque el self-service B2B
real (cliente B2B se loguea solo en su panel sin pasar por el founder).

- **Form admin dedicado para editar cards desde admin-orgs.** Hoy el
  botón ✏️ llama a `get_edit_url` y abre el `/{lang}/editar` del
  trabajador en pestaña nueva. Funciona y deja al admin tocar todos los
  campos. Falta separación de capas: admin = marca-cara (foto, tagline,
  servicios, ocupación, zona, descripción); trabajador = canales
  personales (WhatsApp, email, teléfono, dirección, idioma). Construir
  cuando entre el self-service B2B con auth de "dueño de organización"
  (que no es admin global) — entonces sí hace falta limitar qué puede
  tocar el cliente B2B sobre sus propios empleados.

- **Consent flow para invitar trabajador con email ya existente.** Hoy
  `invite_team` no detecta colisión de email — si Olga ya tiene una card
  como autónoma con `olga@gmail.com`, una invitación a ese email crea una
  segunda card con slug sufijado. Doble identidad. El diseño consensuado
  es: detectar email existente → enviar email *"Special Trainer quiere
  añadirte a su equipo. Tu perfil pasaría a mostrarse bajo su marca. ¿Aceptas?
  [Aceptar/Rechazar]"* con token-link al endpoint nuevo `/api/org-invite-accept`.
  Identidad portable (Olga conserva slug, foto, visits acumuladas). Construir
  con el primer caso real en producción (lo veremos cuando aparezca).

- **Migrar `assign_card` (admin-orgs) al mismo flujo de consent.** La
  acción actual "Asignar card existente a esta org" no pide consentimiento
  al dueño de la card. Hoy funciona porque el founder opera en modo
  confianza, pero no es B2B-correct para producción. Misma solución que
  el punto anterior: reusar el endpoint de consent. Hacer en el mismo
  sprint que el consent flow del invite.

Sin bloqueador alguno: los cuatro PRs de hoy están en producción y
funcionan end-to-end para Special Trainer (la primera org de prueba real
con Olga Cardona como entrenadora). El usuario validó visualmente el
branded hero — feedback explícito *"Tienen que sentir la presencia de su
marca, la exclusividad"* fue lo que disparó el paquete completo.

## Sprint 3 — el sprint de monetización + onboarding B2B real

Tres piezas que se necesitan mutuamente. **Empezar por A**: sin
persistencia de leads no hay nada que pre-rellenar y no hay analítica
del funnel B2B. Las otras dos se pueden hacer en paralelo o después.

### A) Onboarding B2B con pre-relleno desde el lead

**Problema actual.** El flujo "lead → empresa activa con N profesionales"
hoy es manual y discordante:

1. Lead rellena form en `/es/empresas` → te llega email a `hola@perfilapro.es`.
2. No hay registro persistente del lead. Si pierdes el email, pierdes el lead.
3. Empresa quiere onboardear 30 profesionales. Cada uno hace `/es/alta` con voz autónomo, sin contexto de su org, sin branding, sin link automático.
4. Tú entras a Studio y asignas cada card una a una. Inviable para empresas grandes.

**Lo que el usuario validó en sesión:** *"El form de acceso debe pre-rellenar los campos que ya se completaron en la captación del landing para que sea fácil"*. Mata fricción y mata el "auto-reply pendiente" que dejamos en deuda.

**Diseño propuesto.**

1. **Migración `021_b2b_leads.sql`** — nueva tabla:
   ```sql
   CREATE TABLE b2b_leads (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     invite_token  text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
     name          text NOT NULL,
     company       text NOT NULL,
     email         text NOT NULL,
     team_size     text NOT NULL,
     sector        text NOT NULL,
     message       text,
     organization_id uuid REFERENCES organizations(id),  -- null hasta que admin asocie
     created_at    timestamptz NOT NULL DEFAULT NOW(),
     redeemed_at   timestamptz,
     redeemed_card_slug text REFERENCES cards(slug)
   );
   CREATE INDEX b2b_leads_email_idx    ON b2b_leads(email);
   CREATE INDEX b2b_leads_token_idx    ON b2b_leads(invite_token);
   CREATE INDEX b2b_leads_redeemed_idx ON b2b_leads(redeemed_at) WHERE redeemed_at IS NULL;
   ```

2. **Modificar `netlify/functions/lead-b2b.js`** — además del email a `B2B_LEAD_INBOX`:
   - Persistir fila en `b2b_leads` (insert antes del email; si falla, devolver 500 y no enviar).
   - Mandar un segundo email al lead con magic-link: `https://perfilapro.es/es/onboarding?token={invite_token}`.
   - Plantilla con prefix `[PerfilaPro · Onboarding]`, voz alineada con `/es/empresas`.
   - Test: el patrón actual `makeHandler({ db, emailClient })` ya está. Añadir `db` al inject.

3. **Nuevo endpoint `netlify/functions/onboarding-prefill.js`**:
   - `GET /api/onboarding-prefill?token=…` → lee `b2b_leads` por token, devuelve `{ name, company, email, sector, organization_id }` (si organization_id está rellenado, también `{ org: { slug, name, color_primary, logo_url } }`).
   - Devuelve 404 si token inválido o `redeemed_at != NULL`.
   - Rate limit reusando `lib/rate-limit.js`.

4. **Nueva página `public/es/onboarding.html`** (o `?token` en `/es/alta` — decisión a tomar):
   - Lee `?token=…` del query, llama a `/api/onboarding-prefill`.
   - Pre-rellena `email` (read-only), `nombre`, `company`, `sector`.
   - Si `org` viene en la respuesta: header con `color_primary` + logo + nombre, copy adaptado ("Crea tu perfil dentro de {org.name}").
   - El user rellena lo nuevo: tagline, servicios, WhatsApp, foto, dirección, zona.
   - Submit POSTea a `/api/register-free` o `/api/create-checkout` con `organization_id` heredado del lead y `redeemed_token` para marcar el lead como usado.

5. **Modificar `register-free.js` y `create-checkout.js`**:
   - Aceptar opcionalmente `organization_id` (validar que existe en `organizations`).
   - Aceptar opcionalmente `redeemed_token`. Tras éxito, `UPDATE b2b_leads SET redeemed_at = NOW(), redeemed_card_slug = … WHERE invite_token = …`.
   - Asegurar que el campo `cards.organization_id` se persiste en el insert.

6. **Bonus admin** (opcional pero alto valor): en `/admin-orgs.html`, sección "Leads B2B" que liste `b2b_leads` con filtro `redeemed_at IS NULL`, fecha, organización, email. Permite re-enviar el magic-link si el primero se perdió. Patrón: ya existe `resend-kit.js` para emails — copiar el shape.

**Beneficios colaterales**:
- Mata el "auto-reply al lead" que dejamos en deuda.
- Te da analítica del funnel B2B (n leads, n redimidos, conversión %, tiempo medio de redención).
- Permite recordatorios automáticos a los que no activan en 7 / 14 días (reusar el patrón `remind-expiry.js`).
- Permite re-contactar leads aunque pierdas el email original.

**Riesgo a vigilar**: `b2b_leads` contiene PII (nombre, email, organización). Aplicar las mismas garantías que `cards`: política RLS adecuada, derechos GDPR (export + delete por email, no por token). Documentar en `terminos.html` y `privacidad.html`.

### B) Stripe Subscription + facturación a la organización

Hoy `cards.plan` se cobra por card (pago único 90/365 días). Sprint 3
quiere que una empresa pague **una suscripción** que cubre N profesionales.

**Env vars ya documentadas en `.env.example`**:
- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_ANNUAL`
- `QUIPU_*` (ver pieza C abajo)

**Diseño propuesto** (sketch, refinar al arrancar):

1. **Nueva tabla `organization_subscriptions`**:
   - `id`, `organization_id` (FK), `stripe_subscription_id`, `stripe_customer_id`, `status` (active / past_due / canceled), `plan` (monthly / annual), `seat_limit` int, `current_period_end timestamptz`.
2. **Stripe Checkout en modo subscription** lanzado desde un `/api/create-b2b-checkout` nuevo, con `mode: 'subscription'`, customer = la organización (no el profesional), success_url al admin de la org.
3. **Webhook `stripe-webhook.js`** ampliado para manejar `customer.subscription.created/updated/deleted` además de `checkout.session.completed`.
4. **Asignación de seats**: cuando se crea/asigna una card a una org con suscripción activa y seat disponible, la card automáticamente entra en plan "pro perpetuo" (sin `expires_at`, gestionado por la suscripción de la org). Si la suscripción se cancela, las cards quedan con un grace period antes de pasar a `status='free'`.
5. **Panel admin para la org**: nueva página `/empresa-admin.html` (o tab en Studio) donde el dueño de la org gestiona seats, paga, ve facturas. Auth distinta del admin de PerfilaPro (auth de owner por email + magic-link, NO el `ADMIN_PASSWORD` global).

**Decisión pendiente**: quién factura. Las opciones son:
- (a) PerfilaPro factura a la organización directamente (autónomo a empresa). Requiere Quipu / pieza C operativa.
- (b) PerfilaPro emite ticket interno + Stripe genera el invoice fiscal. Más simple en sprint, menos correcto fiscalmente en España.

Recomendación inicial: (a). Es la única coherente con Verifactu/AEAT y con el resto del producto.

### C) Quipu / Verifactu — invoice transmission a AEAT

Hoy `netlify/functions/lib/quipu-client.js` es **esqueleto** —
`createInvoice`, `voidInvoice`, `getInvoice` lanzan `not implemented`.
Cualquier llamada falla loud para que no enviemos facturas a AEAT por
accidente desde el código actual.

**Tareas Sprint 3**:

1. **Decisión de provider**. Orden preferido:
   - Quipu (más limpia, API REST OAuth2)
   - Holded (alternativa)
   - FacturaDirecta (fallback)
2. **Semana de validación API** con el provider elegido: probar el ciclo crear → consultar → anular contra sandbox. Si pasa: GO. Si no: siguiente provider.
3. **Implementación real** de `quipu-client.js`. Tests con mocks que respeten el contrato del esqueleto actual.
4. **Cableado en `stripe-webhook.js`** (B2C) y `create-b2b-checkout` (B2B): tras cada cobro confirmado, generar invoice local PDF (como hoy) **+ enviar a Quipu**. La fila de `facturas` añade `quipu_invoice_id` y `quipu_sent_at`.
5. **Backfill**: las facturas emitidas en la fase demo (las que tiene `PROMO-*` no, ésas no tienen contraprestación) deben re-enviarse al provider si la AEAT lo exige retroactivamente. Decidir con asesor fiscal.

**Bloqueador externo**: el alta del autónomo / NIF debe estar formalizada antes de empezar Quipu en producción. Sandbox sirve para desarrollo.

### Deudas conocidas (Sprint 3 o antes, según prioridad)

**Resueltas en este intervalo**:
- ✅ TOTP del Studio caducaba a los ~90s y rompía la segunda acción → `b8468e8` introdujo `admin-session` con JWT de 60 min emitido tras el primer login válido (password + TOTP). Las acciones del Studio envían sólo el token; el TOTP fresco solo se pide al login.
- ✅ Action `invite_agent` redundante → eliminada en #98. `invite_team` con N=1 es el camino único.
- ✅ Deploy previews devolvían 404 en `/` → `0a25bfe` (incluido en squash #98) amplía el whitelist de `lang-detect.js`.

**Media**:
- `organizations.show_cta` (default `true`) para suprimir el CTA "Crea tu perfil" en orgs white-label que paguen por exclusividad de marca. Migración trivial + cambio gated en `org.js`.
- Tagline placeholder en `/admin-orgs.html` arrastra el valor del org editado previamente (cosmético).
- `/e/:slug` sólo se renderiza en español. Cuando llegue un lead B2B catalanoparlante real, añadir `organizations.idioma` y traducir org.js / empresas.html.
- Auto-reply al lead B2B: ya cubierto en pieza A (se mata cuando se persiste el lead).

**Baja**:
- `/ca/empresas` no existe. Cuando llegue lead catalán, espejar el .html y traducir.
- Documentación: añadir capturas del Studio al `BRAND_GUIDE.md` o crear `docs/b2b-demo-studio.md` para sales reps.

## Preguntas estratégicas pendientes desde el inicio del hilo

Las dos que decidían el siguiente sprint. Bloqueadas hasta tener datos.

1. **¿Cuántos usuarios activos en la promo de lanzamiento?**
   - SQL contra Supabase:
     ```sql
     SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS last_7d,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last_30d
     FROM cards
     WHERE status = 'active' AND plan = 'base' AND stripe_session_id IS NULL;
     ```
   - El resultado decide si Sprint 3 arranca por la pieza B (monetización, requiere tracción real) o si hay que volver a B2C-adquisición primero.

2. **¿Sprint 3 está listo para arrancar?** Pre-requisitos no-código:
   - NIF activo del autónomo emisor.
   - Stripe live (no test) activado, incluido Subscription.
   - Decisión de provider Verifactu (sandbox al menos).
   - Si alguno no está, Sprint 3 técnico no rompe, pero queda en estado "código listo, no producible" — mismo problema que ya tuvimos con el Demo Studio en una rama no mergeada. **Coordinar inicio del sprint con la disponibilidad de estas tres piezas externas**.

## Apuntes de arquitectura para el próximo Claude

Patrones del repo que conviene reusar literal:

- **`makeHandler(deps)`** para todo endpoint nuevo. Tests vía dependency injection. Ver `lead-b2b.js`, `admin-orgs.js`, `resend-kit.js` como referencias frescas.
- **Auth admin**: `lib/admin-auth.js` con `checkAdminAuth(event, { requireTotp: true })`. NO inventar otra cosa.
- **Auth profesional / owner-of-card**: edit-token de 32 bytes hex en `cards`, mismo mecanismo que `edit-card`, `download-card`, `delete-account`. Para Sprint 3 piezas que necesiten auth de "dueño de organización" (no admin global), inventar mecanismo paralelo basado en magic-link (no inventar passwords).
- **Emails transaccionales**: `lib/email-layout.js` con `idioma`. Todo email nuevo debe respetar `cards.idioma` (o el idioma del lead si es onboarding pre-card).
- **Migraciones**: numeración secuencial. Aplicadas en este intervalo `021_b2b_leads.sql` (#95) y `022_cards_plan_b2b.sql` (#96). La próxima libre es `023`.
- **Rate limiting**: `lib/rate-limit.js` con map en memoria. Sufficient para el volumen actual.

## Convención de ramas para el próximo hilo

**No repitamos el episodio de la rama huérfana.** Toda rama de Sprint 3:

1. Crear desde `main` (`git checkout -b claude/sprint-3-<feature> main`).
2. Commit + push.
3. Abrir PR contra `main` con descripción concreta.
4. Mergear con squash (preserva convención: `5bad3a8`, `1f781c5`, etc. todos son squash merges con sufijo `(#N)`).
5. **No declarar "está en producción" hasta confirmar deploy en Netlify**.

Las ramas de esta sesión (`claude/perfilapro-strategy-b2b-gthJ9`, `claude/org-cta-perfil`, `claude/docs-sprint-3-handoff`) ya pueden borrarse — mergeadas todas.

Tras este intervalo, todas las ramas de PRs cerrados (#95 → #98, más la de #98 `claude/polish-bulk-invite-modal-0lxcX`) son borrables — el squash deja los commits en `main` con sufijo `(#N)`. Limpieza en bloque desde GitHub o `git branch -d` local.
