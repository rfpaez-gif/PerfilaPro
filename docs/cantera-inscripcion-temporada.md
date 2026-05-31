# Cantera · Inscripción de temporada (diseño)

> Documento de diseño. **No es código.** Base para implementar la captación
> masiva de inicio de temporada en el vertical Cantera. Estado: propuesta
> para validar antes de aterrizar.

## 1. Filosofía y problema

PerfilaPro debe **facilitar al máximo** el inicio de temporada, que hoy
desborda a quien lo gestiona. La realidad del fútbol base en septiembre:
un aluvión de niños y niñas se matricula, los clubes arman equipos según
las inscripciones que reciben, los padres pagan matrícula + cuotas, y los
niños arrancan el curso encuadrados y con su ficha federativa para competir.

El proceso debe ser **masivo y flexible**, y servir a los **tres actores**:

- **Club** → menos Excel, cobro automatizado, alta federativa medio hecha.
- **Padre/madre** → una sola pantalla: inscribe, consiente, paga, y su hijo
  tiene carnet portable.
- **Federación** → recibe del club datos completos y correctos a la primera.

### Distinción conceptual clave: inscripción ≠ fichaje

Hoy el Studio mete ambos en la pestaña "Fichajes". Son procesos distintos:

- **Fichaje / traspaso** — mover a un jugador de un club PerfilaPro a otro.
  Flujo transaccional ya construido (`request-transfer` / `accept-transfer`).
- **Inscripción de temporada** — el alta masiva de septiembre. Es lo que
  diseña este documento. Es captación nueva, no movimiento entre clubes.

## 2. Las tres fronteras de dinero (no mezclar)

| Flujo | Paga → cobra | Rol PerfilaPro | 3% |
|---|---|---|---|
| **Carnet 12€ / renovación 6€** | Club → **PerfilaPro** (directo, no Connect) | **Producto nuestro.** La llave del Dashboard | — |
| **Matrícula + cuota mensual** | Padre → **Club** (Connect direct charge) | **Facilitamos el cobro** | ✅ 3% |
| **Licencia federativa** (nominal/niño) | Club → **Federación** (fuera de PerfilaPro) | **Solo facilitamos datos.** Ni cobramos ni tramitamos | — |

La licencia federativa **no es una línea de cobro nuestra**: es un
dato/documento que capturamos una vez y exportamos. Las federaciones tienen
su propio core de altas; no lo invadimos.

## 3. Multi-método de cobro: el servicio es la conciliación

No elegimos un método de pago: **soportamos la variedad y la conciliamos**.
El club no debe pelear con que una familia domicilia, otra hace Bizum y otra
paga en efectivo. Le damos una sola foto: **quién pagó y quién debe**.

| Método | Cómo se gestiona | Mueve dinero PP | 3% |
|---|---|---|---|
| Domiciliación **SEPA** | Stripe Connect, recurrente | Sí | ✅ |
| **Tarjeta** | Stripe Connect, recurrente | Sí | ✅ |
| **Bizum** | El club lo apunta → `external_payments` | No | — |
| **Efectivo** | El club lo apunta → `external_payments` | No | — |
| **Transferencia** | El club lo apunta → `external_payments` | No | — |

**Matiz de negocio:** el 3% solo entra por Connect. Bizum/efectivo se
gestionan como servicio, sin ingreso directo. Diseño: **empujar suave**
hacia el cobro automatizado (menos trabajo para club y padre) **sin bloquear
nunca** los métodos manuales (bloquearlos = perder clubes).

Buena noticia: los ladrillos ya existen — `parent_subscriptions` (Stripe) +
`external_payments` (manual) + la pestaña **Cobros** que ya los une.

## 4. Modelo de "Campaña de inscripción"

Un club abre una **campaña de temporada** y comparte un **enlace + QR
público**. Convierte el trabajo del club de O(N) a O(1): reparte el QR en la
reunión de inicio y los padres se autoinscriben desde el móvil.

```
[Club abre campaña] --enlace/QR--> [Padres se autoinscriben] --> [Club encuadra equipos]
       (1 acción)                   (1 pantalla c/u)              (en lote, por categoría)
                                          |
                                   matrícula + cuota
                                   (Connect / o "pago al club")
```

