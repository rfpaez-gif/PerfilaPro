# PerfilaPro — Hoja de ruta de lanzamiento

> Auditoría global pre-lanzamiento. Fecha: **2026-06-02**. Rama: `claude/perfilapro-launch-audit-1MOw3`.
> Metodología: 6 subagentes read-only en paralelo (B2C, B2B, Cantera+Inscripción, Fiscal/Legal, Infra/Calidad, Superficie no documentada), contrastando el código real contra `CLAUDE.md` y `docs/cantera-handoff.md`. Cada hallazgo cita `archivo:línea`.
> Estado de la suite en el momento de la auditoría: **90 archivos, 1457 tests, 0 fallos** (`npx vitest@1.6.0 run`).

---

## 0. Veredicto en una página

PerfilaPro es **mucho más grande de lo que la documentación refleja** y, en su mayoría, **bien construido y testeado**. El backend de los tres carriles (autónomo, B2B, Cantera) está prácticamente completo. Los problemas de lanzamiento NO son de "falta funcionalidad", son de cuatro tipos:

1. **Bloqueante fiscal (el de verdad, ya sospechado en el brief):** no se puede emitir una factura real legalmente. Cadena de tres eslabones — NIF de autónomo sin formalizar → `quipu-client.js` es esqueleto sin transmisión a AEAT/Verifactu → numeración de factura no atómica con huecos. Es un **Sprint 3 completo**, no un parche. *Matiz tranquilizador:* mientras `WEB_FUNNEL_FREE_ACTIVE` esté activo no hay venta, así que el producto **gratuito de captación puede operar hoy** sin tocar esto.

2. **Bloqueante regulatorio de menores (Cantera):** el gate de `public_card`/`card_kind` que toda la doc y los comentarios prometen **no existe en el camino de lectura** (`card.js`, `org.js`). Encender `CANTERA_VERTICAL_ACTIVE=1` hoy expondría fichas de menores públicamente. El backend de escritura es LOPD-cuidadoso; el de lectura tira eso por la borda. Esfuerzo del fix: **S**.

3. **Bloqueantes de seguridad transversales (baratos):** fallback de secreto JWT `'changeme'` en 5 sitios (incluye tokens de tutores de menores y admin), ausencia total de headers de seguridad globales (CSP/HSTS/X-Frame), endpoint `lab-gemini` vivo sin rate-limit con `ADMIN_PASSWORD` en localStorage, y un bug de schema GDPR que rompe export y purga. Todos S salvo uno.

4. **Producto-dormido vs producto-vivo:** el carril Stripe Subscription B2B está **completo en backend y testeado pero muerto en frontend** (`create-org-checkout` sin cablear, Price IDs placeholder, atribución de agentes rota). Lo único B2B operable hoy es la demo white-label 100% manual del founder.

La documentación (`CLAUDE.md`) tiene divergencias materiales con el código en los tres carriles, y carriles enteros (directorio/SEO, asistentes, subsistema de inscripción de temporada) **no están documentados**.

---

## 1. BLOQUEANTES de lanzamiento

Sin esto no se puede operar legal o comercialmente. Ordenados por dependencia/urgencia dentro de cada sub-bloque.

### 1.A · Fiscal — cobrar una factura real (Sprint 3)

| ID | Qué | Por qué importa | Archivos | Esf | Dependencias |
|----|-----|-----------------|----------|-----|--------------|
| **F1** | NIF de autónomo emisor / alta en Hacienda sin formalizar | Sin alta no se puede facturar **nada**. Es trámite externo, no de código. | `lib/quipu-client.js:13`, `docs/sprint-3-roadmap.md:351` | L (calendario) | — |
| **F2** | `quipu-client.js` es skeleton (`not implemented`) → las facturas son PDFs locales que **no se transmiten a AEAT/Verifactu** | RD 1007/2023 exige registros inalterables y remisión. Un PDF PDFKit con numeración borrable no cumple. | `lib/quipu-client.js:26,43-66`; cablear en `stripe-webhook.js:576-624` | L | F1 + elegir proveedor (Quipu/Holded/FacturaDirecta) |
| **F3** | Numeración de factura **no atómica + con huecos** | `getNextInvoiceNumber` cuenta filas (`count+1`) sin lock → dos webhooks concurrentes (o reintentos Stripe) generan el mismo `FAC-2026-0001`; un borrado retrocede el contador y reutiliza número. Viola la correlatividad sin huecos (art. 6.1.a RD 1619/2012). | `invoice-utils.js:38-47`; fallback timestamp roto en `stripe-webhook.js:590`, `resend-invoice.js:100` | M | Antes de F2 (lo enviado a AEAT debe ser válido) |
| **F4** | Decisión "quién factura" en B2B (PerfilaPro a la org vs autónomo) sin cerrar | La opción coherente con Verifactu requiere Quipu operativo. Bloquea cobro B2B recurrente. | `docs/sprint-3-roadmap.md:292-296` | M | F2 |

