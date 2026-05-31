═══════════════════════════════════════════════════════════════════
HANDOFF — PerfilaPro · Cantera: Inscripción de temporada (repaso + pulido)
═══════════════════════════════════════════════════════════════════
Repo: rfpaez-gif/PerfilaPro
Rama base: main @ 1057be1 (todo lo de abajo YA está mergeado en main)
Stripe: MODO PRUEBA · Sitio: perfilapro.netlify.app / perfilapro.es
Doc de diseño completo: docs/cantera-inscripcion-temporada.md

───────────────────────────────────────────────────────────────────
QUÉ SE HIZO EN EL HILO ANTERIOR (todo en main, probado en prod)
───────────────────────────────────────────────────────────────────
MVP de "inscripción de temporada" del vertical Cantera, capas I0→I6 + extras.
Resuelve el aluvión de matriculaciones de septiembre: el club abre
inscripciones y comparte enlace/QR → cada familia se autoinscribe desde el
móvil (datos + consentimiento + pago en una pantalla) → el club encuadra
equipos en lote → centro de cobros concilia Stripe + pagos manuales.

PRs mergeados:
  #156 — MVP I0→I6 + fix copy carnet 12€/6€
  #157 — fix: confirm de pedido de carnets decía 19/9 → 12/6
  #158 — invitación múltiple a inscribirse (Opción A)

Capas (cada una con tests Vitest verdes · suite total 1457/1457):
  I0  migración 037 (enrollment_campaigns + columnas nuevas) — DORMIDA hasta aplicar
  I1  libs puros: player-create, enrollment, season-billing
  I2  create-enrollment-checkout + lib/enrollment-checkout (matrícula one-shot
      + cuota recurrente, SEPA+tarjeta, 3% Connect; reusa kind='cantera-parent-fee')
  I3  org-panel: enrollment_open/close/get + lib/enrollment-campaign (enlace + QR)
  I4  enrollment-submit (público, honeypot) + enrollment-page (/{es,ca}/inscripcion/:token)
  I5  org-panel: enrollment_assign (encuadre en lote) + lib/enrollment-assign
  I6  org-panel: billing_matrix (matriz jugador×mes) reusa lib/season-billing
  +   org-panel: enrollment_invite (invitación múltiple, Opción A) + lib/enrollment-invite

DECISIONES CERRADAS (no re-debatir — están en el doc §11):
  1. Matrícula one-shot en el mismo checkout que arranca la cuota.
  2. Documentos opcionales en la inscripción, completables después (I7, pendiente).
  3. Gate del Dashboard por carnets: comercial, no técnico (no se bloquea).
  4. Temporada = matrícula + 9 mensualidades.
  5. Consentir imagen HABILITA pero no dispara la visibilidad del menor (siempre noindex).
  + Invitación múltiple = Opción A (invitar a inscribirse, NO crea cards; LOPD-limpio).

───────────────────────────────────────────────────────────────────
✅ HECHO Y PROBADO EN PRODUCCIÓN (por el founder, modo prueba Stripe)
───────────────────────────────────────────────────────────────────
• Migración 037 aplicada en Supabase.
• Club de prueba: "Escuela de Fútbol Universal" (kind='sports_club',
  sport='futbol', cantera_monthly_fee_cents=3000, Connect conectado y activo).
• Flujo end-to-end OK: abrir campaña → inscripción del padre → checkout REAL
  de Stripe cobrando 30€/mes → jugador (Carlos) aparece en la Plantilla.
• Página del padre (/inscripcion/:token) y vista del tutor renderizan bien.

───────────────────────────────────────────────────────────────────
🔧 PENDIENTE — repaso y pulido (objetivo de este hilo nuevo)
───────────────────────────────────────────────────────────────────
1. LIMPIEZA DE UI · pestañas que se solapan (lo señaló el founder).
   "Fichajes" (traspaso entre clubes PerfilaPro, flujo request/accept-transfer)
   e "Inscripciones" (alta masiva de temporada, lo nuevo) conviven en el Studio
   y confunden. Decidir: ¿fusionar, renombrar, reordenar? Conceptualmente son
   procesos distintos pero el founder los ve mezclados. REVISAR TAMBIÉN si hay
   más solapamientos UI entre lo viejo (capa 6 del Studio) y lo nuevo (I3-I6).

