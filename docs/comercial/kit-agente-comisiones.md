# Modelo de comisión — números reales

Tu comisión es la suma de dos cosas:

1. **Tu tasa propia** (`commission_rate`) sobre lo que **tú**
   vendes. La fija el founder al darte de alta (por defecto 15%).
   Aplica en ambos carriles (autónomos y B2B).
2. **Un override fijo del 5%** sobre lo que tus sub-agentes
   venden (L2-on-L1). Aplica también en ambos carriles.

Ambas se suman y se pagan a la vez en la liquidación del periodo.
El override **se suma**, no resta a tu sub-agente: cuando el founder
te paga el 5% sobre una venta de tu sub-agente, esa venta de tu
sub-agente sigue cobrando su propia tasa íntegra.

## Carril autónomos · one-shot

Cuando un autónomo paga su plan, **tú cobras una sola vez** sobre
el precio del plan:

| Plan | Precio cliente | Comisión con rate 15% |
|---|---|---|
| Base (trimestral) | 9 € | 1,35 € |
| Pro (anual) | 19 € | 2,85 € |
| Renovación | 5 € | 0,75 € |

La renovación se factura aparte cuando el cliente la activa.

Si tu rate es distinto del 15% por defecto, ajusta la columna
derecha proporcionalmente.

## Carril B2B · recurrente

El cliente paga una suscripción Stripe (mensual o anual) por
profesional. La factura se emite cada periodo (mensual o anual) y
**tú cobras tu tasa sobre cada factura, mientras la suscripción
siga activa**.

Tiers actuales del landing (por profesional / mes):

| Tier | Mensual | Anual (2 meses gratis) |
|---|---|---|
| Equipo | 5 € | 4 € |
| Organización | 6 € | 5 € |
| Enterprise | "desde 7 €" | "desde 6 €" — gated, consultar |

El cliente paga al cobro: mensual paga importe pequeño cada mes;
anual paga el año entero por adelantado. Tu comisión sigue la
misma cadencia que el cobro: si el cliente pagó anual, tu comisión
en B2B llega cuando se emite cada renovación anual, no
prorrateada mes a mes.

## Cuatro escenarios cerrados con euros

Todos con `commission_rate = 15%` (el rate por defecto). Si el
tuyo es distinto, multiplica proporcionalmente.

### Escenario 1 — Autónomo individual (Pro anual)

- **Quién cierra**: tú, sobre Pepito Pintor que se da de alta vía
  tu `?ref=agent-12` y compra el plan Pro anual (19 €).
- **Cobra Stripe**: 19 € → cuenta de PerfilaPro.
- **Tu comisión**: 19 € × 15% = **2,85 €** (one-shot).
- **Recurrencia**: solo si Pepito **renueva** al año (5 €), tu
  comisión vuelve a contar: 5 € × 15% = 0,75 €. Tras eso, cero
  más en ese cliente hasta la siguiente renovación.

### Escenario 2 — B2B pequeño · Equipo · mensual

- **Quién cierra**: tú, sobre un despacho de 8 abogados que
  contrata Equipo Mensual (5 €/profesional/mes).
- **Cobra Stripe**: 8 × 5 € = **40 €/mes** a la org.
- **Tu comisión**: 40 € × 15% = **6 €/mes** recurrente mientras
  la org siga activa.
- **Año 1**: 72 €. **Año 2** (si no cancela): otros 72 €.
- Si el despacho contrata a su 9º abogado a mitad de año, Stripe
  ajusta `seats` (vía `customer.subscription.updated`); el siguiente
  invoice ya será 9 × 5 = 45 €/mes y tu comisión sube a 6,75 €/mes.

### Escenario 3 — B2B mediano · Organización · anual

- **Quién cierra**: tú, sobre una asociación de fisios con 30
  miembros que contrata Organización Anual (5 €/profesional/mes
  pagado anualmente = 50 €/profesional/año por los 2 meses gratis).
- **Cobra Stripe**: 30 × 50 € = **1.500 €** una vez al año.
- **Tu comisión**: 1.500 € × 15% = **225 €** en el momento del
  cobro anual. Vuelve a entrar el año siguiente si la asociación
  renueva.

### Escenario 4 — Sub-agente activado (L2-on-L1)

- **Setup**: tú tienes un sub-agente B con su propio
  `commission_rate = 10%`.
- **Quién cierra**: B vende a una pyme de 12 personas en
  Organización Anual (50 €/profesional/año).
- **Cobra Stripe**: 12 × 50 € = **600 €/año**.
- **Comisión de B**: 600 € × 10% = 60 €/año.
- **Tu comisión por override L2-on-L1**: 600 € × 5% = **30 €/año**.
- **Coste total que paga PerfilaPro en comisiones**: 90 €/año
  (15% combinado). Stripe sigue ingresando los 600 € íntegros.

Importante: el override es un **único nivel**. Si B tiene a su vez
un sub-agente C, las ventas de C generan comisión para C (su rate)
y override de 5% para B — **pero no para ti**. La pirámide no
cascadea más allá del nivel directo.

## Cómo se calcula en el portal

Tu portal hace exactamente las cuentas anteriores. En el
"Resumen mensual":

- Columna **Comisión cards**: `(tus_ventas_propias_del_mes ×
  rate%) + (ventas_sub_agentes × 5%)`.
- Columna **Comisión B2B**: `(amount_cents_propias × rate%) +
  (amount_cents_sub × 5%)`, donde `amount_cents` es la suma de
  todas las facturas Stripe pagadas ese mes.

En el KPI superior **Comisión pendiente** ves la suma cards + B2B
de todos los meses no liquidados aún.

El CSV exportado (botón "Exportar CSV ↓") incluye todas las
columnas desglosadas, así puedes verificar línea por línea.

## Cuándo NO ves la comisión que esperabas

Casos que pasan en producción y suelen confundir:

- **El cliente de un B2B canceló a mitad de periodo**. La fila
  invoice pagada del mes en curso ya estaba — esa la cobras.
  Las del futuro no se generan. La org pasa a `subscription_status:
  canceled` pero conserva acceso hasta `current_period_end`.
- **Una promo de Pro gratis activa**. Si la org/autónomo entró por
  `WEB_FUNNEL_FREE_ACTIVE` o `DEMO_FUNNEL_FREE_ACTIVE`, no hay
  cobro y por tanto no hay comisión. La atribución se registra
  pero el carril es promocional, no comercial.
- **Tu lead se cerró pero el founder no asignó `agent_code` a la
  org al crearla**. Es una asignación manual hoy. Si pasan días
  desde el cierre y no ves la org en tu portal, recuérdale al
  founder con el slug de la org y tu código.
- **Liquidación todavía no cerrada**. El portal muestra
  "Pendiente" hasta que el founder marca el periodo como pagado.
  Mientras esté en pendiente, la cifra puede crecer (porque
  entran más facturas) pero no aparece en tu cuenta bancaria.

## Nota sobre formato

Si los partners prefieren ver este modelo en un PDF denso para
adjuntar a una propuesta o a un acuerdo, **puedo generar un PDF
de una página con tabla de escenarios + footer fiscal a partir de
este markdown**. Pedidlo al founder y se monta. Por defecto se
mantiene como markdown editable para que Google Docs/Notion lo
acepte sin fricción.
