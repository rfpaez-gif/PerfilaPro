# Carnet FFRM · caja de migración y hoja de ruta

Este documento es el **bookmark** del nuevo carril estratégico: convertir el carnet del
jugador (PVC + NFC) en un **producto institucional avalado por una federación** (target
inicial: **FFRM**, Federación de Fútbol de la Región de Murcia), financiado por
**mecenazgo** en la cara B, dentro de un encuadre de **programa de identidad y protección
del deporte base**.

Cuando un hilo nuevo abra, leer **después** de la sección "Cantera · vertical deporte base"
de `CLAUDE.md` y del `docs/cantera-handoff.md`. Este doc no repite la infra Cantera —
asume que existe y la reutiliza.

Última actualización: 2026-06-10 — **fase de estrategia cerrada, fase de construcción por
empezar.** Aún no se ha escrito código de este carril. Decisiones-marco tomadas (abajo) +
candidatos de marca propuestos (§8-bis).

> Nota de rama: la rama `claude/greeting-5kgcks` contiene además un experimento de **PWA
> para `/panel.html`** (manifest + service worker + hint iOS) que quedó **aparcado** — no
> es parte de este carril. Si no se retoma para el Studio del club/B2B, se puede revertir.

---

## 0 · BOOTSTRAP — empieza por aquí (hilo limpio)

**Dónde vive todo:** rama **`claude/greeting-5kgcks`**. Este doc + la infra Cantera + el
experimento PWA aparcado están en esa rama, **NO en `main`**. Si abres un hilo y no ves este
archivo, es que estás en otra rama — no reconstruyas nada, cámbiate de rama.

```bash
git fetch origin claude/greeting-5kgcks
git checkout claude/greeting-5kgcks          # continuar la misma línea (recomendado)
# o leer sin cambiar de rama:
git show origin/claude/greeting-5kgcks:docs/carnet-ffrm-handoff.md
```

**Orden de lectura obligatorio:**
1. Sección "Cantera · vertical deporte base" de `CLAUDE.md`.
2. `docs/cantera-handoff.md` (estado de la infra Cantera que se reutiliza).
3. Este doc, completo.

**Estado:** estrategia CERRADA, construcción por empezar. **Cero código de este carril aún.**

**Primera acción del hilo limpio:** arrancar **Fase 0 (blindaje IP) + Fase 1 (piloto físico)**
en paralelo (§7). Lo único que bloquea la Fase 0 es **elegir el nombre de marca** (§8-bis) —
es decisión del founder.

**No re-debatir:** §1 (decisiones-marco) y §2 (realidades verificadas) están cerradas.

---

## ★ La tesis en una caja (el núcleo, no re-debatir)

> **No competimos en gestión de club ni en herramientas de entrenador. Nuestro terreno es
> la _identidad digital portable del jugador_. El producto ancla es un carnet oficial de la
> federación con NFC + datos federativos; el motor económico es el mecenazgo en la cara B; y
> la palanca para entrar es una coalición público-privada que hace caro el "no" de la
> federación. Todo vestido como programa "blanco" de protección del menor (LOPIVI), salud e
> inclusión — no como venta de publicidad.**

La frase de venta: *"Cada niño federado de Murcia, con su identidad deportiva digital —
suya y portable entre clubes — avalada por la FFRM, en un carnet que se paga solo."*

---

## 1 · Decisiones-marco CERRADAS (no re-debatir)

Salidas del hilo de estrategia (2026-06-10). Re-abrirlas es perder el tiempo ya invertido.

**Descartado:**
- **App para el padre.** Usuario de baja frecuencia (mira partidos y poco más). No
  justifica instalar nada. → muerto.
- **App/herramienta para el entrenador como producto propio.** El carril de seguimiento
  jugador/competición (Clunnity, bcoach) está **saturado y es pesado**; el diferenciador
  "input por voz/IA" es copiable. Construirlo es una empresa entera. El entrenador entra
  como **canal** (campeón) y **fuente de dato cualitativo**, NO como producto a construir.
- **Competir en gestión de club / cuotas / familias.** Ese asiento está ocupado por
  **Novanet** (y antes Clupik), recién recomprado por la FFRM. Y es justo el producto que
  un cliente vio "complicado de asimilar". No meternos ahí.
- **Stats objetivas por jugador (minutos/goles/asistencias) como input del entrenador.** Es
  trabajo de delegado, inviable en fútbol base. La card del jugador se llena con criterio
  **cualitativo**, nunca con stats que nadie va a teclear.

