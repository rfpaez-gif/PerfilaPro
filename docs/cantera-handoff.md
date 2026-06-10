# Cantera · estado del sprint y handoff entre hilos

Este documento es el **bookmark** del trabajo en curso sobre el vertical Cantera (deporte base). Cuando un hilo nuevo abre, leerlo después de la sección "Cantera · vertical deporte base" de `CLAUDE.md` da el contexto exacto donde se dejó.

Última actualización: 2026-06-10 — **naming del programa cerrado** (ver banner **🏷️ MARCA DEL PROGRAMA**): *Programa **Savia Joven*** + lema *"Crece jugando, con los tuyos."* + carnet ***Dorsal***. Pendiente verificación legal (Fase 0). Antes (2026-06-09 noche): **canal B2C: pago reactivado en modo Test** (ver banner **🟢 B2C PAGO REACTIVADO**). Antes (tarde): **deploy de Netlify arreglado** (#185): la suite dejó de correr como build command de Netlify y pasó a GitHub Actions; el primer deploy verde desde el ~7 jun (`074c750`) llevó **a producción real** todo lo mergeado de #181–#184 (Bizum + Connect Express + UI carnet), que estaba en `main` pero **nunca se había desplegado**. Ver banner **🔧 DEPLOY ARREGLADO** abajo. *(Antes: chunk (4) Bizum + Connect Express mergeado en #184, suite 1650/1650. **Sprint Cantera cerrado**, salvo habilitar Bizum en el Dashboard de Stripe en modo Live. UI del carnet items 1–3 mergeada en #183.)*

---

## 🏷️ MARCA DEL PROGRAMA (2026-06-10 · naming cerrado, pendiente verificación legal)

Decisión de naming para el paraguas institucional del vertical Cantera — el "programa blanco" que se vende a **CARM + mecenas + FFRM** (no es un nombre técnico, es el relato comercial/institucional). Sistema cerrado en sesión de naming; **no es oficial hasta pasar el checklist de Fase 0** (abajo).

### Sistema de marca

> ## Programa **Savia Joven**
> ### *Crece jugando, con los tuyos.*
> **El carnet (producto tangible):** tu **Dorsal**.

- **Nombre del programa**: **Savia Joven**. Sustantivo cálido = identidad/pertenencia. El verbo de acción NO va en el nombre (un nombre es sustantivo; el empujón vive en el lema, patrón Nike↔"Just Do It").
- **Lema**: ***"Crece jugando, con los tuyos."*** — funde crecimiento (savia→crecer) + deporte (jugando) + familia/equipo/Región (con los tuyos). Los **tres actores** del modelo cantera en 4 palabras: el chaval crece, juega, y la familia/club está detrás (la familia es el comprador y el motor emocional).
- **Carnet**: **Dorsal** — la credencial física PVC+QR (capa 5 / sección ★) se nombra "tu Dorsal". El dorsal ES la identidad portable del jugador.

### Reservas (por si hay colisión en la verificación legal)
En orden de preferencia: **Savia Nueva** · **Savia Activa** · **Latido**.
- *Savia Nueva* — talento joven emergente (idiom); algo más sugestivo/débil como marca.
- *Savia Activa* — el verbo dentro del nombre ("activa" = adjetivo + orden); mejor como campaña que como marca.
- *Latido* — vida/salud/pasión; distintivo y poco saturado; fuera de la familia "Savia".

### Titulares de spot (registro emocional, para campaña/vídeo)
- *"Los tuyos no quieren perderse ni un partido."*
- *"Detrás de cada jugador, los suyos."*
- *"A los tuyos les encanta verte crecer."*

### Relato y tono de voz
- **Metáfora madre**: la savia sube desde las **raíces** → la **familia es la raíz que nutre**, el **club la encauza**, el **chaval es la rama que crece**. Murcia, "huerta de Europa", es el sustrato fértil del que brota la savia del deporte base. La huerta vive en el relato, no en el nombre (nombres literales tipo "huerta/campo" suenan a marca de hortalizas).
- **Tono CARM**: imperativo y cálido (*crece, muévete, juega, cuida*), nunca burocrático. Calcado del registro de las campañas de salud/deporte de la Región (*Activa Murcia*, *Movimiento Actívate*, *Murcia Muévete*, Deporte en Edad Escolar). Pendiente: localizar el spot TV concreto que el founder tiene de referencia (canal [Publicidad Institucional – Región de Murcia](https://www.youtube.com/@publicidad-gob-regiondemurcia)) para afinar el ritmo del copy.
- **Tripleta institucional** (para decks ante CARM/FFRM/mecenas): *"Crecer jugando, crecer sano, crecer protegido."* → deporte · salud · **LOPIVI/protección del menor**.

### Por qué se descartaron otros nombres (no re-debatir)
- **Arraigo** — "arraigo" es término técnico de extranjería en España (arraigo social/laboral). Con dinero público de la CARM (gobierno PP) + coalición transversal, cargar el nombre con esa connotación es un riesgo político gratuito. Fuera.
- **Federia / Fénix / descriptivos** — Federia es fuerte como marca legal pero endogámica (habla de "lo federado", no del producto: deporte base, vida, salud). Fénix descartado de inicio. Los descriptivos puros ("Carnet Deportivo") no registran.
- **Criterio de selección**: políticamente neutro (palatable de PP a izquierda, porque pasa por subvención pública) + cargado de relato deporte base/vida/salud + sugestivo > descriptivo (registrable).

### ✅ Checklist Fase 0 · verificación legal antes de oficializar (PENDIENTE)
Primer entregable de Fase 0. Hasta cerrarlo, "Savia Joven" es **candidato**, no marca.
- [ ] **OEPM** (marca nacional) — buscar "Savia Joven" + reservas en el localizador de marcas. Clases Niza relevantes: **9** (software/credenciales digitales descargables), **42** (SaaS — la plataforma), **41** (servicios deportivos y educativos / organización de actividad deportiva), **35** (gestión/publicidad), y para el plástico **16** (impresos) / **40** (servicios de impresión). Atención a colisión conocida: **"Savia by MAPFRE"** (telemedicina, clase salud 44) — clases distintas a las nuestras, confirmar coexistencia.
- [ ] **EUIPO** (marca UE) — misma búsqueda, por si se quiere protección europea o hay marca UE que cubra España.
- [ ] **Dominios** — `saviajoven.es` / `.com` / `.org` (+ reservas). Comprobar disponibilidad y registrar el principal antes de difundir.
- [ ] **Redes** — handles `@saviajoven` (Instagram, TikTok, X, YouTube) disponibles/coherentes.
- [ ] **Conflicto deportivo** — descartar que un club/federación/programa de deporte base existente use ya "Savia Joven" en Murcia/España (riesgo de confusión en el mismo sector).
- [ ] **Decisión**: si "Savia Joven" choca → caer a la primera reserva libre (Savia Nueva → Savia Activa → Latido) y re-verificar.

> *No soy asesor de marcas — este checklist es la guía de verificación; la búsqueda OEPM/EUIPO y, si procede, el registro, los confirma el founder o un agente de la propiedad industrial.*

---

## 🟢 B2C PAGO REACTIVADO (2026-06-09 · noche)

El carril autónomo B2C había estado en modo "todo gratis" (wedge B2C→B2B). El founder lo ha **vuelto a pasar a pago**. **Cero código** — todo fue env vars en Netlify + config del Dashboard de Stripe.

**Qué se hizo (Netlify env vars borradas):**
- `WEB_FUNNEL_FREE_ACTIVE` — interruptor principal del "todo gratis". Borrado → toda alta orgánica vuelve a pasar por Stripe.
- `LAUNCH_PROMO_ACTIVE` — borrado → el botón de upgrade del editor vuelve a cobrar (`create-checkout`) en vez de regalar el plan (`claim-launch-promo`).
- `DEMO_FUNNEL_FREE_ACTIVE` — borrado → las altas vía cards demo dejan de dar Pro gratis.
- Tras borrarlas: **Clear cache and deploy** (los cambios de env var solo aplican tras redeploy). Confirmado funcionando: el editor muestra precios reales (9€/19€ sin tachar) y el checkout abre Stripe con **Bizum** visible.

**Estado de cobro: TEST.** Las claves Stripe en Netlify son de Test (Test vs Live lo determinan las claves, no un flag). NO se cobra dinero real todavía — coherente con el alta fiscal pendiente.

**Cómo entra Bizum en B2C (sin código):** `create-checkout` (autónomo Base/Pro) y `create-setup-fee-checkout` (carnet) son `mode:'payment'` **sin `payment_method_types` explícito** → métodos automáticos del Dashboard. Activar/desactivar medios de pago se hace en Stripe → *Settings → Payment methods* y se refleja al instante. Criterio acordado: dejar **Tarjeta + Bizum (+ Apple/Google Pay)**, quitar BNPL/SEPA/exóticos. **La lista de métodos es por modo** (lo de Test no se copia a Live).

**Pendiente para cobrar de verdad (cuando toque):** (1) poner claves Stripe **Live** en Netlify, (2) **activar Bizum en Live** en el Dashboard, (3) re-configurar la lista de métodos en Live, (4) el alta fiscal + Verifactu (ver ⏳ PENDIENTE, ítem 2). **Reversible:** volver a poner las env vars `*_FREE_ACTIVE`/`LAUNCH_PROMO_ACTIVE=1` reactiva el modo gratis.

---

## 🔧 DEPLOY ARREGLADO (2026-06-09 · tarde)

**Síntoma**: TODOS los deploys de Netlify fallaban desde ~7 jun ("Build script returned non-zero exit code: 2"), fase **Building** → Failed. Incluía #181–#184. La suite pasaba limpia en local. Resultado invisible pero grave: **el código de #181–#184 estaba mergeado en `main` pero NUNCA llegó a producción** porque cada deploy moría antes de publicar.

**Causa**: `netlify.toml` usaba `npm test` como build command en los 4 contextos. Eso corría los 1650 tests **dentro del contenedor de build de Netlify**. PerfilaPro no tiene paso de compilación (sirve `public/` + funciones), así que gatear el deploy con la suite lo hacía frágil (versión de Node sin fijar / memoria / dep nativa) — fallaba aunque el código estuviera sano.

**Arreglo (#185, mergeado, commit `074c750`)**:
1. `netlify.toml` → build command = no-op (`echo …`) en `[build]` + los 3 contextos. Netlify solo publica `public/` + empaqueta funciones. **Deploy fiable siempre.**
2. `.github/workflows/ci.yml` (NUEVO) → `npm ci` + `npm test` en Node 22 en cada PR y push a `main`. Es el nuevo **gate de calidad**.
3. `CLAUDE.md` → documentado el split CI/deploy (sección Commands).

**Verificado**: deploy `074c750` Published en verde (78 functions + 2 edge + 93 redirects, build 1m 7s). Producción restaurada y al día con `main`.

**Notas para el próximo hilo**:
- El check `test` de GitHub Actions tardó en arrancar la 1ª vez (cola de runners en el primer workflow del repo, normal). Corre igual en cada PR.
- **Pendiente opcional**: activar branch protection en GitHub (Settings → Branches → require status checks → marcar `test`) para impedir merges con tests en rojo. No está configurado.
- **NO volver a poner `npm test` como build command de Netlify.** Los tests viven en CI; Netlify solo publica.

---

## ⏳ PENDIENTE TRAS CERRAR EL SPRINT (estado 2026-06-09 tarde)

Nada de **código bloqueante**: el sprint Cantera está cerrado y todo desplegado/vivo. Lo que queda son acciones manuales + decisiones de negocio del founder:

1. **Stripe Live** (acción manual Stripe Dashboard + Netlify): poner claves Live en Netlify + **activar Bizum en Live** + re-configurar la lista de métodos en Live (la de Test no se copia). Hoy todo está en **Test** (B2C reactivado, ver banner 🟢). La capability `bizum_payments` de los clubes se pide sola en su onboarding Express.
2. **Legal/fiscal antes de cobrar de verdad** (el founder dice que hay tiempo): alta de autónomo (036 + RETA) + proveedor Verifactu/AEAT. **No hay "periodo de gracia" legal** para facturar sin estar de alta. La integración Quipu es un esqueleto sin implementar (Sprint 3). Orden correcto: gestor → alta → Verifactu → Stripe Live.
3. **Capa 1 · "suelo" por jugador/temporada — SIN CODIFICAR a propósito.** Es la cuota fija anti-free-ride (la pieza de producto más relevante que falta). Espera a que el founder **fije el importe** (€/jugador/temporada fijo, o €/club/mes por tramos). Ver §6.
4. **Decisiones operativas del founder** (§6): mínimo absoluto de `application_fee` (cuotas bajas 5–15€ rentables), quién emite la factura SEPA al padre (default: el club), custodia 50/50 (Q4 → Sprint 2 salvo que el beachhead tenga >15% divorcios), club beachhead concreto.
5. **Roll-over de temporada** (§0-bis): no automatizado; a mano en fase 1, batch cuando haya volumen.

---

## ✅ ACCIONES EN PROD COMPLETADAS (2026-06-09)

El carnet nuevo está **encendido en prod**. El founder ejecutó:

1. ✅ **SQL** — migración `043_cantera_carnet_sponsor.sql` (`organizations.carnet_sponsor_url`) ejecutada en el Supabase SQL Editor. Desbloquea la UI de subida del patrocinador (pestaña Carnets del Studio).
2. ✅ **Netlify env vars** — `CANTERA_CARNET_FEE_CENTS=1200` (skim 12€ embebido en el primer pago) + `STRIPE_PLATFORM_FEE_BPS=150` (comisión 1,5%) confirmadas.

> El backend del carnet (PR #178) + la UI (rama `claude/cantera-handoff-docs-pf9ozx`) están vivos. El cobro embebido del carnet y la cara B con patrocinador operan.

---

## ★ Modelo de monetización (CERRADO · 2026-06-07)

> Esta sección **manda** sobre cualquier línea anterior del documento que diga lo contrario. En concreto **supersede**: (a) el default de §2 "Stripe model: Connect **Standard** … Express NO" → ahora es **Express**; (b) el enfoque de §4·Q3 (Stripe como mero "upgrade voluntario") → ahora Stripe/Bizum es el carril de cobro de referencia, dentro de un modelo de **tres capas de ingreso**. Las decisiones-marco **D1/D2/D3 NO se tocan**.

### La regla de hierro (de aquí se deduce todo)
Para que el dinero entre **limpio a nombre del club** (sin que PerfilaPro sea entidad de pago), ese club **tiene que estar verificado (KYC/AML)**. No hay atajo legal. Lo único elegible es **quién hace el trámite y cuánto duele** — no si existe. Las dos formas de "evitar" el KYC son peores:
- **Cuenta central de Perfila que recauda y reparte** → te convierte en **Entidad de Pago sin licencia** (PSD2). No es fricción, es cierre + multa. **Descartado.**
- **Club usa su Bizum y Perfila factura aparte** → la comisión deja de ser automática. **No es la base** (sí vale como fallback manual, ver capa 3).

### Stack de cobro elegido
**Bizum + Stripe Connect _Express_ (onboarding progresivo y asistido) + entrega del link por WhatsApp (`wa.me` semi-manual en MVP).**
- **Express** (no Standard): Stripe **hospeda el onboarding y la verificación**; el club no "se da de alta en Stripe", rellena un formulario corto Perfila→Stripe. Onboarding **incremental** (`currently_due`, no `eventually_due`): empieza a cobrar en minutos con CIF + IBAN + DNI del presidente y completa el resto según sube volumen.
- **Comisión automática**: `application_fee` sobre cada cobro direct-charge. Cero liquidación, cero facturar el %, el dinero a nombre del club (resuelve el §3 fiscal y la comisión a la vez).
- **Bizum encaja por una razón clave**: es pago *push* autenticado → **sin contracargos**. Eso neutraliza el único "pero" real de Express (la plataforma asume más responsabilidad operativa de saldos negativos/disputas): con Bizum esa responsabilidad es ~0 en la práctica.
- **Convivencia de medios**: en el mismo checkout se activan `bizum` **y** `card`/SEPA. Regla de colocación: **Bizum por defecto en puntual + plan por conceptos** (Bizum NO es recurrente, no guarda mandato); **tarjeta-guardada/SEPA para la cuota mensual recurrente**. No es elegir uno; es poner cada uno donde brilla.

### Tres capas de ingreso (de la más segura a la más variable)
La comisión sobre la cuota **tiene una fuga estructural**: el club puede usar todo el SaaS (plantilla, carnets, panel del padre, stats) y seguir cobrando por su Bizum de siempre → comisión = 0. Por eso **no se apuesta todo a la comisión**:

1. **Suelo SaaS fijo — garantiza "pasar por caja".** Cuota fija por **jugador activo y temporada** (o por club/mes), pequeña pero inevitable, anclada al **uso real** (nº de fichas activas), no al flujo de dinero. Se factura **aunque** el club cobre las cuotas por fuera. Es la red de seguridad contra el free-ride. Mecanismo: reutilizable sobre el carril B2B existente (`create-org-checkout` / tiers de organización) o un checkout de "cuota de temporada" dedicado. *(Importe concreto = decisión de founder, ver §6.)*
2. **Carnet físico PVC+NFC — el momento tangible de pasar por caja.** Los 12€ setup / 6€ renovación ya diseñados (capa 4c/5), cobro directo a PerfilaPro. Es el gancho visible y el cobro que captura el salto de "miro el demo" a "lo quiero para mis chavales".
3. **Comisión 1,5% sobre cuotas — upside, no cimiento.** El Bizum/Connect Express de arriba. Crece cuando el club confía el flujo de cuotas a la plataforma. Para que lo elija, la herramienta de cobro debe ser **mejor que su Bizum manual**: links automáticos, matriz "quién pagó", recordatorios, conciliación (ya medio construido en la pestaña Cobros).

### El gancho que arrastra las cuotas al carril (palanca de dominio)
**En los clubes la regla ya existe y es dura: "el niño que no paga la cuota, no juega".** Eso convierte la **matriz de "quién pagó"** en una herramienta **operativa crítica**, no un nice-to-have: el club *necesita* el estado de pago autoritativo en un sitio para decidir quién entra en el campo. Ese dolor es lo que tira de las cuotas hacia el carril Perfila (capa 3) — y conecta con el carnet NFC (capa 2): el carnet/estado refleja "al día / no al día". Diseñar Cobros y carnet **alrededor de esa regla** es la mejor baza de conversión.

### Momentos de facturación (claros, en orden)
1. **Demo** — gratis. El club explora el Studio. No se cobra nada.
2. **Activación ("pasar por caja")** — el club compromete: se dispara con el **pedido de carnets** (capa 2) **y/o** la **cuota fija por jugador/temporada** (capa 1). Es la puerta demo → uso real. *(Aquí es donde NO puede haber fuga: sin este paso no hay temporada operativa.)*
3. **Operación de temporada** — recurrente: las **cuotas fluyen** por Bizum/tarjeta vía Connect Express → **1,5%** automático (capa 3), con la matriz de Cobros enforced por la regla "no paga→no juega". El suelo (capa 1) ya está facturado.
4. **Renovación (temporada N+1)** — **renovación de carnet** 6€ (capa 2) + **suelo por jugador** de nuevo (capa 1). Se ancla al roll-over de temporada (ver §0-bis · pendiente roll-over).

### Veredicto
Bizum sobre **Connect Express** (conviviendo con tarjeta/SEPA), **sí**. Pero la facturación **no se fía solo a la comisión**: el **suelo por jugador/temporada + el carnet** aseguran el "pasar por caja"; la comisión es la guinda. Las tres capas juntas = el negocio.

### Carnet del jugador — decisiones cerradas (2026-06-07)

El **carnet ES el suelo de ingreso**, no la comisión (su margen ~9,4€/chaval iguala la comisión anual de 1,5% sobre ~600€ y NO tiene fuga). Decisiones:

- **12€/chaval/temporada, DENTRO del pack de material** (chándal, equipación…). Cobro fijo casi garantizado: el padre lo paga sin venta extra. **Credencial oficial OBLIGATORIA** (no opcional) — el QR/estado se apoya en la regla de dominio *"el que no paga la cuota, no juega"*, que convierte la matriz de Cobros en herramienta operativa crítica.
- **PVC color a 2 caras + QR, SIN NFC en el MVP** (el QR ya hace de credencial; coste ~2,6€). El NFC puede volver con el banco.
- **Cara A** = identidad (color+escudo+club · foto · dorsal · nombre · categoría·equipo —la competición ya va en `team_name`, mig 040/041— · **temporada** · QR). Los datos legales del club NO van en el plástico (viven tras el QR). **Cara B** = imagen de **patrocinador del club** (lo vende/gestiona el club, se queda el dinero; PerfilaPro solo imprime) + franja de validez; sin patrocinador → escudo centrado. El área de cara B es además el **hueco reservado para el patrocinador de RED de PerfilaPro (CaixaBank, Fase 2)**.
- **Foto** capturada **en la inscripción**, en el mismo acto que el consentimiento de imagen (`consent_image`).
- **Cobro embebido en el primer pago**: PerfilaPro skimea los 12€ del primer pago del plan vía `application_fee` (invisible/no-toggle para el club). Fallback `create-setup-fee-checkout` al club para clubes manuales/Bizum.
- **CaixaBank = Fase 2**, como **patrocinio del carnet** (plástico subvencionado + co-brand), NO como cuentas bancarias a menores (choca con la arquitectura LOPD + KYC + es venta B2B lenta).

### Estado de implementación (rama `claude/cantera-perfilapro-M7gks`)

- ✅ **Carnet a 2 caras** (`printable-card-utils` · `renderPlayerCardFront`/`renderPlayerCardBack` + `sponsorBuffer`/`carnet_sponsor_url`) — commit `b95937c`.
- ✅ **Foto en la inscripción** (`lib/player-photo.js` + `enrollment-submit` + campo en `enrollment-page`, gated por `consent_image`, best-effort) — commiteado.
- ✅ **Carnet embebido en el primer pago** (`lib/enrollment-checkout` skim `application_fee` capado + `CANTERA_CARNET_FEE_CENTS` en `create-enrollment-checkout` + auto-`card_print_orders` idempotente en `lib/cantera-webhook`) — commit `2e56b28`.
- ✅ **Storage del patrocinador** (migración **043** `organizations.carnet_sponsor_url` + `upload-carnet-sponsor-panel.js`, auth org-panel scoped, solo sports_club + ruta).
- ✅ **Regla "carnet listo"** backend (`lib/carnet-ready.js` + `getRoster` devuelve `carnet_ready`/`carnet_missing` por jugador).
- Suite **1612/1612** (backend). **Migración 043 EJECUTADA en prod (2026-06-09)** — carnet encendido.

### Pendiente (próximos chunks)
1. ✅ **UI "carnet listo"** (HECHO, rama `claude/cantera-handoff-docs-pf9ozx`): chip por jugador + contador `🪪 N/M carnets listos` en el roster de `panel.html` (`get_roster.totals.carnet_ready`) · filtro `only_ready` en `print-order-export` (CSV + PDF booklet, opt-in) · aviso "🪪 Falta la foto del carnet" en el panel del padre (`parent-data.carnet_photo_missing`, junto al botón de subir foto).
2. ✅ **UI del patrocinador en el Studio** (HECHO, rama `claude/cantera-handoff-docs-pf9ozx`): sección "Patrocinador del carnet" en la pestaña Carnets de `panel.html` con previsualización + subida que llama a `upload-carnet-sponsor-panel` (reemplaza la imagen anterior). `sanitizeSportsOrg` expone `carnet_sponsor_url` para previsualizar. Sin botón de "quitar" (el backend solo sube/reemplaza, no borra a null).
3. ✅ **Re-subida de foto desde el panel del padre** (HECHO en PR #180): `upload-player-photo` scoped al JWT del tutor + botón "📷 Cambiar/Añadir foto" en `renderParentChildren`.
4. ✅ **Bizum + Connect Express** (HECHO, rama `claude/bizum-connect-express-ga8ga4`):
   - **Bizum en los tres pagos únicos.** (a) Autónomo Base/Pro (`create-checkout`) + carnet del club (`create-setup-fee-checkout`) = cuenta plataforma, métodos automáticos del Dashboard → **cero código**, se activa habilitando Bizum en el Dashboard de Stripe. (b) Plan de cantera one-shot puro (`lib/enrollment-checkout.buildPlanCheckoutSessionParams`, nuevo param `hasScheduled`): cuando el plan entero vence ya (sin plazos futuros), quita `setup_future_usage` y añade `bizum` a `payment_method_types`; con plazos futuros sigue en card/SEPA con mandato. El carril mensual (suscripción) y B2B/org intactos.
   - **Connect Standard→Express** (`stripe-connect-onboard.js`): `accounts.create` ahora `type:'express'`, `country:'ES'`, capabilities `card_payments`/`sepa_debit_payments`/`bizum_payments`/`transfers`; Account Link con `collection_options.fields='currently_due'` (onboarding incremental). Solo afecta cuentas nuevas (no había cuentas conectadas reales → migración segura).
   - Suite **1650/1650**. Sin migraciones ni env vars nuevas.
   - ⚠️ **Acción manual en prod pendiente**: habilitar **Bizum** en el Dashboard de Stripe (cuenta plataforma) para que aparezca en los checkouts de autónomo + carnet. La capability `bizum_payments` de la cuenta Express del club se pide sola en el onboarding.
5. ✅ **Env prod** (HECHO 2026-06-09): migración **043** ejecutada + `CANTERA_CARNET_FEE_CENTS=1200` + `STRIPE_PLATFORM_FEE_BPS=150` confirmadas en Netlify.

> **Nota de scope** (item 1): `print-order-export` (auth founder password+TOTP) aún **no tiene UI** — el filtro `only_ready` queda listo en backend para cuando se construya el botón de export de lote en `admin-orgs.html`. El chip del roster y el aviso del padre sí son visibles ya.

---

## 0 · Lo último mergeado (sesión 2026-06-06 · tarde)

Trabajo **desde `main`**, rama `claude/demo-cantera-player-delete-KWZbZ`. Cuatro PRs sobre la **gestión de plantilla del club** (encima de la sesión de mañana, §0-bis abajo):

1. **#173 · Baja de jugador/staff desde el panel del club** — botón "Baja" en cada fila de la Plantilla (`panel.html`) → `cancel-membership` (auth org-panel, scoped al propio club). Jugador vía RPC `cantera_close_membership`; **cuerpo técnico** vía cierre app-side (la RPC es player-only: filtra `role='jugador'`). El miembro sale del roster; la ficha NO se borra (pertenece a la persona).
2. **#174 · Invitar familias por email desde el Studio del founder** — el botón "Invitar" de `admin-orgs` ahora es **consciente del `kind`**: `sports_club` → modal "Invitar familias" → acción nueva `cantera_enrollment_invite` (reusa `lib/enrollment-invite`, manda el enlace de la campaña ABIERTA; 409 si no hay campaña; auditada). `business` → invite B2B de operarios de siempre.
3. **#175 · Consistencia de la baja entre pestañas + teardown de cobro** — (a) `enrollment_get` contaba inscripciones sin filtrar `left_at` (un jugador quitado seguía sumando) → fix: filtra `left_at IS NULL` + `role='jugador'`. (b) nuevo **`lib/cantera-billing-teardown.js`** (`teardownPlayerBilling`): la baja del club cancela `enrollment_charges` `scheduled` + `parent_subscriptions` activas (Stripe `subscriptions.cancel` en la cuenta Connect, best-effort honesto: si Stripe falla no marca `canceled` y cuenta `sub_errors`). Invocado **SOLO en la baja** (cancel-membership jugador + founder `cantera_close_membership`), nunca en cambio de equipo ni traspaso. `cancel-membership` y `admin-orgs` reciben el cliente Stripe inyectable. UX: botón "Quitar"→**"Baja"**, modal "Dar de baja del club" que avisa del corte de cobro y recuerda que para mover de equipo se usa el desplegable Equipo.
4. **#176 · Feedback del invite de familias** — el invite desglosa el motivo de cada fallo (duplicadas / email mal escrito / fallo de envío) en vez de "N con error" opaco; conserva la lista si hubo fallos. (No era bug de lógica: `validateInviteList` deduplica por email a propósito.)

**Las TRES operaciones de plantilla (clave · no mezclar)**: (1) **cambiar de equipo** = desplegable Equipo + `enrollment_assign` → NO cierra membresía, NO toca cobro; (2) **baja del club** = botón "Baja" / founder `cantera_close_membership` → cierra membresía Y desconecta cobro; (3) **traspaso a otro club** = `cantera_execute_transfer` → sigue activo en otro club, no se desconecta cobro aquí. Roster, KPIs, Cobros e inscripciones filtran todos `left_at IS NULL`.

Suite **1585/1585** (95 ficheros). **Sin migraciones nuevas**. Nuevos archivos: `lib/cantera-billing-teardown.js` + `tests/lib-cantera-billing-teardown.test.js`. `CLAUDE.md` actualizado (secciones "Tres operaciones distintas sobre la plantilla" + "Teardown de cobro en la baja" + invite consciente del `kind`).

---

## 0-bis · Lo último mergeado (sesión 2026-06-06 · mañana)

Trabajo **desde `main`**. Dos features sueltos sobre Cantera/B2B (PR #166, merge `7caf83a`), encima de #164 (equipos por competición · migraciones 040/041) y #165 (matriz de Cobros por modelo · migración 042):

1. **KPIs de Cobros conscientes del modelo de plan** — `get_club_stats` (en `org-panel.js`) ahora carga la campaña abierta y, si lleva plan a medida, devuelve `payments.model='plan'` (jugadores con plan completo, `collected_cents`/`expected_cents`, cobertura del plan, `concepts_paid/total`, `players[]` con progreso). Reusa `computePlanBilling` (extraído de `billingMatrixPlan`). `panel.html` reetiqueta los KPIs (Plan completo / Plan pendiente / Recaudado / Cobertura del plan) y pinta la tabla "Estado por jugador" plan-aware; chips de Estadísticas también. Clubes mensuales intactos (`model='monthly'`).
2. **Carry-over de atribución comercial (Phase 2 · Bloque D)** — `admin-orgs.js` acción `leads_assign`: al asociar un lead con `agent_code` a una org **sin atribución**, copia el código a `organizations.agent_code` (no pisa atribución existente; best-effort). Cierra `b2b_leads.agent_code → organizations.agent_code → org_invoices → agent-data`. Toast del Studio confirma (`agent_code_carried`).

Suite **1566/1566**. Sin migraciones nuevas.

> **✅ CARRIL CANTERA COMPLETO EN PROD (2026-06-06)** — esquema + env vars verificados, listo para operar.
>
> **Migraciones (033–042) TODAS ejecutadas y verificadas**: 033/034 (implícitas por FK), 035 (`club_transfers` + RPCs `cantera_execute_transfer`/`cantera_close_membership` + `card_consents` rol `founder`), 036 (`organizations.cantera_monthly_fee_cents` + CHECK), 039 (`enrollment_charges` + índices cron/idempotencia), 040/041/042 (`club_teams`, `sports_competitions` 42 filas seed, `member_club_seasons.team_id`, `external_payments.concepto`).
>
> **Env vars en prod (Netlify) verificadas**: `CANTERA_VERTICAL_ACTIVE`, `CANTERA_PII_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_BPS`, `STRIPE_PRICE_PLAYER_SETUP_FEE`, `STRIPE_PRICE_PLAYER_RENEWAL`, `PRINT_PROVIDER`, `ORG_PANEL_JWT_SECRET`. `PARENT_PANEL_JWT_SECRET` **no está pero es opcional** (fallback a `ORG_PANEL_JWT_SECRET`, presente). `STRIPE_CONNECT_CLIENT_ID` no hace falta (onboarding por Account Links, no OAuth).
>
> **Único matiz a confirmar**: que `CANTERA_VERTICAL_ACTIVE` valga exactamente `1` (presencia ≠ valor). Con `1` el vertical está vivo; cualquier otro valor → endpoints 410. Nada de código ni migración pendiente.

**Candidatos al próximo hilo** (no bloqueantes): los que queden en §7 (deuda consciente) — W3C Verifiable Credentials sobre `card_consents`, `org_admins` con roles dentro del club, integración federativa, etc.

### Pendiente identificado: roll-over de temporada (no automatizado)

**Decisión cerrada (2026-06-06)**: la "temporada vigente" del Studio cambia el **1 de junio** (cutoff junio, no julio) en `lib/sports-categories.js → SEASON_CUTOFF_MONTH`. Razón de dominio: la competición federada de fútbol base en el target **acaba a finales de mayo**; en junio no hay competición en marcha, el club ya está en captación/configuración/campus de verano de la temporada nueva. Esto fija la cabecera de la Plantilla, las stats del club y la categoría que se asigna a las **altas nuevas** (un alta de junio se encuadra ya en la temporada que viene).

**Lo que NO hace (deuda consciente)**: el cambio de cutoff rueda la temporada *calculada*, pero **no reescribe las membresías existentes**. Un jugador ya fichado conserva su `member_club_seasons.season` (p.ej. `2025-26`) y su `category_id` de registro hasta que alguien abra/renueve su membresía de la temporada nueva. Hoy NO existe un flujo de "roll-over de temporada" que: (1) cierre las membresías de la temporada saliente, (2) abra las de la entrante para los que renuevan, (3) recalcule la categoría de cada jugador con el nuevo `seasonStartYear` (suben de categoría), (4) decida qué hacer con los que no renuevan. En fase 1 (1 club, pocos jugadores) se gestiona a mano vía altas/Inscripciones; cuando haya volumen real, este roll-over (batch o asistido desde el Studio) es el candidato natural. Relacionado: la campaña de Inscripciones ya declara `season` explícita, así que el roll-over podría colgar de "abrir Inscripciones de la temporada N+1".

---

## 1 · Qué está aterrizado

> **🧭 MIGRACIÓN DE HILO (estado a esta fecha)**: capas **0 → 6 COMPLETAS y mergeadas a `main`**. Trabajar **desde `main`** (todo el backend + UI Cantera vive ahí). Estado migraciones en prod (2026-06-06): **033/034/035/036/039/040/041/042 TODAS EJECUTADAS y verificadas**. Esquema + env vars en prod (verificado en Netlify). Listo para operar (confirmar CANTERA_VERTICAL_ACTIVE=1). Suite **1566/1566**. Ver §0 para lo último y §7 para lo que queda fuera de scope (deuda consciente). El resto de esta sección es historial por capa.

**Branch**: **capa 5 COMPLETA** (carnet físico). Vive en `claude/cantera-capa5-carnet`.

**Capa 5 · carnet físico PVC+NFC** — `buildPlayerCardPVC` + `buildPlayerCardsBookletPDF` en `printable-card-utils.js` (ISO 7810, escudo+foto+dorsal+QR); `print-order-export.js` (founder: CSV del lote para imprenta / PDF booklet de carnets); `nfc-register.js` (founder: registra nfc_uid al impresionar → status sent_to_printer, 409 si UID duplicado). 12 tests, suite 1308/1308. Sin migración (usa card_print_orders de 033). Consumidor UI (botones en el Studio) → capa 6.

**Branch**: **capa 4 COMPLETA** (4a/4b/4c/4d). 4d vive en `claude/cantera-capa4d-webhook`.

**Capa 4d · eventos webhook Connect** — `lib/cantera-webhook.js` enrutado desde `stripe-webhook.js` antes de B2B/autónomo. Firma dual (`STRIPE_WEBHOOK_SECRET` + fallback `STRIPE_CONNECT_WEBHOOK_SECRET`). `account.updated` → flags Connect; `checkout.session.completed kind=cantera-parent-fee` → upsert `parent_subscriptions`; `customer.subscription.*` parent-fee → estado/periodo/importe; `checkout.session.completed kind=cantera-print` → `card_print_orders` paid; `invoice.paid` parent-fee → ACK. 15 tests, suite 1296/1296. Sin migración/route nueva.

**Carril de cobros (capa 4) cerrado**: onboarding Connect → cuota padre→club → setup-fee carnet + cobros manuales → webhook que lo materializa todo.

**Branch (4c)**: capa **4c (setup-fee + cobros manuales)** mergeada (PR #151).

**Capa 4c · setup-fee carnet + cobros manuales** — `create-setup-fee-checkout.js` (org-panel): cobro directo a plataforma por carnets (Checkout payment, quantity=nº jugadores, Price IDs setup/renewal), crea `card_print_orders pending` enlazados a la sesión (4d los marca paid). `record-external-payment.js` (org-panel, record/list): registra Bizum/efectivo en `external_payments` vía `lib/external-payments`, solo jugadores del club. 13 tests, suite 1281/1281. Sin migración (usa card_print_orders de 033 + external_payments de 034).

**Capa 4b · cuota mensual padre→club** — migración 036 (`organizations.cantera_monthly_fee_cents`, NO ejecutada en prod) + `create-parent-checkout.js` (auth parent-panel). Subscription direct-charge sobre la cuenta conectada del club (`stripeAccount` header) con `price_data` inline + `application_fee_percent = STRIPE_PLATFORM_FEE_BPS/100`. 409 si club no conectado/sin cuota/cuota ya activa. parent_subscriptions lo materializa el webhook (4d). 11 tests, suite 1268/1268. **Controvertido (negocio)**: que la plataforma retenga fee sobre el pago del padre — código listo, modelo a debatir.

**Capa 4a · Stripe Connect onboarding** — `claude/cantera-capa4a-connect-onboard`. `stripe-connect-onboard.js` (auth org-panel, solo sports_club): Connect Standard vía Account Links (no OAuth → sin `STRIPE_CONNECT_CLIENT_ID`). `onboard` crea cuenta + link; `status` retrieve + persiste flags. 503 si Stripe off. 10 tests, suite 1257/1257. Ruta en bloque `# CANTERA`. Sin migración (usa columnas `stripe_connect_*` de la 033).

**Branch (consola)**: consola de incidencias (backend) vivió en `claude/cantera-admin-incidencias`.

**Consola de incidencias del founder (backend)** — `claude/cantera-admin-incidencias`. `lib/cantera-incidents.js` + 9 acciones `cantera_*` en `admin-orgs.js` (auth password+TOTP, auditadas en `admin_audit_log`). 4 familias: traspasos+membresías (overview/edit/close/reassign), tutores (revoke/add admin), consentimiento+visibilidad (overview read-only + set_visibility), PII+LOPD (reveal_birthdate descifrado + delete_player soft/hard). 23 tests, suite 1247/1247. Sin migración/route/env nuevos. **UI**: sección colapsable "🚑 Incidencias Cantera" en `admin-orgs.html` (buscador por slug → overview → botones por acción). Consola completa (backend + UI).

**Capa 3c · consentimiento parental LOPDGDD** — `claude/cantera-capa3c-consent`. 16 tests (`tests/parent-consent.test.js` + nuevo caso en `cantera-transfers`), suite total 1224/1224. **Sin migración** (reusa `card_consents`).
- `lib/consent.js`: `verifySecondFactor` (2º factor = fecha de nacimiento del menor, contra `birth_date_encrypted` o fallback `birth_year`), `buildConsentEvidence` (hash sha256 + ip + ua), `recordConsent`, `clientIp`/`userAgentOf`, `CONSENT_TYPES`.
- `parent-consent.js` (`POST /api/parent-consent`, auth parent-panel): tutor_legal otorga `parental_initial`/`data_processing`/`public_visibility`/`image_rights`. `public_visibility` → `cards.public_card=true`.
- `accept-transfer.js` ahora **exige el 2º factor** (`birth_date`) antes de ejecutar el handoff (gate LOPDGDD que la 3b dejó pendiente).
- Ruta `/api/parent-consent` en bloque `# CANTERA`.
- **Decisión MVP**: 2º factor = fecha de nacimiento (sin infra SMS). Reemplazable por OTP SMS tocando solo `lib/consent.verifySecondFactor`.

**Branch (3b)**: capa **3b (handoff transaccional)** mergeada (PR #145).

**Capa 3b · handoff transaccional** — `claude/cantera-capa3b-handoff`. 25 tests (`tests/cantera-transfers.test.js`), suite total 1208/1208.
- **Migración 035** (NO ejecutada en prod): `club_transfers` + RPCs `SECURITY DEFINER` `cantera_execute_transfer` / `cantera_close_membership` (atomicidad real en Postgres, no compensación app-side) + amplía CHECK `card_consents.granted_by_role` con `'founder'`. RLS + REVOKE/GRANT EXECUTE a service_role + contramigración.
- `request-transfer.js` (org-panel, club que ficha): valida player con membresía activa en otro club → crea `club_transfers pending` → avisa al tutor.
- `accept-transfer.js` (parent-panel, tutor_legal): dispara `cantera_execute_transfer`.
- `cancel-membership.js` (auth dual org-panel **o** parent-panel): `cantera_close_membership` (baja / off-platform).
- `admin-orgs.js` acción `transfer_resolve` (override founder: force_accept / cancel) — la utilidad súper-admin decidida para esta capa.
- 3 rutas en bloque `# CANTERA` de `netlify.toml`.
- **Deuda anotada**: la 2ª verificación LOPDGDD (SMS/NIF) sobre accept-transfer se añade en 3c; hoy la identidad del tutor es el magic-link parent-panel.

**Capa 3a · register-player + alta** — `claude/cantera-capa3a-register-player`. 15 tests (`tests/register-player.test.js`), suite total 1183/1183.
- `register-player.js` (`POST /api/register-player`, auth org-panel JWT del club): crea card player/club_staff (slug opaco `p-xxxxxxxx`, `public_card=false`, birth_year + birth_date_encrypted) + `member_club_seasons` (categoría resuelta vía sports-categories, dorsal/posición/temporada) + `card_admins` (tutor legal + secundario opcional). Cubre camino 1 (nuevo) y camino 3 (off-platform, `previous_club_name`). Compensación por borrado de card ante fallo (no hay transacción en la Data API). Email best-effort al tutor con magic-link parent-panel. Gate `isCanteraActive()`.
- Ruta `/api/register-player` en el bloque `# CANTERA` de `netlify.toml`.
- **Camino 2 (handoff entre clubes PerfilaPro) queda para 3b**: register-player siempre crea card NUEVA.

**Capa 2 · auth tutor** — `claude/cantera-capa2-parent-auth`. 14 tests (`tests/parent-auth.test.js`), suite total 1168/1168.
- `parent-auth.js` (`POST /api/parent-auth`): magic-link passwordless al email de un `card_admins` activo (roles `tutor_legal`/`tutor_secundario`/`player_self`, NO `club_admin`). Siempre 200 (anti-enumeration), gateado por `isCanteraActive()` (410 off), rate-limit 5/10min/IP. CTA → `/panel.html?session=<jwt>`.
- `lib/panel-auth.js` extendido: `signParentSession({email})`/`verifyParentSession`/`parentAuthFromEvent` con `purpose:'parent-panel'` (secreto `PARENT_PANEL_JWT_SECRET` → `ORG_PANEL_JWT_SECRET` → `AGENT_JWT_SECRET`). Sesión scoped al **email** (tutor con varios hijos = todas sus cards). Aislada de org-panel por el claim `purpose`.
- Ruta en `netlify.toml` bajo bloque `# CANTERA` (borrable de golpe).

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
- **Stripe model**: ⚠️ **SUPERSEDED por la sección ★ (2026-06-07)** → ahora **Connect Express** (onboarding hospedado + progresivo, menos fricción para el club; Bizum sin contracargos neutraliza el trade de responsabilidad). El club sigue siendo el comercio legal (su NIF/IBAN, responsabilidad fiscal suya). *(El código de 4a aún usa Standard — ver delta en sección ★.)*
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
| **2 · ✅ hecho · auth tutor** | `parent-auth.js` + extensión `lib/panel-auth.js` (`purpose:'parent-panel'`) + 14 tests | Borrar archivo + route |
| **3a · ✅ hecho** | `register-player.js` (alta player/staff, caminos 1 y 3) + 15 tests | Borrar archivo + route |
| **3b · ✅ hecho** | migración 035 (RPCs atómicas) + `request-transfer.js`, `accept-transfer.js`, `cancel-membership.js` + override `transfer_resolve` en admin-orgs + 25 tests | Borrar archivos + routes + DROP 035 |
| **3c · ✅ hecho** | `parent-consent.js` + `lib/consent.js` (doble verificación → `card_consents`, `public_card=true`) + gate 2º factor sobre accept-transfer + 16 tests | Borrar archivos + route |
| **admin-incidencias · ✅ hecho (backend + UI)** | `lib/cantera-incidents.js` + 9 acciones `cantera_*` en admin-orgs + 23 tests + sección "🚑 Incidencias Cantera" en admin-orgs.html | Borrar lib + bloque dispatch + sección HTML |
| **4a · ✅ hecho** | `stripe-connect-onboard.js` (Connect Standard, Account Links, onboard+status) + 10 tests | Borrar archivo + route |
| **4b · ✅ hecho** | migración 036 (`organizations.cantera_monthly_fee_cents`) + `create-parent-checkout.js` (subscription direct-charge en cuenta conectada + application_fee) + 11 tests | Borrar archivo + route + DROP 036 |
| **4c · ✅ hecho** | `create-setup-fee-checkout.js` (carnet, directo plataforma) + `record-external-payment.js` (Bizum/efectivo → external_payments) + 13 tests | Borrar archivos + routes |
| **4d · ✅ hecho** | `lib/cantera-webhook.js` + enrutado en `stripe-webhook.js` (firma dual, account.updated, parent-fee sub/checkout/invoice, print checkout) + 15 tests | Borrar lib + ramas del webhook |
| **5 · ✅ hecho · carnet físico** | `buildPlayerCardPVC` + `buildPlayerCardsBookletPDF` en `printable-card-utils.js`, `print-order-export.js` (CSV/PDF), `nfc-register.js` + 12 tests | Borrar funciones + routes |
| **6a · ✅ hecho · lecturas Studio deportivo** | acciones `get_roster` / `get_club_stats` / `get_transfers` en `org-panel.js` (gateadas por `isCanteraActive()` + `kind='sports_club'`; el org se re-resuelve con `SELECT *` sólo dentro de las acciones gateadas para no tocar el SELECT compartido B2B) + 7 tests (`tests/org-panel-cantera.test.js`). Suite 1315/1315. Branch `claude/cantera-layer-6-ui-qn3py` | Revert acciones org-panel |
| **6b · ✅ hecho · UI Studio del club** | `panel.html` ramificado por `org.kind='sports_club'`: tabs Plantilla / Estadísticas / Fichajes / Carnets / Cobros / Branding, cableando las lecturas de 6a + alta (register-player), fichaje (request-transfer), carnets (create-setup-fee-checkout), cobro manual (record-external-payment) y onboarding Connect (stripe-connect-onboard). `get_org` enriquecido con `kind`/`sport` (query gateada por `isCanteraActive()`, no toca el SELECT compartido B2B). Suite 1316/1316. Branch `claude/cantera-layer-6-ui-qn3py` | Revert HTML/JS + bloque kind en get_org |
| **6c · ✅ hecho · Vista del padre** | endpoint de lectura nuevo `parent-data.js` (POST /api/parent-data, auth parent-panel, acción `get_children`: cards donde el email del JWT es `card_admins` activo + club + membresía + cuota + histórico + traspaso pendiente; nunca expone `birth_date_encrypted`) + `panel.html` ramificado por el claim `purpose='parent-panel'`: tarjeta por hijo/a con acciones inline (pagar cuota → create-parent-checkout, aprobar fichaje con 2º factor fecha nacimiento → accept-transfer, consentimiento visibilidad → parent-consent, baja → cancel-membership). 12 tests. Suite 1328/1328. Branch `claude/cantera-layer-6-ui-qn3py` | Revert HTML/JS + parent-data.js + route |

Cada capa commit separado. Cada capa con tests. `netlify.toml` se actualiza por capa con un bloque etiquetado `# CANTERA · ...` para borrado en bloque.

---

## 6 · Cosas operativas a aclarar con el founder antes del primer cliente

No son decisiones de Claude — son conversaciones con el founder y con el primer club beachhead.

- ¿Application_fee con mínimo absoluto (ej. 1€ por cobro) o sólo porcentaje? Importante para que cuotas bajas (5-15€ en prebenjamín) sigan siendo rentables.
- ¿Quién emite la factura SEPA al padre por defecto? Default mío: el club, con su NIF. PerfilaPro NO emite factura al padre. Si quieren asistencia (plantilla PDF club-branded usando `invoice-utils.js`), se valora cuando un club lo pida.
- KYC de Stripe Connect (ahora **Express**, ver sección ★) con **onboarding progresivo** permite empezar a cobrar en minutos y completar la verificación según sube volumen; aun así la verificación plena puede tardar 1-3 días. Onboarding **asistido por el founder en la demo** (no deberes para el club) + anclado al momento del carnet. El wizard gatea fichajes hasta `charges_enabled=true`; comunicarlo en la venta.
- **Importes de la capa 1 (suelo por jugador/temporada)**: definir con el founder. ¿€/jugador/temporada fijo, o €/club/mes por tramos de tamaño? Es el ingreso que asegura "pasar por caja"; conviene cerrarlo antes de codificar la capa 1.
- **Mínimo de `application_fee`** (ya listado abajo): especialmente relevante ahora que la comisión es "guinda" y no cimiento — cuotas bajas (5-15€) deben seguir siendo rentables o no compensa procesarlas.
- Beachhead concreto: ¿cuál es el club, qué tamaño (200-400 chavales mencionado en brief), cuándo se hace la primera demo? Esto afecta urgencia y orden de capas.
- Hijos de divorciados con custodia compartida (Q4): pregúntale al founder qué porcentaje real estima en el club beachhead. Si es >15%, MVP debería soportarlo; si es <5%, Sprint 2 está bien.

---

## 7 · Cómo arrancar el próximo hilo

**Mensaje para arrancar el hilo nuevo** (copiar tal cual):

> Continúo el sprint Cantera para **cerrarlo**. Lee la sección "Cantera · vertical deporte base" de `CLAUDE.md` y luego `docs/cantera-handoff.md` — empieza por el banner **✅ ACCIONES EN PROD COMPLETADAS** (arriba del todo) y la **sección ★** (modelo de monetización del carnet). Todo está mergeado a `main` y el carnet está **encendido en prod** (migración 043 + env vars ya ejecutadas). La **UI del carnet está cableada** (items 1–3 del pendiente: chip "carnet listo" + filtro `only_ready` en `print-order-export` + aviso "falta foto" en el panel del padre + subida del patrocinador en el Studio) en la rama `claude/cantera-handoff-docs-pf9ozx` (4 commits sobre `main`, suite 1646/1646). **Lo único que queda es el chunk (4): Bizum + Connect Express** — trabaja desde `main` (o rebasa la rama anterior si no se ha mergeado). Decisiones de Stripe a respetar: **Bizum solo en one-shot puro** (sin `setup_future_usage`; Bizum no guarda mandato → NO en el plan con mandato ni en la cuota mensual recurrente, que siguen en card/SEPA); **Connect Standard→Express** con onboarding incremental (`currently_due`). Revisa conmigo las decisiones de pasarela antes de codificar.

> **Nota**: la rama `claude/cantera-handoff-docs-pf9ozx` con los items 1–3 + patrocinador está pusheada pero **sin PR** (el founder decide si mergear). Si arrancas Bizum desde `main` antes de mergearla, los chips/filtros del carnet no estarán en `main` todavía — coordinar el merge primero.

**Carnet del jugador — backend ya en `main` (sesión 2026-06-07)**:
- Render: `printable-card-utils.js` → `renderPlayerCardFront` (cara A: identidad + temporada) / `renderPlayerCardBack` (cara B: patrocinador `club.carnet_sponsor_url` + validez; fallback escudo). 2 páginas/jugador. Param `sponsorBuffer`.
- Foto: `lib/player-photo.js` + `enrollment-submit` (sube en la inscripción gated por `consent_image`, best-effort) + campo en `enrollment-page`.
- Cobro embebido: `lib/enrollment-checkout.buildPlanCheckoutSessionParams` (skim `carnetFeeCents` en el `application_fee`, capado) + `CANTERA_CARNET_FEE_CENTS` en `create-enrollment-checkout` + auto-`card_print_orders` idempotente en `lib/cantera-webhook.handlePlanCheckoutCompleted`. Fallback manual = `create-setup-fee-checkout` (club).
- Patrocinador: migración **043** (`organizations.carnet_sponsor_url`) + `upload-carnet-sponsor-panel.js` (auth org-panel scoped, solo sports_club).
- Regla "carnet listo": `lib/carnet-ready.js` (`foto + equipo + dorsal`) → `getRoster` devuelve `carnet_ready`/`carnet_missing`.

**Cómo está montado el resto del backend** (todo en `main`):
- Alta/fichaje: `register-player` (3a), `request/accept/cancel` transfer (3b), `parent-consent` (3c).
- Auth: `panel-auth` (org-panel, club) + `parent-auth` (parent-panel, tutor). `lib/panel-auth` firma/verifica ambos por `purpose`.
- Cobros: `stripe-connect-onboard` (4a), `create-parent-checkout` (4b), `create-setup-fee-checkout` + `record-external-payment` (4c), webhook `lib/cantera-webhook` (4d).
- Carnet (base): `buildPlayerCardPVC`/`buildPlayerCardsBookletPDF`, `print-order-export`, `nfc-register` (5).
- Incidencias founder: `lib/cantera-incidents` + acciones `cantera_*` en `admin-orgs` (+ UI en admin-orgs.html).
- Helpers (1): `cantera-flag`, `card-kind`, `pii-crypto`, `sports-categories`, `external-payments`, `consent`, `player-photo`, `carnet-ready`.

**Lo que el próximo hilo tiene que CREAR**: UI en `panel.html` (chip "carnet listo" en el roster · control de subida del patrocinador en el Studio · filtro de impresión por `carnet_ready`) + re-subida de foto desde el panel del padre + chunk Bizum/Connect Express. Casi todo es cablear front a endpoints/datos que ya existen.

**Decisiones del founder en esta sesión** (no re-debatir):
- Atomicidad del handoff = **RPC SQL SECURITY DEFINER** (hecho en 035), no compensación app-side.
- Quien ficha = **admin del club** vía Studio (JWT org-panel). Confirmado.
- Súper-admin de incidencias: **override de traspaso en 3b** (hecho: `transfer_resolve`) + **consola completa como capa propia tras 3c**, con las utilidades que Claude vea más lógicas (las 4 familias: traspasos+membresías, tutores, consentimiento+visibilidad, PII+borrado LOPD).

La capa 3c es el consentimiento parental LOPDGDD (art. 7 LO 3/2018): doble verificación (magic-link al tutor_legal + 2º factor SMS o NIF parcial) antes de `public_card=true`, antes del primer handoff (gate sobre accept-transfer) y antes de `image_rights`. Inserta `card_consents` con `evidence_jsonb` (snapshot + hash), `ip_address`, `user_agent`. Reusa parent-auth (capa 2) + helpers capa 1.