> **El `facturas` schema no está versionado en migraciones** (creado out-of-band en Supabase). Confirmar/añadir `UNIQUE` en `numero_factura` y versionar la DDL — es prerequisito de F3.

### 1.B · Regulatorio — datos de menores (gate Cantera)

| ID | Qué | Por qué importa | Archivos | Esf |
|----|-----|-----------------|----------|-----|
| **C1** | `/c/:slug` **no comprueba `public_card` ni `card_kind`** → ficha completa de menor (nombre, foto) pública por URL directa | `register-player.js:18` y `enrollment-submit.js:13` prometen literalmente lo contrario. `grep public_card card.js` → 0 referencias. Toda la maquinaria de consentimiento escribe `public_card=true` que **nadie lee**. | `card.js:125-131` (fix: 404 si `cardKindOf(data)!=='autonomo'` y `public_card!==true`; el helper `lib/card-kind.js` ya existe) | S |
| **C2** | `/e/:slug` lista en grid público **todas** las cards de la org sin filtrar players | Un club `kind='sports_club'` publicado expondría todos los menores por nombre+foto. `noindex` no basta para menores. | `lib/org-utils.js:71-82` (`listCardsByOrg`), `org.js:41,102-104` (fix: filtrar `card_kind='autonomo'` o `public_card=true`) | S |
| **C3** | Sin política de privacidad de menores ni DPA (art. 28 RGPD) con clubes | Activar Cantera sin esto es incumplimiento LOPDGDD grave (consentimiento parental art. 7 LO 3/2018). | `public/{es,ca}/privacidad.html` (nueva sección menores) + plantilla DPA legal | M |

> C1+C2 son el **mismo agujero** (falta de gate en el camino de lectura) y son **bloqueantes para activar el carril**, no para autónomos. Mientras `CANTERA_VERTICAL_ACTIVE` esté off, no muerden — pero deben arreglarse **antes** de la primera demo a un club.

### 1.C · Seguridad y GDPR transversales (baratos, hacer ya)

> **✅ Hito 0 RESUELTO (2026-06-02, rama `claude/perfilapro-launch-audit-1MOw3`).** Los 5 puntos de abajo están corregidos y la suite sigue verde (1460 tests). Detalle de la implementación al pie de la tabla.

| ID | Qué | Por qué importa | Archivos | Esf | Estado |
|----|-----|-----------------|----------|-----|--------|
| **S1** | Fallback de secreto JWT **`'changeme'`** en 5 sitios | Si una env var de secreto no está en prod, los JWT (agente, panel B2B, **panel padre de menores**, sesión admin) se firman con un secreto público → forja de tokens y suplantación total. | `agent-auth.js:10`, `agent-data.js:9`, `lib/panel-auth.js:35,97`, `admin-auth.js:14` | S | ✅ |
| **S2** | GDPR roto por bug de schema: `export-data` y `purge-deleted` filtran `facturas` por columnas **inexistentes** (`slug`/`numero`) | La tabla usa `stripe_session_id`/`numero_factura` (verificado contra el insert en `stripe-webhook.js:606`). `export-data` no exporta facturas nunca (derecho de portabilidad); `purge-deleted` falla el delete y **la card nunca se hard-borra** (derecho de supresión nunca completa). Los tests no lo capturan: están escritos contra el schema **documentado**, no el real. | `export-data.js:62-65`, `purge-deleted.js:44` | S | ✅ |
| **S3** | Sin headers de seguridad globales (HSTS, X-Frame-Options, X-Content-Type-Options) | Sitio con pagos y PII de menores sin baseline. `grep [[headers]]` en `netlify.toml` → 0. | `netlify.toml` | S | ✅ |
| **S4** | `lab-gemini` vivo en producción: **sin rate-limit**, `ADMIN_PASSWORD` comparada inline (fuerza-bruteable, sin lockout) y persistida en **localStorage** del navegador | Endpoint que quema dinero (Gemini de pago) por request sin throttle y expone la password que protege todo el admin. No enlazado desde navegación pero la ruta `/api/lab-gemini` está viva. | `lab-gemini.js`, `public/lab-gemini.html:124,149` | S (borrar) / M (endurecer) | ✅ parcial |
| **S5** | Redirect muerto `/api/save-card` → función inexistente | Devuelve 404 de función. Ruido/confusión. | `netlify.toml:147-150` | S | ✅ |