**Elegido:**
- **Terreno propio = identidad digital portable del jugador** (la categoría real de
  PerfilaPro: presencia digital, no ERP ni coaching).
- **Producto ancla = carnet oficial FFRM con NFC + datos federativos.** La pieza física ya
  existe en código (ver §3).
- **Motor económico = mecenazgo en la cara B del carnet** (ya scaffolded, ver §3).
- **Palanca de entrada = coalición público-privada** (ver §4) que vuelve políticamente caro
  el rechazo de la federación, presentándola como protagonista, no como acorralada.
- **Encuadre "blanco" = mecenazgo (no publicidad) anclado a LOPIVI + salud + inclusión.**

**La lógica que encaja los dos botones (memorizar):**
`Identidad/anti-fraude` → razón por la que el carnet es obligatorio y todo niño lo lleva →
**distribución garantizada** → **valor publicitario** → **financia el programa** (margen
para federación, club y plataforma). La identidad justifica la existencia; el mecenazgo la
paga.

---

## 2 · Realidades verificadas (condicionan todo)

Comprobado con búsqueda web el 2026-06-10. Fuentes al pie del doc.

1. **La licencia oficial nace en Fénix (sistema RFEF/PNFG).** El club afilia al jugador en
   Fénix, sube el lote, paga la cuota (~28 €/ficha) y cada jugador **descarga su licencia en
   formato digital**. → **El dato oficial es de la federación/RFEF; no se puede "fabricar lo
   oficial".** El carnet oficial + datos federativos **SOLO es posible con la federación**
   cediendo/sincronizando el dato. Sin ella: carnet *de club*, no oficial.
2. **Hoy la licencia es un PDF intangible. NO existe carnet físico NFC oficial.** → **hueco
   real** que ocupamos: "le damos cuerpo físico a vuestra licencia digital".
3. **FFRM cambió de Clupik → Novanet en julio 2024.** Precedente doble: (a) una federación
   SÍ avala y reparte SaaS de terceros a sus clubes; (b) ese asiento es **reemplazable** →
   el foso debe ser la card portable + el dato + los contratos, no la herramienta.
4. **CARM · Dirección General de Deportes subvenciona a la FFRM** (promoción deportiva,
   tecnificación, "Talento Deportivo" hasta 300.000 €), con condición de estar al corriente
   de obligaciones. → **es la palanca pública real sobre la federación.**
5. **CaixaBank ya hace en Murcia el discurso "deporte = inclusión social + valores +
   cohesión territorial"** (III Foro de Sostenibilidad, abril 2026). → **mecenas insignia
   ideal, ya alineado con el relato.**
6. **Sectores prohibidos en la cara B de un menor: apuestas y alcohol** (restricción legal +
   veneno reputacional). Whitelist de sectores = feature, no problema.

---

## 3 · Qué YA existe en el código (espina reutilizable)

Todo gateado por `CANTERA_VERTICAL_ACTIVE` y cifrado con `CANTERA_PII_KEY`. La infra Cantera
(migración 033 + posteriores) cubre ~80% del producto. Piezas concretas a reutilizar:

**Card del jugador e histórico:**
- `cards` con `card_kind='player'`, slug **opaco** `p-xxxxxxxx` (anti-doxxing), `public_card`
  (gateado por consentimiento), `birth_date_encrypted` (AES-256-GCM, `lib/pii-crypto.js`),
  `birth_year` en claro. (migración 033)
- `member_club_seasons` — histórico **portable cross-club** (la pieza que NADIE del mercado
  tiene). Handoff transaccional vía RPC `cantera_execute_transfer` (migración 035).

**Identidad, tutores y consentimiento (el ángulo LOPIVI):**
- `card_admins` — multi-tutor, cada uno con su `edit_token`.
- `card_consents` — **audit trail LOPDGDD append-only** (RLS bloquea UPDATE/DELETE). Esto es
  el activo que se vende como "os ayudamos a cumplir la protección del menor".
- `parent-consent.js` + `lib/consent.js` — doble verificación parental.
- `parent-auth.js` — magic-link del tutor (passwordless).

**El carnet físico PVC + NFC (el producto ancla):**
- `printable-card-utils.js → buildPlayerCardPVC({card, club, season, nfcUrl, ...})` — carnet
  ISO 7810 85×55mm, branded con `color_primary` del club, escudo, foto, dorsal, QR→`/c/:slug`
  (objetivo del NFC).