**Tabla nueva `enrollment_campaigns`** (propuesta):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK → organizations | club dueño |
| `season` | text | `YYYY-YY` |
| `public_token` | text UNIQUE | el del enlace `/inscripcion/:token` |
| `status` | text | `open` / `closed` |
| `matricula_cents` | integer null | pago único (0/null = sin matrícula) |
| `monthly_fee_cents` | integer null | cuota; fallback a `organizations.cantera_monthly_fee_cents` |
| `concepts_jsonb` | jsonb | conceptos extra opcionales (equipación…) |
| `opens_at` / `closes_at` | timestamptz null | ventana opcional |
| `created_at` | timestamptz | |

## 5. Ficha de campos del formulario del padre (punto único de captura)

Marcas: 🏛️ federativa · 💶 cobros · 🔒 LOPD · 🪪 carnet. `*` = obligatorio.

### Sección 1 · El/la deportista
| Campo | Marca | Mapeo / estado |
|---|---|---|
| Nombre y apellidos * | 🏛️💶🪪 | `cards.nombre` ✅ |
| Fecha de nacimiento * | 🏛️ + categoría auto | `birth_date_encrypted` / `birth_year` ✅ |
| Sexo | 🏛️ | `cards.gender` ✅ |
| Foto tipo carnet | 🏛️🪪 | `cards.foto_url` ✅ (upload) |
| Tipo de documento (DNI/NIE/pasaporte/libro de familia) | 🏛️ | ❌ **nuevo** `cards.doc_kind` |
| Nº de documento | 🏛️ | ❌ **nuevo** `cards.doc_number` |
| Nacionalidad | 🏛️ | ❌ **nuevo** `cards.nationality` |
| Dirección (calle, CP, población) | 🏛️💶 | parcial — `cards.direccion` existe |

### Sección 2 · Tutor/a legal (+ 2º tutor opcional)
| Campo | Marca | Mapeo / estado |
|---|---|---|
| Email del tutor legal * | 🔒💶 | `card_admins.email` ✅ |
| Nombre completo del tutor * | 🏛️💶 | ❌ **nuevo** `card_admins.name` |
| DNI del tutor * | 🏛️ (menor sin DNI) + 💶 facturación | ❌ **nuevo** `card_admins.dni` |
| Teléfono del tutor * | 💶 | ❌ **nuevo** `card_admins.phone` |

### Sección 3 · Documentos (upload; obligatoriedad la decide la federación)
| Documento | Marca | Estado |
|---|---|---|
| DNI del jugador o libro de familia | 🏛️ | ❌ **nuevo** (bucket + `card_documents`) |
| Certificado médico / alta mutualidad | 🏛️ | ❌ **nuevo** (puerta de la competición) |

### Sección 4 · Consentimientos (LOPDGDD)
| Consentimiento | Marca | Mapeo / estado |
|---|---|---|
| Tratamiento de datos del menor * | 🔒 | `card_consents.parental_initial` / `data_processing` ✅ |
| Cesión de derechos de imagen (ficha pública + carnet) | 🔒🪪 | `card_consents.image_rights` + `public_visibility` ✅ |

**2º factor LOPD en self-service:** hoy el 2º factor es la fecha de
nacimiento *que el club registró*. En self-service la teclea el propio padre,
así que **ya no sirve** como factor independiente. En este carril la prueba
de identidad pasa a ser **control del email** (magic-link / OTP) + **pago con
tarjeta/IBAN a su nombre**. Hay que ajustar `lib/consent.verifySecondFactor`
para el carril self-service (no afecta al carril club-driven actual).

### Sección 5 · Pago
- Muestra los conceptos de la campaña: **Matrícula** (única) + **Cuota
  mensual** (+ opcionales).
- Método a elegir por el padre:
  - **Online** (SEPA / tarjeta) → Checkout Connect, 3% para PerfilaPro.
  - **"Pagaré al club"** (Bizum/efectivo/transferencia) → no cobra online;
    el club lo registra después en `external_payments`.

## 6. Boceto — Pantalla A · Inscripción del padre (un scroll de móvil)