2. CHECKOUT DEL PANEL DEL PADRE usa el endpoint VIEJO.
   El botón "Pagar la cuota con tarjeta" en la vista del tutor (panel.html,
   función startParentCheckout) llama a /api/create-parent-checkout — solo
   cuota, solo tarjeta, SIN matrícula ni SEPA. El nuevo create-enrollment-checkout
   (matrícula + cuota + SEPA) SOLO se dispara desde /inscripcion/:token con
   payment_choice='online'. Decidir: ¿apuntar el botón del panel al endpoint
   nuevo, o dejar dos caminos (cuota suelta vs inscripción completa)?

3. SEPA no aparece en el checkout.
   create-enrollment-checkout ya pide payment_method_types:['card','sepa_debit'],
   pero SEPA Direct Debit hay que ACTIVARLO en el dashboard de Stripe
   (Settings → Payment methods) y en las cuentas Connect de los clubes.
   Es config, NO código. Verificar tras activarlo.

4. NOMBRE PEGADO "Carlos MartinezGarcía" (sin espacio entre apellidos).
   Verificar si es dato de entrada (el founder lo tecleó así) o bug de
   concatenación. El formulario de /inscripcion tiene un solo campo "nombre"
   (no separa nombre/apellidos), así que probablemente sea dato — confirmar.

5. EMAIL DEL CHECKOUT = hola@perfilapro.es en vez del email del tutor.
   En la captura, el checkout de Stripe mostraba customer_email genérico.
   Revisar create-parent-checkout / create-enrollment-checkout: deben pasar
   el email del tutor (session.email del JWT parent-panel), no el de la org.
   NOTA: puede estar relacionado con #2 (si pagó por el endpoint viejo).

───────────────────────────────────────────────────────────────────
🔜 FUERA DE SCOPE / DEUDA CONSCIENTE (no urgente)
───────────────────────────────────────────────────────────────────
• I7 — upload de foto/documentos del jugador (DNI/libro de familia/cert.
  médico) desde el panel. Tablas ya existen (card_documents, migración 037).
  Decisión 2: docs opcionales, completables después. Es la última capa del plan.
• Export federativo estandarizado (paquete por jugador para volcar a la
  federación) → fase 2.
• El QR de inscripción usa api.qrserver.com (servicio externo). Migrar a
  generación server-side con el paquete `qrcode` que YA está en el repo.
• Catalán en la página /inscripcion: el form se sirve en es y ca (detecta por
  path), pero revisar que el copy ca esté completo.

───────────────────────────────────────────────────────────────────
GOTCHAS / CONTEXTO TÉCNICO
───────────────────────────────────────────────────────────────────
• Carril gateado por isCanteraActive() (CANTERA_VERTICAL_ACTIVE=1, ya activo).
• El panel del club y la vista del padre comparten public/panel.html. Se
  ramifican por el claim `purpose` del JWT: org-panel (club) vs parent-panel
  (tutor). El Studio deportivo se muestra si org.kind==='sports_club'.
• org-panel.js es grande: las acciones de inscripción (enrollment_*,
  billing_matrix) están en el bloque ENROLLMENT_ACTIONS, gateadas por flag +
  sports_club, scoped al JWT del club.
• parent_subscriptions es la ÚNICA tabla de cuotas, da igual por qué endpoint
  entre el padre (create-parent-checkout o create-enrollment-checkout). Ambos
  usan kind='cantera-parent-fee' en metadata para que el webhook ya enrutado
  los materialice. El webhook (lib/cantera-webhook handleParentCheckoutCompleted)
  snapshotea matrícula + campaña SOLO si la metadata los trae.
• El club NO se marca kind='sports_club' desde el Studio — se hace por SQL
  (deuda conocida, pendiente #3 del handoff ORIGINAL de Cantera, aún abierta).
• Tests: npx vitest@1.6.0 run · convención makeHandler(deps) con mocks.
• Verificación de estado: cruzar git local con la API de GitHub MCP (en el
  hilo anterior la salida del terminal llegó a veces desordenada/duplicada).
• NO mergear a main sin que el founder lo pida explícitamente.
═══════════════════════════════════════════════════════════════════