**Implementación (Hito 0):**
- **S1** — nuevo helper `lib/jwt-secret.js` (`resolveJwtSecret`) que lanza si ninguna env var candidata está configurada (fail-closed). Aplicado a los 5 sitios. `agent-auth`/`agent-data` pasados a resolución perezosa para no lanzar en import.
- **S2** — `export-data` filtra facturas por `card.stripe_session_id` (omite la consulta para cards free/promo sin session id); `purge-deleted` selecciona `stripe_session_id` y borra facturas por esa columna. Tests reescritos contra el schema **real** + casos nuevos para el guard de cards sin factura.
- **S3** — bloque `[[headers]]` global en `netlify.toml` (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, Permissions-Policy). **CSP enforcing NO incluida a propósito** — rompería scripts inline/Stripe/PostHog; queda como tarea de afinado aparte (M, no S).
- **S4** — **endurecido, no borrado** (es la herramienta interna del founder): rate-limit 20 req/10 min/IP antes de la auth, que cierra el vector remoto explotable (fuerza bruta del password + quema de dinero). **Residual consciente:** la `ADMIN_PASSWORD` sigue en `localStorage` del navegador del founder (`lab-gemini.html`) — exposición solo en su propio dispositivo; migrar a sesión JWT admin o borrar el lab si ya no se usa queda como decisión del founder.
- **S5** — redirect muerto eliminado de `netlify.toml`.

---

## 2. QUICK WINS (alto impacto, bajo esfuerzo)

> **✅ Q1, Q2, Q3 RESUELTOS (2026-06-02).** Detalle al pie de la tabla.

| ID | Qué | Por qué importa | Archivos | Esf | Estado |
|----|-----|-----------------|----------|-----|--------|
| Q1 | Declarar **PostHog** en la política de privacidad | El banner activa PostHog con el consentimiento de cookies pero la política lista Stripe/Supabase/Netlify/Resend y **omite PostHog**. Inconsistencia banner↔política. | `public/{es,ca}/privacidad.html:204-229` | S | ✅ |
| Q2 | Habilitar **RLS** en 3 tablas que la rompen | `org_invoices` (importes B2B+`agent_code`), `enrollment_campaigns`, `card_documents` no tienen `ENABLE ROW LEVEL SECURITY`, rompiendo el patrón de 024/033 ("RLS on en todo"). | `029:66`, `037:21,77` | M | ✅ |
| Q3 | Sincronizar **`.env.example`** con el código | ~12 vars usadas pero ausentes: `ADMIN_JWT_SECRET`, `ADMIN_SESSION_TTL_MINUTES`, `PARENT_PANEL_JWT_SECRET`, `B2B_LEAD_INBOX`, `DEMO_FUNNEL_FREE_ACTIVE`, `WEB_FUNNEL_FREE_ACTIVE`, bloque Cantera completo. `GEMINI_API_KEY` ausente de la tabla de `CLAUDE.md`. | `.env.example`, `CLAUDE.md` | S | ✅ |