```
┌─────────────────────────────────────────┐
│  [escudo]  Escuela de Fútbol Universal    │
│  Inscripción temporada 2026-27            │
├─────────────────────────────────────────┤
│  ① EL/LA DEPORTISTA                        │
│  Nombre y apellidos      [_______________]│
│  Fecha de nacimiento     [__/__/____]     │
│    └ Categoría: Alevín  (calculada sola)  │
│  Sexo                    (M) (F) (X)      │
│  Foto carnet             [ 📷 subir ]      │
│  Documento  [DNI ▾] nº   [_____________]  │
│  Nacionalidad            [Española ▾]     │
│  Dirección               [_____________]  │
├─────────────────────────────────────────┤
│  ② TUTOR/A LEGAL                           │
│  Nombre completo *       [_____________]  │
│  DNI *                   [_____________]  │
│  Email *                 [_____________]  │
│  Teléfono *              [_____________]  │
│  + Añadir 2º tutor/a (opcional)           │
├─────────────────────────────────────────┤
│  ③ DOCUMENTOS (si tu club los pide)        │
│  DNI / libro de familia  [ 📎 subir ]      │
│  Certificado médico      [ 📎 subir ]      │
├─────────────────────────────────────────┤
│  ④ CONSENTIMIENTOS                          │
│  ☐ Autorizo el tratamiento de datos *      │
│  ☐ Cedo derechos de imagen (ficha+carnet)  │
├─────────────────────────────────────────┤
│  ⑤ PAGO                                     │
│  Matrícula (única) ............  35,00 €   │
│  Cuota mensual ................  30,00 €   │
│  Cómo quieres pagar:                       │
│   ( ) Domiciliación / tarjeta (online)     │
│   ( ) Bizum / efectivo (lo gestiono        │
│       con el club)                         │
│                                            │
│         [  Inscribir a mi hijo/a  →  ]     │
└─────────────────────────────────────────┘
```

Al enviar: se crea la ficha (`cards` player, `public_card=false`, slug opaco),
la membresía de temporada con categoría auto, los `card_admins`, los
`card_consents`; y —si eligió online— se lanza el Checkout Connect.

## 7. Boceto — Pantalla B · Centro de cobros del club (conciliación)

Vista por jugador × periodo. Une Stripe + manual. Columnas: **matrícula
(única) + 9 mensualidades**. Estado por celda: ✅ pagado · ⏳ pendiente ·
🟡 parcial. (El boceto muestra los primeros meses por espacio.)

```
┌──────────────────────────────────────────────────────────────┐
│  COBROS · Temporada 2026-27          MRR Connect: 1.240 €      │
│  [Alevín ▾] [Todos los métodos ▾]      Pendiente: 8 jugadores  │
├───────────────┬──────┬─────┬─────┬─────┬─────┬───────────────┤
│ Jugador       │ Matríc│ Sep │ Oct │ Nov │ Dic │ Método        │
├───────────────┼──────┼─────┼─────┼─────┼─────┼───────────────┤
│ Lucía F.      │  ✅  │ ✅  │ ✅  │ ✅  │ ⏳  │ SEPA (auto)   │
│ Hugo M.       │  ✅  │ ✅  │ ✅  │ ⏳  │ ⏳  │ Bizum (manual)│
│ Marc R.       │  ✅  │ ✅  │ 🟡  │ ⏳  │ ⏳  │ Efectivo      │
│ ...           │      │     │     │     │     │  [+ apuntar]  │
└───────────────┴──────┴─────┴─────┴─────┴─────┴───────────────┘
[📤 Exportar cobros CSV]      [📥 Pedir carnets del club (12€/ud)]
```

- Las celdas SEPA/tarjeta se rellenan solas desde `parent_subscriptions`
  (status + `current_period_end`) y los `invoice.paid` del webhook.
- Las celdas Bizum/efectivo las marca el club con **"+ apuntar"** →
  `external_payments` (period = el mes, method, importe, nota).
- "Exportar cobros CSV" = conciliación para la gestoría del club.
- "Pedir carnets" reusa el `create-setup-fee-checkout` ya existente.

## 8. El puente federativo (facilitar sin invadir)

