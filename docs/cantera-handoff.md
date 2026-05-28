# Cantera · estado del sprint y handoff entre hilos

Este documento es el **bookmark** del trabajo en curso sobre el vertical Cantera (deporte base). Cuando un hilo nuevo abre, leerlo después de la sección "Cantera · vertical deporte base" de `CLAUDE.md` da el contexto exacto donde se dejó.

Última actualización: 2026-05-28 (hilo de diseño + capa schema + capa 0.5 · migración 034).

---

## 1 · Qué está aterrizado

**Branch**: capa schema 033 + capa 0.5 (034) mergeadas a `main` (PR #141). La capa 1 (helpers) vive en `claude/cantera-capa1-helpers`.

**Capa 1 · helpers** — `claude/cantera-capa1-helpers`. 5 libs puros + 48 tests (`tests/lib-cantera-flag`, `lib-card-kind`, `lib-pii-crypto`, `lib-sports-categories`, `lib-external-payments`). Suite total 1154/1154.
- `lib/cantera-flag.js` — gate `isCanteraActive()` + `canteraDisabledResponse()` (410).
- `lib/card-kind.js` — guards `isAutonomo/isPlayer/isClubStaff`, `cardKindOf` normaliza a `'autonomo'`.
- `lib/pii-crypto.js` — **DECISIÓN**: cifrado AES-256-GCM app-side (NO pgcrypto DB-side). La columna `bytea` guarda `[iv|tag|ct]` como `\x…`. Clave LAZY, decrypt defensivo. Documentado en CLAUDE.md (sección Helpers + nota env var). Si en el futuro se prefiere pgcrypto, este helper es el único punto a cambiar.
- `lib/sports-categories.js` — `categoryForBirthYear` con offsets relativos al año de temporada; cutoff julio.
- `lib/external-payments.js` — `buildPaymentRow`/`recordExternalPayment`/`list*` sobre la tabla de la 034.

**Capa 0.5 · migración 034** — `supabase/migrations/034_cantera_external_payments.sql`. Pusheada, **NO ejecutada en producción**. Aterriza las respuestas a Q1 y Q2 (ver §4):
- `external_payments` (Bizum/efectivo/transferencia manuales) — la pestaña Cobros del Studio une esto + `parent_subscriptions`. NO es registro fiscal.
- `member_club_seasons.previous_club_name` (texto libre) — histórico legible del club off-platform de origen.
- RLS + REVOKE + contramigración documentada al final del archivo. Doc inline en CLAUDE.md.

**Capa schema · migración 033** — `supabase/migrations/033_cantera_v1.sql`. Está pusheada pero **NO ejecutada en producción Supabase**. La ejecución manual la hace el founder cuando esté listo para encender el carril.

Lo que crea:

- `cards.card_kind` discriminador (default `'autonomo'`, valores `player` / `club_staff`).
- `cards`: `birth_date_encrypted` (pgcrypto + `CANTERA_PII_KEY`), `birth_year`, `gender`, `public_card` (default `true` para no romper autónomos legacy; el flow LOPDGDD lo fuerza a `false` para `player`).
- `organizations.kind` (`business | sports_club`) + `organizations.sport` (catálogo abierto).
- `organizations`: `stripe_connect_account_id`, `stripe_connect_charges_enabled`, `stripe_connect_payouts_enabled`.
- Tablas nuevas: `card_admins`, `card_consents` (append-only, REVOKE UPDATE/DELETE), `sports_categories`, `member_club_seasons`, `card_print_orders`, `parent_subscriptions`, `match_stats`.
- Seed de 7 categorías de fútbol (prebenjamín → senior).
- Contramigración SQL documentada al final del archivo.

**Documentación inline** — `CLAUDE.md` lleva la sección "Cantera · vertical deporte base" con decisiones D1/D2/D3, tablas, roles, LOPDGDD, env vars y plan de reversibilidad.

**Tests** — 1106/1106 pasando en el commit del schema. Aún no hay tests específicos de Cantera (vendrán con los endpoints).

---

## 2 · Decisiones cerradas (no re-debatir)

### Decisiones-marco D1/D2/D3
- **D1** — una sola tabla `cards` con discriminador `card_kind` en lugar de tabla `players` separada.
- **D2** — `cards.organization_id` se mantiene como "club actual activo" (denormalizado, fast queries); la verdad histórica vive en `member_club_seasons`.
- **D3** — `organizations.kind` + `organizations.sport` para que B2B genérico y clubes deportivos convivan.

### Defaults ratificados en el hilo de diseño
- **Naming**: `member_club_seasons` (1 tabla, jugador + staff), no `player_club_seasons` separada de staff.
- **Stripe model**: Connect **Standard** (responsabilidad fiscal en el club, su NIF, su IBAN). Connect Express NO.
- **Slug del jugador**: opaco (`p-XXXXXX`) para anti-doxxing de menores. NO derivado del nombre.
- **Multi-deporte en seed**: sólo fútbol; el resto entra vía UPSERT en migraciones posteriores cuando llegue cliente real.

### Modelo de ownership y portabilidad
- La card pertenece al jugador. Cuando cambia de club, la `cards` row no se duplica — viaja con él.
- Handoff entre clubes PerfilaPro = transacción atómica (cierre fila vieja + apertura nueva + UPDATE `cards.organization_id` + insert `card_consents` con `consent_type='club_handoff'`).
- Visit log, foto, edit_tokens de tutores y todo el histórico previo quedan intactos.

### Roles y consentimiento
- 4 roles en `card_admins`: `tutor_legal`, `tutor_secundario`, `player_self`, `club_admin`.
- Sólo `tutor_legal` puede ejercer `delete-account` / `export-data` del menor.
- `card_consents` append-only por construcción RLS — incluso service_role tiene REVOKE UPDATE/DELETE.
- Doble verificación parental: magic-link + segundo factor (SMS o NIF parcial) antes de `public_card=true`, primer handoff, o `image_rights`.

---

## 3 · Contexto operativo descubierto en el último hilo

Esto no son decisiones todavía, pero condicionan las que vienen. Hay que tenerlo presente al diseñar la capa de cobros y la UX comercial.

### Realidad del cobro en clubes de cantera españoles
- Bizum + efectivo son **dominantes**, no minoritarios. La mayoría de coordinadores reciben pagos en su Bizum **personal** (problema fiscal latente: esos ingresos legalmente son del club).
- La "lista de quién pagó" vive en una hoja Excel + grupo de WhatsApp con 60 padres. El coordinador acaba persiguiendo deudas a la puerta del vestuario.
- Las facturas/recibos al padre que las piden (deducción autonómica por hijo, justificante empresa) salen una a una a mano.

**Implicación de producto**: el valor real del producto NO es "los padres pagan con tarjeta", es **"el club controla todos los cobros desde un sitio sin perseguir a nadie"**. Stripe Connect es el upgrade. Bizum/efectivo registrados manualmente es el carril que matches con la realidad de fase 1.

### Realidad del fichaje cross-club en fase 1
- En la fase 1 (1-2 clubes adheridos), el handoff transaccional entre clubes PerfilaPro **no se ejercita una sola vez**. Todos los fichajes entrantes vienen de clubes off-platform; todos los salientes van a clubes off-platform.
- El modelo handoff es **promesa de red futura**, no valor inmediato.
- El pitch comercial debe vender la **gestión interna** (cobros + LOPD + carnet) en fase 1, NO el handoff entre clubes.

**Implicación de modelo**: el alta de player necesita aceptar 3 caminos en el endpoint `register-player.js`:
1. Nuevo en plataforma (alta limpia).
2. Llega de club PerfilaPro (handoff transaccional — diseñado pero raro en fase 1).
3. **Llega de club off-platform** (alta nueva + campo libre `previous_club_name` para captar el histórico legible no enlazable).

Y el flujo de baja del player a un club off-platform debe cerrar limpio: `member_club_seasons` con `exit_reason='fichaje'`, card sin `organization_id` activo, padre decide pausa free o mantenimiento 1€/mes opcional.

---

## 4 · Decisiones abiertas → CERRADAS (2026-05-28)

Las cuatro se respondieron con los defaults propuestos:

- **Q1 · Bizum/efectivo manual** → **SÍ, MVP**. Aterrizado en migración 034 (`external_payments`).
- **Q2 · histórico pre-plataforma** → **texto libre**. Aterrizado en migración 034 (`member_club_seasons.previous_club_name`).
- **Q3 · discurso Stripe** → **upgrade voluntario por padre**. No toca código; es copy del Studio + email al padre (lo aplica la capa 6 · UI). Métrica "% padres en Stripe" visible al club.
- **Q4 · cuota dividida (custodia 50/50)** → **Sprint 2**. MVP asume 1 pagador; otros tutores son admin sin pago. `parent_subscriptions` se queda 1-a-1 con `card_slug` por ahora.

> Pendiente operativo (no bloquea código): confirmar con el founder el % real de custodia compartida en el club beachhead. Si resulta >15%, reabrir Q4 a Sprint 1 (tabla `subscription_payers` + multi-payer Stripe).

El registro original de las cuatro preguntas se conserva abajo como contexto del razonamiento.

---

Cuatro preguntas que cambian la migración 034 + el copy comercial. Hasta que se respondan, no escribo más SQL ni endpoints encima.

### Q1 · Gestión manual de pagos (Bizum/efectivo)
**¿Es feature de MVP o de Sprint 2?**

- **Default propuesto**: MVP. Es lo que diferencia la venta a un club real de la venta a uno hipotético.
- Si sí → migración 034 añade tabla `external_payments` (FK card + org + period + amount + method + recorded_by + paid_at + notes). La pestaña **Cobros** del Studio une Stripe + externos en una sola vista. Recibo PDF generado con plantilla "recibo" (no "factura") usando `invoice-utils.js`.
- Si no → MVP es Stripe-only, fricción mayor para cerrar primer club.

### Q2 · Histórico pre-plataforma del player
**¿Texto libre o capítulos manuales editables?**

- **Default propuesto**: texto libre Sprint 1 (`member_club_seasons.previous_club_name`).
- Si capítulos manuales → tabla `historical_chapters` (no enlazada a `organizations`, marcada `verified=false` en la UI). Útil para retención del padre / palmarés del chaval, no urgente para primer club.

### Q3 · Discurso comercial sobre Stripe
**¿Vendemos Stripe como default empujando a los padres, o como opción sin presión?**

- **Default propuesto**: upgrade voluntario por padre. Métrica "% padres en Stripe" visible al club; crece sola con el tiempo. Forzar conversión al inicio espanta clubes.
- Esto NO cambia código, cambia copy del Studio y del email al padre.

### Q4 · Cuota dividida (custodia compartida 50/50)
**¿Sprint 1 o Sprint 2?**

- **Default propuesto**: Sprint 2. MVP asume 1 pagador, otros tutores son admin sin pago.
- Si Sprint 1 → `parent_subscriptions` deja de ser 1-a-1 con `card_slug` y necesita tabla intermedia `subscription_payers`. Sí toca migración 033 (o se hace en 034). Y es más lío de Stripe (multi-payer).

---

## 5 · Plan de capas pendientes (orden propuesto)

Asumiendo que las cuatro Q de arriba se cierran con los defaults, el orden de commits es:

| Capa | Contenido | Reversible borrando |
|---|---|---|
| **0 · ✅ hecho** | Migración 033 + sección CLAUDE.md | DROP CASCADE documentado |
| **0.5 · ✅ hecho** | Migración 034 (external_payments + previous_club_name) — Q1/Q2 = sí | DROP TABLE / DROP COLUMN |
| **1 · ✅ hecho** | `lib/cantera-flag.js`, `lib/card-kind.js`, `lib/pii-crypto.js`, `lib/sports-categories.js`, `lib/external-payments.js` + 48 tests | Borrar archivos |
| **2 · ⬅ SIGUIENTE · auth tutor** | `parent-auth.js` + extensión `lib/panel-auth.js` (`purpose:'parent-panel'`) | Borrar archivo + route |
| **3 · fichaje + handoff** | `register-player.js`, `request-transfer.js`, `accept-transfer.js`, `cancel-membership.js`, `parent-consent.js` + tests de transacción atómica | Borrar archivos + routes |
| **4 · Stripe Connect + cobros** | `stripe-connect-onboard.js`, `create-parent-checkout.js`, `create-setup-fee-checkout.js`, `record-external-payment.js` (si Q1), handler eventos Connect en `stripe-webhook.js` | Borrar archivos + sección del webhook + env vars |
| **5 · carnet físico** | `buildPlayerCardPVC` en `printable-card-utils.js`, `print-order-export.js`, `nfc-register.js` | Borrar funciones + routes |
| **6 · UI Studio + Panel padre** | Ramificación de `panel.html` por `org.kind`, extensión `org-panel.js` con acciones deportivas, vista padre | Revert HTML/JS |

Cada capa commit separado. Cada capa con tests. `netlify.toml` se actualiza por capa con un bloque etiquetado `# CANTERA · ...` para borrado en bloque.

---

## 6 · Cosas operativas a aclarar con el founder antes del primer cliente

No son decisiones de Claude — son conversaciones con el founder y con el primer club beachhead.

- ¿Application_fee con mínimo absoluto (ej. 1€ por cobro) o sólo porcentaje? Importante para que cuotas bajas (5-15€ en prebenjamín) sigan siendo rentables.
- ¿Quién emite la factura SEPA al padre por defecto? Default mío: el club, con su NIF. PerfilaPro NO emite factura al padre. Si quieren asistencia (plantilla PDF club-branded usando `invoice-utils.js`), se valora cuando un club lo pida.
- KYC de Stripe Connect Standard tarda 1-3 días la primera vez. El wizard de onboarding gatea fichajes hasta que `charges_enabled=true`. Hay que comunicárselo al club en la venta para que no se sorprenda.
- Beachhead concreto: ¿cuál es el club, qué tamaño (200-400 chavales mencionado en brief), cuándo se hace la primera demo? Esto afecta urgencia y orden de capas.
- Hijos de divorciados con custodia compartida (Q4): pregúntale al founder qué porcentaje real estima en el club beachhead. Si es >15%, MVP debería soportarlo; si es <5%, Sprint 2 está bien.

---

## 7 · Cómo arrancar el próximo hilo

Mensaje sugerido para el próximo hilo:

> Sigo desde `docs/cantera-handoff.md`. Capas 0/0.5 (migraciones 033+034) mergeadas a `main`; capa 1 (helpers + 48 tests) en `claude/cantera-capa1-helpers`. Las 4 Q cerradas con defaults (§4). Continúo con la **capa 2 · auth tutor**: `parent-auth.js` + `purpose:'parent-panel'` en `lib/panel-auth.js`, reusando los helpers de capa 1.

La capa 2 (auth tutor) es lo siguiente: el modelo multi-admin de `card_admins` (cada tutor con su `edit_token`) necesita su propio magic-link / JWT, espejo de `panel-auth.js` pero scoped a una card de player en lugar de a una org.
