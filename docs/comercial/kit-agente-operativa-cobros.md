# Operativa de cobros — facturación y liquidaciones

Esto cubre la parte aburrida pero importante: cuándo se cierran
las liquidaciones, cómo facturas a PerfilaPro, qué información
tiene que estar al día en tu ficha de agente.

## Ciclo de liquidación

- **Cadencia**: mensual. El founder cierra el periodo del mes `N`
  durante los primeros días del mes `N+1`.
- **Qué incluye un cierre**: todas las ventas cards + facturas
  B2B del mes anterior atribuidas a tu código. Más el override
  L2 sobre las de tus sub-agentes en ese mismo mes.
- **Cómo se materializa**: el founder crea/actualiza una fila en
  `agent_liquidations` con `period = 'AAAA-MM'`, `status = 'paid'`,
  `paid_at = now()`. A partir de ese momento, esa fila aparece en
  tu portal en la tabla "Historial de liquidaciones" con la fecha
  en la columna "Pagado".
- **Pago real al banco**: transferencia. La fecha "Pagado" en tu
  portal es la fecha en la que el founder marca el periodo como
  cerrado y emite la transferencia; el dinero entra a tu cuenta
  en los 1-3 días hábiles siguientes según el banco emisor /
  receptor.

## Tu factura a PerfilaPro

Eres autónomo o sociedad: emites una factura a PerfilaPro por la
cuantía de tu comisión liquidada en el periodo.

### Datos del receptor (cliente de tu factura)

Los datos legales de PerfilaPro como receptor están en la web
pública y los puedes ver en cualquier momento:

- Página: `https://perfilapro.es/es/legal`
- API directa: `GET /.netlify/functions/legal-settings`

Esa endpoint devuelve `legal_name`, `legal_nif`, `legal_address` y
`legal_email`. Son las cuatro cosas que necesitas para la cabecera
de receptor en tu factura.

> Si en algún momento esos datos cambian (cambio de razón social,
> domicilio fiscal), la fuente oficial es esa página/endpoint. No
> uses datos guardados de hace meses; léelos antes de cada factura.

### Estructura recomendada de la factura

- **Concepto** (un único concepto por factura):
  `Comisión PerfilaPro · Periodo AAAA-MM`
- **Cantidad**: la del campo "Comisión" del periodo liquidado en
  tu portal.
- **IVA**: el que corresponda según tu régimen fiscal (en general
  21% si estás en régimen general español; tú o tu asesor sabéis
  mejor). PerfilaPro no te asesora fiscalmente; aplica el que
  marque tu situación.
- **Forma de pago**: transferencia. Indica tu IBAN.

### A dónde mandar la factura

Email a `legal_email` (que ves en `/api/legal-settings`). Pon en
copia `hola@perfilapro.es` para que quede registro operativo.

Asunto recomendado:
`Factura comisión PerfilaPro · AAAA-MM · [tu_código]`

## Soporte documental

Tu portal genera el extracto de cada cierre. Para cada periodo
liquidado:

1. Entra al portal.
2. Pulsa **Exportar CSV ↓** (esquina superior derecha de la
   tabla "Historial de liquidaciones").
3. Se descarga `extracto-TUCODIGO-AAAA-MM-DD.csv`.
4. **Adjunta ese CSV a tu factura** como anexo.

El CSV contiene:

- Resumen: tu código, tu rate, override 5%, totales.
- Resumen mensual: una fila por mes con ventas cards, facturas
  B2B, comisiones desglosadas, estado.
- Últimas tarjetas (autónomos): las 20 últimas ventas cards.
- Últimas facturas B2B: las 20 últimas facturas con `paid_at`,
  organización (UUID), tier, ciclo, seats, importe.
- Liquidaciones pagadas: histórico completo.

Es la evidencia documental que respalda tu factura. El founder no
debería tener que pedírtela porque ya la genera el sistema; tú la
adjuntas porque es buena higiene contable.

## Datos tuyos que tienen que estar al día

Tu ficha en `agents` tiene tres campos que el founder rellenó al
darte de alta y que **necesitas mantener actualizados** para que
te puedan pagar y para que tu factura sea correcta:

- **NIF / CIF** (`agents.nif`)
- **Dirección fiscal** (`agents.address`)
- **Razón social** (`agents.business_name`) — si operas como
  autónomo persona física, es tu nombre completo; si tienes
  SL/SLU u otra forma, la denominación legal.

**Si alguno cambia, envíalo por email** a `hola@perfilapro.es`
con asunto "Actualización ficha agente · [tu_código]" y los
datos nuevos. No hay autoservicio para esto hoy — la edición la
hace el founder desde el admin.

## Periodicidad y retrasos

- **Cierre normal**: durante los primeros 7-10 días del mes
  siguiente. Si pasados 15 días no ves la fila en "Historial",
  escribe al founder con el periodo.
- **Comisión pendiente que crece y no se liquida**: si llevas más
  de un mes con cifras grandes en pendiente y nada en liquidado,
  algo está atascado. Email al founder.
- **Periodo liquidado con cifras raras**: compara el CSV
  exportado con la fila de liquidación. Si no cuadra, manda al
  founder el CSV + tu cálculo + el desacuerdo concreto. El
  founder revisa; si hay error, lo corrige (puede ser un invoice
  Stripe que llegó tarde, un override mal aplicado, etc.).

## Casos especiales

### Org que pasa de monthly a annual

El KPI **MRR estimado** del portal puede sesgar unos días tras el
cambio porque mira el último invoice y lo divide por 12 si es
anual. Aclárale al founder si lo ves muy disparado — pero como
tu **comisión real** se calcula sobre `amount_cents` de los
invoices reales pagados, lo que cobras al final es exacto.

### Org cancelada a mitad de periodo

Si una org tuya cancela:

- Stripe deja de emitir invoices.
- El último invoice ya emitido sigue siendo tuyo (lo cobras en su
  liquidación).
- La org aparece en tu tabla "Organizaciones" con badge
  "Cancelada" pero sigue contando en el histórico.

### Cliente paga con tarjeta que rebota (subscription `past_due`)

El invoice se considera **no pagado** hasta que Stripe consigue
cobrar. Tu comisión sobre ese invoice **se devenga en `invoice.paid`**
— mientras esté `past_due`, no entra en tu pendiente. Si Stripe
falla varios reintentos y la sub pasa a `canceled`, ese invoice
nunca te genera comisión.

### Promo Pro gratis activa

Si el founder enciende `WEB_FUNNEL_FREE_ACTIVE` o
`DEMO_FUNNEL_FREE_ACTIVE`, las altas de autónomo bajo tu `?ref=`
quedan como Pro gratis. La card se registra con tu `agent_code`
pero **no hay precio, no hay comisión**. Esto es deliberado: en
campaña promocional, el agente aporta embudo, no facturación
directa. El valor llega por el carril B2B (que sigue siendo
recurrente como siempre) y por la red que se construye.

## Lo que NO existe (todavía)

- **Pago automático**. No hay integración bancaria que liquide
  automáticamente al cierre del periodo. El founder hace la
  transferencia.
- **Generación automática de tu factura desde el portal**. Tú la
  emites con tu programa de facturación.
- **Adelantos de comisión**. No se adelanta comisión pendiente.
  Se paga al cierre.
- **Cambio de IBAN sin email previo**. El founder solo paga al
  IBAN que tiene registrado; cambios de IBAN se confirman por
  email + llamada antes del siguiente cierre.