El formulario captura **una sola vez** lo que la federación pedirá. PerfilaPro
no tramita la licencia: **exporta** un paquete estandarizado (datos + enlaces
a documentos) para que el club lo vuelque en el sistema federativo sin
recopilar dos veces. Esto reduce rechazos típicos (foto desactualizada, DNI
ausente, datos del tutor incompletos). Integración federativa real = fase 2.

## 9. Alcance MVP vs fases

**MVP (objetivo: usable en una campaña de septiembre real):**
1. `enrollment_campaigns` + abrir campaña desde el Studio (enlace/QR).
2. Endpoint público de inscripción (sin auth org-panel) → crea ficha +
   membresía + tutores + consentimientos.
3. Formulario del padre (pantalla A) con pago online (SEPA + tarjeta) **o**
   "pago al club".
4. Matrícula (única) + cuota (recurrente) en el checkout Connect.
5. Encuadre del club: bandeja de inscripciones agrupadas por categoría,
   asignar equipo/dorsal en lote.
6. Centro de cobros conciliado (pantalla B) por jugador/mes.

**Fase 2:**
- Upload y export de documentos federativos + tracking mutualidad/cert médico.
- Export federativo estandarizado (paquete por jugador).
- Integración federativa directa (cuando haya federación firmada).
- Import CSV del club (vía alternativa para quien ya tiene su lista).

## 10. Qué reusa y qué es nuevo

**Reusa (ya construido):**
- Creación de ficha de jugador — lógica de `register-player.js` (extraer a
  `lib/player-create.js` para compartir con el endpoint público).
- Categoría automática — `lib/sports-categories`.
- Slug opaco anti-doxxing + `card_consents` + roles `card_admins`.
- Cobro recurrente Connect + 3% — `create-parent-checkout` (a extender).
- Cobros manuales — `lib/external-payments` (ya soporta bizum/efectivo/
  transferencia, con `period`, `receipt_number`, `notes`).
- Carnets — `create-setup-fee-checkout` + `printable-card-utils`.

**Nuevo:**
- Tabla `enrollment_campaigns`.
- Columnas en `cards` (player): `doc_kind`, `doc_number`, `nationality`.
- Columnas en `card_admins`: `name`, `dni`, `phone`.
- `card_documents` (o `cards.documents_jsonb`) + bucket de storage.
- Endpoints: `enrollment-open` (club), `enrollment-submit` (público),
  extensión de `org-panel` para la matriz de cobros.
- Checkout: añadir **matrícula única** (`subscription_data.add_invoice_items`)
  + **SEPA** (`payment_method_types` / automatic) a `create-parent-checkout`
  o un nuevo `create-enrollment-checkout`.

## 11. Decisiones

**Cerradas:**

1. **Matrícula one-shot** ✅. Se cobra **una sola vez**, en el mismo checkout
   que arranca la cuota mensual (vía `subscription_data.add_invoice_items`):
   el padre paga matrícula + primera cuota en un único pago y queda la
   suscripción activa.
2. **Documentos en MVP, completables después** ✅. El formulario los acepta en
   la inscripción pero **opcionales**; lo que falte queda marcado como
   "documentación pendiente" y se sube luego desde el panel (padre o club).
4. **Temporada = matrícula + 9 mensualidades** ✅. El centro de cobros (§7)
   pinta la matrícula + 9 meses.

3. **Gate del Dashboard por carnets → comercial, no técnico** ✅. Cualquier
   `sports_club` entra al Studio sin pagar carnets; el carnet es el paso
   natural del onboarding, no un muro de entrada.
5. **Visibilidad del perfil del menor (`public_card`) → habilita pero no
   dispara** ✅. Distinguir:
   - **Licencia federativa** = la da la federación; fuera de PerfilaPro.
   - **Tarjeta digital `/c/:slug`** = nuestra; arranca oculta
     (`public_card=false`).
   El **carnet físico lleva QR/NFC → `/c/:slug`**. Regla acordada: consentir
   imagen hace el perfil **accesible por su URL** (para que el carnet
   funcione) pero **siempre `noindex`** (nunca googleable para un menor); la
   visibilidad plena sigue siendo un acto explícito posterior.

## 12. Plan de implementación por capas (MVP)