- `buildPlayerCardsBookletPDF` — booklet multipágina para impresión batch.
- `nfc-register.js` — registra el `nfc_uid` del chip al impresionar (índice único parcial:
  un chip no se asigna a dos cards).
- `card_print_orders` — pedidos de carnet con estados `pending→paid→sent_to_printer→
  shipped→delivered`, kind `setup`/`renewal`/`replacement`.
- `print-order-export.js` — CSV/PDF para la imprenta (founder, `PRINT_PROVIDER='manual'`).

**El motor de mecenazgo (cara B) — YA scaffolded:**
- `organizations.carnet_sponsor_url` (migración 043).
- `upload-carnet-sponsor-panel.js` — el club sube su patrocinador desde el panel (JWT
  org-panel, scoped a su org).
- `printable-card-utils.js → renderPlayerCardBack({club, season, sponsorBuffer, logoBuffer})`
  — coloca el patrocinador en la cara B del PVC.
- **Limitación actual: 1 patrocinador POR CLUB.** Falta la capa de patrocinador **máster
  federativo** (ver §5).

**Render público:** `/c/:slug` (card pública del jugador), `/e/:slug` (página de la org/club).

---

## 4 · La coalición (palanca para que el "no" cueste)

El mecanismo: la FFRM no depende de nosotros, depende de **quien la subvenciona y la
legitima**. Construir la coalición **por encima de la federación** y presentarle un programa
ya respaldado y financiado, donde su papel es protagonizar y llevarse el mérito. La FFRM es
el **último dominó, no el primero.** (Aviso: a una federación arrinconada le crece la
resistencia — el "no puede negarse" viene de **deseabilidad**, no de coacción.)

**Plano 1 — palanca pública (decisiva):**
- **CARM · Dirección General de Deportes** (la que paga). Aval = gravedad institucional.
- Consejería de Salud (hábitos/obesidad infantil), Educación (deporte escolar), Infancia
  (LOPIVI). Ayuntamientos + Fundaciones Deportivas Municipales (palancas locales).

**Plano 2 — mecenas de "dinero blanco":**
- **Fundación "la Caixa" / CaixaBank** ← candidato nº1, ya alineado (ver §2.5).
- Fundación CajaMurcia / Cajamar (raíces regionales).
- ElPozo / Grupo Fuertes (Fundación) — *confirmar programa actual*.
- UCAM "la Universidad del Deporte" — *confirmar*.
- ⚠️ Estrella de Levante: puede financiar el programa, **nunca aparece en la cara B** (alcohol).

**Plano 3 — amplificadores de legitimidad:** Cruz Roja, Plena Inclusión, Special Olympics,
UNICEF. Blindaje moral más que dinero.

**Cómo se viste de "blanco" (6 principios):**
1. La causa delante; el carnet es el instrumento. Es un *programa*, no un producto.
2. **Mecenazgo, no publicidad** (Ley de Mecenazgo: más limpio legal, fiscal y
   reputacionalmente; esquiva "publicidad a menores"). ← pieza clave.
3. Anclar a la **LOPIVI** (obligación legal de protección del menor que clubes/federación ya
   deben cumplir) → "os ayudamos a cumplir la ley", no pedimos favores.
4. Ética como feature: whitelist de sectores, código de mecenas, % revertido a clubes + fondo
   de deporte base, transparencia de márgenes.
5. Co-marca tripartita: convenio **CARM (DG Deportes) + mecenas + FFRM**.
6. PerfilaPro = operador tecnológico con margen modesto y transparente; superávit al deporte
   base. No extrae valor: lo genera y redistribuye.

---

## 5 · Qué FALTA construir (gap analysis)

Ordenado, no es todo código:

1. **Capa de patrocinador máster federativo** (código) — hoy `carnet_sponsor_url` es 1 por
   club; falta un slot regional sobre TODOS los carnets + **modelo de reparto**
   (federación/club/plataforma). Probablemente nueva columna en `organizations`/tabla de
   programa + lógica en `renderPlayerCardBack` para combinar máster + local.
2. **Whitelist de sectores de patrocinio** (código + política) — ética como feature.
3. **Integración / cesión del dato Fénix** (acuerdo, no código aún) — de esto depende la
   "oficialidad". Es la primera pregunta de viabilidad (§7).