**Implementación (Q1-Q3):**
- **Q1** — PostHog añadido a la lista de encargados del tratamiento y a la sección de cookies (con la condición de consentimiento explícito) en `privacidad.html` ES y CA; fecha actualizada a junio 2026.
- **Q2** — migración `038_rls_missing_tables.sql`: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` en las 3 tablas, con contramigración. `supabase/RLS.md` actualizado. **NO ejecutada en prod** (la corre el founder con el resto). Idempotente.
- **Q3** — `.env.example` completado (bloque admin JWT, B2B_LEAD_INBOX, funnels, bloque Cantera entero); `GEMINI_API_KEY` + admin JWT añadidos a la tabla de `CLAUDE.md`.
| Q4 | Corregir las **divergencias doc↔código** de `CLAUDE.md` | (a) `download-qr.js` no existe — reemplazado por `qr.js` público `/api/qr/:slug`; el email enlaza ahí (`stripe-webhook.js:99`). (b) `delete-account` es **soft-delete + purga 30d**, no hard-delete. (c) schema `facturas` mal documentado (causa de S2). (d) panel cliente ya hace offboard/resend/download (listados como founder-only). | `CLAUDE.md` | S |
| Q5 | Documentar carriles ausentes de `CLAUDE.md` | Directorio + SEO/sitemaps + `/p/:slug`, `gbp-assistant`, `share-image`, `qr` por tier, `purge-deleted` (job GDPR crítico), y el **subsistema de inscripción de temporada** (migración 037, `enrollment-*`). Es la mayor laguna documental del repo. | `CLAUDE.md` | M |
| Q6 | Tests para superficie crítica sin cobertura | `card.js` (render público server-side con `esc()` — superficie XSS, hoy 0 tests de su handler), `admin-agents` (comisiones), `admin-data`, `admin-invoices`, `invoice-utils` (IVA + numeración, hoy 0 tests). | `tests/` (nuevos) | M |
| Q7 | Borrar **librería SSR muerta** | `lib/{render,pro-card,url-pill,avatar,icon-sprite,icons,logo,isotype}.js` + tests `render.test.js`/`lib-icons.test.js`: ningún Netlify Function los importa (gemelo JS abandonado del showcase `public/_dev/`). Sus tests los mantienen "verdes" y enmascaran que están huérfanos. Confirmar con founder que no hay migración SSR pendiente. | citados | S |
| Q8 | Declarar/verificar edge `lang-detect` en `netlify.toml` | Existe `netlify/edge-functions/lang-detect.js` pero solo `rate-limiter` está en `[[edge_functions]]`. Si depende de registro explícito, la detección de idioma en `/` no funciona. | `netlify.toml` | S |
| Q9 | B2B: poblar `current_period_end` en el checkout | Hoy queda NULL hasta que llegue `subscription.updated`; si ese evento se pierde, el panel no sabe cuándo renueva. | `lib/org-subscription.js:134-137` (`stripe.subscriptions.retrieve()`) | S |
| Q10 | Kit banner para cards **promo-redimidas** en el editor | Una card promo (sin `stripe_session_id`, con `kit_email_sent_at`) oculta el freeBanner pero tampoco muestra el kit banner → sin acceso a re-descargas pese a plan activo. | `public/{es,ca}/editar.html:1482` | S |
| Q11 | Limpiezas Cantera | (a) Código muerto `makePlayerSlug` usa `crypto` sin importar (`register-player.js:50-52`) — borrar. (b) `request-transfer` persiste `requested_by_email='club'` siempre porque no selecciona `email` (`request-transfer.js:84-86,136`). | citados | S |

---

## 3. DEUDA DIFERIBLE (consciente, post-lanzamiento)

| Qué | Notas | Archivos | Esf |
|-----|-------|----------|-----|
| **Activar carril de cobro B2B self-serve** | Backend completo y testeado pero **muerto en frontend**: `create-org-checkout` sin cablear a CTAs (`empresas.html` solo postea a `lead-b2b`), 4 Price IDs son placeholders, y la cadena de atribución de agentes está rota (`admin-orgs create/update` y `leads_assign` no aceptan/copian `agent_code` → agentes no cobran comisión B2B). Decisión de producto: ¿se activa self-serve o sigue siendo venta manual? | `create-org-checkout.js`, `empresas.html:278-322`, `admin-orgs.js:362,1222`, `agent-data.js` | M |
| Apagar `WEB_FUNNEL_FREE_ACTIVE` y validar checkout live B2C end-to-end | El cobro real **nunca se ha ejercido en live**; no hay test de integración contra Stripe live. Depende de Sprint 3 fiscal. | `register-free.js:276-324` | M |
| Verificación del tutor en inscripción self-service (R1) | `enrollment-submit.js` es público; cualquiera con el `public_token` (no secreto) auto-otorga consentimientos con `second_factor:'self_service'`. Mitigado porque deja `public_card=false` (la visibilidad real exige el flujo verificado de `parent-consent`). Trade-off MVP a ratificar conscientemente. | `enrollment-submit.js:74-211` | M |
| Teléfonos/WhatsApp de autónomos indexables en Google | `/p/:slug` expone `telefono`/`whatsapp` en HTML + JSON-LD sin `noindex`. Es por diseño (tarjeta de contacto), pero ratificar como decisión de privacidad. | `perfil-publico.js:80,100,148` | S |
| Gate `isCanteraActive()` en `print-order-export` y `nfc-register` | Mitigado por auth founder+TOTP, pero rompe el apagado total del carril. | citados | S |
| `org_invoices` huérfanas (`organization_id=NULL`) si `invoice.paid` gana la carrera al checkout | El comentario menciona un "reconciler futuro" que no existe. La comisión por `agent_code` sí se calcula. | `lib/org-subscription.js:316-318` | M |
| Comparaciones no timing-safe en admin-auth | `===` en password/OTP. Bajo riesgo dado rate-limit 10/15min. | `admin-auth.js:75,99` | S |
| `create-checkout` no deduplica slug | El upsert por slug del webhook podría sobrescribir una card si se invoca el endpoint directo. Contenido porque el editor siempre pasa `slug`. | `create-checkout.js:58-61` | M |
| Cuota dividida custodia compartida (Cantera Q4) | MVP asume 1 pagador. Reabrir a Sprint 1 si el club beachhead estima >15% custodia compartida. | `parent_subscriptions` | M |
| Refresco proactivo de flags Connect | Depende de `account.updated` (requiere `STRIPE_CONNECT_WEBHOOK_SECRET` + evento suscrito) o llamada manual a `status`. Documentar en onboarding del club. | `stripe-connect-onboard.js`, `lib/cantera-webhook.js` | S |
| Paridad i18n menor | `directorio`/`/p/:slug` monolingües es (deuda consciente). Solo existe `public/es/onboarding.html` (falta `/ca/`). `/e/:slug` solo español. | varios | S |
| `register-free` no persiste `descripcion` como campo independiente (se pliega en `tagline`) | A diferencia de webhook/edit-card. | `register-free.js:164` | S |
| `directory-options` sin rate-limit ni `makeHandler` | Datos públicos no sensibles, cache 1h. Riesgo bajo. | `directory-options.js:5` | S |
| Stripe test keys / entorno preview | No hay keys test; probar en local usa keys de producción (riesgo operativo, no legal). | `docs/keys-inventory.md:33` | S/M |
| Plantilla de "recibo informativo" Cantera | `CLAUDE.md` la describe pero `lib/external-payments.js` solo inserta filas; no genera PDF. Alinear doc o implementar. | `lib/external-payments.js` | S |

---

## 4. Estado por carril (resumen)

| Carril | Backend | Frontend / operable hoy | Bloqueantes propios |
|--------|---------|--------------------------|---------------------|
| **B2C autónomo** | Sólido, end-to-end, bien testeado (213 tests del carril) | Sí, pero **operando gratis** (web funnel); cobro live sin validar | S2 (GDPR schema), F1-F3 (facturar) |
| **B2B** | Completo y testeado (390 tests) | **Solo demo white-label manual del founder**; cobro recurrente nunca ejercido | Activación frontend + Price IDs + atribución agentes (diferible/decisión) |
| **Cantera + Inscripción** | Capas 0-6 + enrollment completos y testeados; LOPD-cuidadoso en escritura | Gateado off (`CANTERA_VERTICAL_ACTIVE`) | **C1, C2** (gate lectura menores), C3 (legal), R1 |
| **Fiscal/Legal** | Legal pages, IVA, banner consentimiento: **bien hechos** | Comprobante promo bien diferenciado de factura | **F1-F4** (Verifactu/AEAT) — el bloqueante de cobro real |
| **Infra/Calidad** | Suite verde 1457 tests; flags reversibles limpios; TOTP/rate-limit/PII sólidos | — | **S1, S3, S5**; RLS en 3 tablas |
| **SEO/Directorio/IA** | Directorio+sitemaps+`/p/:slug` producción sólida | Indexado y vivo | **S4** (lab-gemini); librería SSR muerta a borrar |

---

## 5. Secuencia recomendada de lanzamiento

El producto puede lanzarse **gratuito (captación, wedge B2C→B2B)** mucho antes que el **comercial (cobro real)**. Esto define dos hitos.

### Hito 0 — Antes de cualquier exposición pública (días, todo S salvo Q2/Q6)
Cerrar la seguridad y el GDPR baratos. Nada aquí depende de Hacienda ni de Stripe live.
1. ✅ **S1** — eliminar fallback `'changeme'` (forja de JWT). *Hecho.*
2. ✅ **S2** — arreglar schema GDPR en `export-data`/`purge-deleted` (filtrar por `stripe_session_id`). *Hecho.*
3. ✅ **S3** — añadir headers de seguridad globales en `netlify.toml`. *Hecho (CSP afinada pendiente).*
4. ✅ **S4** — `lab-gemini` endurecido con rate-limit (residual localStorage anotado). *Hecho.*
5. ✅ **S5** — borrar redirect muerto `/api/save-card`. *Hecho.*
6. ✅ **Q1** (PostHog en privacidad), ✅ **Q2** (RLS 3 tablas, migración 038), ✅ **Q3** (`.env.example` + tabla CLAUDE.md). *Hechos.*

### Hito 1 — Lanzamiento del producto gratuito (B2C captación)
Ya operable con Hito 0 hecho. `WEB_FUNNEL_FREE_ACTIVE=1` evita el bloqueante fiscal.
7. **Q4, Q5** — sanear documentación (evita que el siguiente que toque el código repita errores).
8. **Q6** — tests de `card.js` (XSS) e `invoice-utils` (IVA/numeración, prerequisito de F3).
9. **Q7-Q11** — limpiezas y fixes menores de editor/B2B/Cantera.

### Hito 2 — Activar Cantera (cuando haya club beachhead)
10. **C1, C2** — gate de `public_card`/`card_kind` en `card.js` y `org.js`. *Innegociable antes de la primera ficha de menor.*
11. **C3** — política de privacidad de menores + DPA con el club.
12. Ejecutar migraciones **033→034→035→036→037** en orden + env vars Cantera + suscribir eventos Connect en Stripe.
13. Decidir R1 (verificación tutor en inscripción).

### Hito 3 — Lanzamiento comercial (cobro real) = Sprint 3
El bloque más pesado y de mayor latencia (trámites + proveedor externo). Empezar **F1 ya** en paralelo a todo lo anterior porque es el de mayor calendario.
14. **F1** — formalizar alta de autónomo / NIF activo. *(arrancar desde el día 1)*
15. **F3** — numeración atómica (secuencia Postgres / RPC) + versionar DDL de `facturas` con `UNIQUE`.
16. **F2** — elegir proveedor Verifactu, implementar `quipu-client.js`, cablear en `stripe-webhook`.
17. **F4** — decidir modelo de facturación B2B.
18. Apagar `WEB_FUNNEL_FREE_ACTIVE`, crear 4 Price IDs B2B en Stripe live, cablear `create-org-checkout` al frontend y la atribución de agentes; validar checkout live end-to-end.

---

## 6. Notas de método y confianza

- **Discrepancia reconciliada:** dos agentes difirieron sobre si `purge-deleted` funciona. Verificado directamente: la tabla `facturas` tiene `numero_factura`/`stripe_session_id` (no `slug`/`numero`), confirmado contra `stripe-webhook.js:606`, `resend-invoice.js:72`, `admin-invoices.js:24`. El filtro por `slug` en `export-data`/`purge-deleted` **es** un bug real (S2).
- **Tests verdes ≠ correcto:** S2 demuestra que un test escrito contra el schema documentado puede pasar mientras el código falla en producción. Varios "verdes" enmascaran código muerto (Q7) o schema equivocado (S2).
- **`CLAUDE.md` va por delante en unos sitios y por detrás en otros:** describe `download-qr` que no existe, dice "hard-delete" donde hay soft-delete, marca como founder-only capacidades que el panel cliente ya tiene, y omite carriles enteros (directorio, inscripción). Tratarlo como mapa, no como verdad.
- Los hallazgos `archivo:línea` de cada carril están en los informes de los 6 subagentes (no committeados; resumidos aquí).