Estilo Cantera: cada capa es pequeña, gateada por `isCanteraActive()`,
testeable por separado y reversible. Orden por dependencias.

| Capa | Qué | Depende de |
|---|---|---|
| **I0 · Migración 037** ✅ | Tabla `enrollment_campaigns`; columnas `cards.{doc_kind,doc_number,nationality}`; `card_admins.{name,dni,phone}`; tabla `card_documents`; `parent_subscriptions.{enrollment_campaign_id,matricula_cents,matricula_paid_at}`. Todo nullable/nuevo → cero impacto. Contramigración al pie. | — |
| **I1 · Libs puros** ✅ | `lib/player-create.js` (extrae la creación de ficha de `register-player`; éste delega ahora en él); `lib/enrollment.js` (valida/normaliza payload del padre, doc flexible); `lib/season-billing.js` (9 periodos `YYYY-MM` + conciliación jugador×periodo desde `parent_subscriptions` + `external_payments` + matrícula). 45 tests verdes (`tests/lib-{player-create,enrollment,season-billing}.test.js`). | — |
| **I2 · Checkout de inscripción** ✅ | `create-enrollment-checkout` (auth parent-panel) + `lib/enrollment-checkout.js`: `mode:'subscription'` + `add_invoice_items` (matrícula one-shot) + `payment_method_types:['card','sepa_debit']` + `application_fee_percent`, direct charge en la cuenta Connect del club. **Reusa `metadata.kind='cantera-parent-fee'`** (no un kind nuevo) para heredar el routing de subscription/invoice ya existente; el webhook (`handleParentCheckoutCompleted`) se enriquece para snapshotear `matricula_cents`/`matricula_paid_at`/`enrollment_campaign_id` cuando vienen, y sigue idéntico para la cuota suelta. Campaña opcional: si `campaign_id` viene, sus importes mandan sobre la cuota base del club. 18 tests nuevos + 2 al webhook. | I0 |
| **I3 · Abrir campaña (Studio)** ✅ | Acciones `org-panel`: `enrollment_open` / `enrollment_close` / `enrollment_get` (gateadas por flag + `sports_club`, scoped al JWT) + `lib/enrollment-campaign.js` (token público, URL `/es/inscripcion/:token`, validación de importes). UI pestaña "Inscripciones" en el Studio: form de apertura (temporada/matrícula/cuota/mensualidades) ↔ vista con enlace + QR + contador + cerrar. 18 tests nuevos. **Deuda:** el QR se genera vía `api.qrserver.com` (externo); migrar a generación server-side con el paquete `qrcode` ya presente queda pendiente. | I0 |
| **I4 · Inscripción pública (pantalla A)** ✅ | `enrollment-submit` (público, valida `public_token` de campaña abierta, honeypot, rate-limit) → crea ficha vía `lib/player-create` (`public_card=false` siempre) + consentimientos LOPDGDD (`parental_initial`+`data_processing`, +`image_rights` si se marca; evidence `second_factor='self_service'`) + email parent-panel; devuelve `parent_session` para que el front encadene I2 si `payment_choice='online'`. Página `enrollment-page` sirve `/{es,ca}/inscripcion/:token` (form self-contained o "cerrada", siempre noindex). 20 tests. **Pendiente:** upload de foto/docs en el form queda para I7 (se completan desde el panel). | I1, I2, I3 |
| **I5 · Encuadre del club** | `org-panel`: `enrollment_inbox` (inscripciones agrupadas por categoría auto) + `enrollment_assign` (equipo/dorsal en lote). UI bandeja. | I0, I4 |
| **I6 · Centro de cobros (pantalla B)** | `org-panel`: `billing_matrix` (jugador×periodo vía `lib/season-billing`). UI matriz + "+ apuntar" (reusa `record-external-payment`) + export CSV. | I0, I1, I2 |
| **I7 · Completar documentos después** | Panel del padre: subir los docs que faltaron en la inscripción → `card_documents`. (Export federativo estandarizado = fase 2.) | I0, I4 |

**Núcleo MVP:** I0 → I6 (I7 parcial entra por la decisión 2). Cada capa se
commitea y, donde aplique, se acompaña de sus tests Vitest.