4. **Encuadre "programa" institucional** (branding/relato/landing) — NO la Studio actual del
   club, que es justo lo que sonó "complicado". Puerta de entrada sobria y federativa.
5. **(Opcional, fase posterior) Verificación de identidad en el campo** — lectura NFC →
   comprobación de licencia (UX del anti-fraude que justifica la distribución obligatoria).

---

## 6 · Protección de la posición (hacer en paralelo, no después)

El miedo del founder es legítimo: esta configuración (dinero público + política +
incumbentes colocados) es de las que se apropian. **Las ideas no se protegen; las posiciones
sí.** Convertir idea→posición rápido:

- **Enseñar producto, no idea.** Un piloto NFC funcionando con un club real es 100× más
  difícil de apropiar que un PowerPoint. Es el mayor escudo.
- **Cerrar relaciones y contratos** (LOI / convenios) con el founder como operador nombrado.
- **Higiene IP barata (esta semana):** registrar **marca** del programa+producto en la OEPM;
  **autoría datada** (el historial git ya es prueba; reforzar con depósito en Registro de la
  Propiedad Intelectual o sellado de tiempo); comprar **dominios**.
- **Divulgación por fases:** enseñar lo justo para crear deseo; guardar el "cómo" (secuencia
  de coalición, modelo de reparto, integración) hasta compromiso firmado.
- **Secuencia de abordaje como defensa:** empezar por un aliado privado que te valore a TI,
  no por el actor con más capacidad de apropiarse (FFRM en frío → riesgo de que se lo pasen a
  Novanet).
- **Cláusula de confidencialidad + no-circunvención** en acuerdos con socios privados.
- **Consulta a abogado de IP/mercantil** (gasto defensivo de mayor retorno). *No somos
  abogados — confirmar con uno.*

---

## 7 · HOJA DE RUTA (fases)

**Fase 0 — Blindaje (esta semana, en paralelo a todo):**
- Decidir **nombre del programa** y de la marca (candidatos en §8-bis) → verificar
  disponibilidad en **OEPM + EUIPO + dominios** y registrar.
- **Memo de autoría datado** — 1-2 págs: título del concepto, fecha, autor (nombre + ID), la
  tesis + el mecanismo (los dos botones), estado de desarrollo (qué código ya existe), y
  **referencia a los commits git** (`6e17e83` este doc) como prueba de anterioridad. Destino:
  depósito en Registro de la Propiedad Intelectual o sellado de tiempo (Safe Creative).
- **Checklist marca + dominios** — nombre(s) candidato(s); clases de Niza (probable: 9
  software · 35 gestión/publicidad · 41 deporte/educación · 42 tecnología — confirmar con
  agente); búsqueda de disponibilidad (OEPM + EUIPO + dominios); dominios (.es/.com +
  variantes); handles de redes.
- **Plantilla NDA + cláusula no-circunvención** para socios privados.
- **Consulta express con abogado IP/mercantil.**

**Fase 1 — Producto demostrable (piloto físico real):**
- Activar el carril (`CANTERA_VERTICAL_ACTIVE`) en un entorno demo.
- Generar **un lote real de carnets PVC+NFC** de UN club piloto (reusa `buildPlayerCardPVC` +
  `print-order-export`), con cara B de patrocinador local de prueba.
- Tener en mano un carnet físico que se toca y un NFC que abre `/c/:slug`. *Show, don't tell.*

**Fase 2 — Viabilidad federativa (las 3 preguntas que lo deciden):**
1. ¿Es **cedible/sincronizable el dato de Fénix** a un tercero para imprimir el carnet?
2. ¿Tiene la **FFRM potestad autonómica** para autorizarlo, o hace falta **RFEF**?
3. ¿**Quién cobra** el carnet y cómo se reparte?
   → Si el dato Fénix NO es cedible, el relato "oficial" cambia (carnet *avalado* vs *oficial*).

**Fase 3 — Coalición (orden de llamadas = casi todo):**
- Aliado privado / club campeón → algo por escrito.
- Mecenas insignia (la Caixa) bajo el relato inclusión/valores → LOI de mecenazgo.
- CARM · DG Deportes → aval/convenio del programa.
- FFRM **al final**, como protagonista de un programa ya financiado y respaldado.

**Fase 4 — Capa máster + reparto (código + convenio):**
- Construir patrocinador máster federativo + modelo de reparto + whitelist de sectores.
- Convenio tripartito CARM + mecenas + FFRM.

**Fase 5 — Despliegue:**
- Integración del dato Fénix (si se cede), branding del programa, escalado regional.
- (Fase 2 RFEF / otras autonómicas: solo tras un piloto autonómico que funcione.)

---

## 8 · Decisiones abiertas (el hilo nuevo debe resolverlas)

- ¿Dato Fénix cedible? ¿Potestad FFRM vs RFEF? (bloqueante de la "oficialidad")
- Modelo de reparto exacto del mecenazgo (federación / club / plataforma).
- ¿Carnet **obligatorio** (distribución garantizada → valor publicitario) o **voluntario**?
- Nombre del programa y de la marca a registrar (candidatos en §8-bis — **elegir**).
- ¿Quién vende el patrocinio máster (federación / agencia / founder)?
- ¿"Carnet **oficial**" (requiere Fénix) vs "carnet **avalado** por la FFRM" (no requiere
  ceder dato) como posicionamiento de arranque?

---

## 8-bis · Marca y nombre — candidatos propuestos (2026-06-10)

Pensar en **dos capas**: **paraguas institucional** (el programa "blanco" que se vende a
federación/mecenas) + **producto** (el carnet que toca el usuario). Fuerza de marca legal:
**inventada > sugestiva > descriptiva**. TODOS requieren verificar disponibilidad en
**OEPM + EUIPO + dominios** antes de fijar.

**Paraguas institucional (programa):**
- **Arraigo** ⭐ recomendado — pertenencia/raíz; sugestivo (registrable), tono blanco e
  institucional. "Programa Arraigo".
- **Federia** — inventada de "federado"; marca legalmente la más fuerte, suena a plataforma.
  Buen todo-en-uno si se quiere marca única.
- **Raíces** — "deporte **base**" = raíces; cálido y on-message, pero palabra común → marca
  débil, combinar con distintivo.
- **Vínculo** — lazo jugador-club-región; blanco, común.

**Producto (carnet):**
- **Dorsal** ⭐ — el dorsal es la identidad portable del jugador; corto y moderno. Algo
  descriptivo en deporte → verificar colisión.
- **Insignia** — credencial/escudo; riesgo de colisión con marcas existentes.

**Emparejamiento recomendado:** Programa **Arraigo** + carnet **Dorsal**. Alternativa
monolítica: **Federia**.

⚠️ **Evitar:** cualquier cosa cercana a **"Fénix"** (es el sistema RFEF) y términos puramente
descriptivos ("Carnet Deportivo", "Carné Base") — no registrables. Decisión del founder
pendiente; bloquea el arranque de la Fase 0.

---

## 9 · Cómo arrancar el próximo hilo

1. Leer la sección "Cantera · vertical deporte base" de `CLAUDE.md`.
2. Leer `docs/cantera-handoff.md` (estado de la infra Cantera).
3. Leer este doc.
4. Confirmar en qué **fase** (§7) estamos y atacar la primera tarea pendiente de esa fase.
   Probable arranque: **Fase 0 (blindaje) + Fase 1 (piloto físico)** en paralelo, porque el
   producto demostrable es a la vez el mejor argumento comercial y la mejor protección.

---

## Fuentes (verificación 2026-06-10)

- CARM · Subvenciones a Federaciones Deportivas: https://www.carm.es/web/pagina?IDCONTENIDO=56904&IDTIPO=100&RASTRO=c537%24m
- CARM · Dirección General de Deportes: https://www.carm.es/web/pagina?IDCONTENIDO=22737&IDTIPO=100&RASTRO=c77$m22725
- CaixaBank y Élite Murcia · deporte como motor de inclusión social (Foro Sostenibilidad 2026): https://www.cope.es/emisoras/region-de-murcia/murcia-provincia/murcia-san-javier/deportes-cope-en-murcia/cronica/caixabank-elite-murcia-impulsan-deporte-motor-inclusion-social-iii-foro-sostenibilidad-20260430_3355617.html
- Ficha/licencia federativa (documento oficial, sistema Fénix): https://www.misentrenamientosdefutbol.com/diccionario/ficha-federativa
- Tramitación de licencias y Fénix: https://ffcv.es/wp/cumplimentacion-de-licencias/
- FFRM cambia a Novanet (2024): https://webffrm.novanet.es/pnfg/NNws_ShwNewDup?codigo=1059113&cod_primaria=1000057&cod_secundaria=1000057
- Fundación Deporte Base · modelo de mecenazgo: https://www.deportebase.org/empresas
