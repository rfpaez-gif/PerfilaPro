# Portal del agente — qué ves y cómo se navega

Tu portal vive en `https://perfilapro.es/agente-login.html`. Es una
página interna `noindex,nofollow` — no aparece en Google ni se enlaza
desde la web pública.

## Entrar

- **URL**: `https://perfilapro.es/agente-login.html`
- **Credenciales**: email + contraseña. Las da de alta el founder
  desde el admin; si las has olvidado, escribe a `hola@perfilapro.es`.
  No hay flujo de "olvidé mi contraseña" automático.
- **Sesión**: dura 7 días. Pasados los 7 días, la página te
  redirige al login y vuelves a entrar con email + contraseña.
- **Logout**: botón "Cerrar sesión" en la topbar. Borra el token
  local — útil si entras desde un equipo prestado.

Si el portal te devuelve a `/agente-login.html` sin pedirte nada,
es que la sesión expiró. Vuelves a entrar normal.

## Estructura de la página

```
┌─────────────────────────────────────────────┐
│  PerfilaPro · Colaboradores       Tu nombre │
├─────────────────────────────────────────────┤
│  [Autónomos N]  [B2B M]                     │  ← pestañas
│                                             │
│  ─ Contenido de la pestaña activa ─         │
│                                             │
│  Historial de liquidaciones        CSV ↓    │  ← común a ambas
└─────────────────────────────────────────────┘
```

Los contadores `N` y `M` junto al nombre de cada pestaña son el
número de ventas registradas en ese carril. Te dicen de un vistazo
dónde tienes cartera.

## Pestaña Autónomos

Es lo que se vende a un autónomo individual que quiere su tarjeta
digital.

### Bloque 1 · Enlace de referido

Caja verde con:

- Tu enlace personal: `https://perfilapro.es/?ref=TU_CODIGO`.
- Botón **Copiar**. Pulsado, te confirma "¡Copiado!" durante 1.5 s.

Este link es el que repartes a autónomos individuales. Cómo se
atribuye y cuándo conviene usarlo está en
[links-referido.md](kit-agente-links-referido.md).

### Bloque 2 · KPIs

Tres tarjetas:

- **Tarjetas vendidas** — ventas directas (cards con tu
  `agent_code`). Es el contador histórico, sin filtro de fecha.
- **Ventas red** — ventas hechas por tus sub-agentes. Si no
  tienes sub-agentes, queda en 0.
- **Comisión pendiente** — **suma de cards + B2B sin liquidar**.
  No es solo cards: es todo lo que el founder aún no ha marcado
  como pagado, incluyendo facturas B2B recurrentes. Cuando el
  founder cierra un periodo, este número baja.

### Bloque 3 · Resumen mensual

Tabla con un mes por fila:

| Columna | Qué es |
|---|---|
| Período | Mes en formato `Mes AAAA` (ej. May 2026). |
| Ventas propias | Tus altas en ese mes. |
| Ventas red | Altas de tus sub-agentes ese mes. |
| Facturado | Suma bruta de lo cobrado al cliente. |
| Comisión cards | Lo que generas tú ese mes (incluye 5% L2 sobre la red si tienes sub-agentes). |
| Estado | `Pendiente` o `Liquidado`. |

Solo se listan meses con actividad real de cards. Un mes sin
ventas no aparece. Si trabajas solo el carril B2B y nunca tocas
autónomos, esta tabla queda vacía y la página te dice "Sin ventas
de tarjetas aún" — eso es esperable, no es un bug.

### Bloque 4 · Últimas tarjetas

Las últimas 20 cards vendidas con tu código, ordenadas por fecha
de creación descendente. Columnas: profesional, plan, estado de
la card, fecha. El nombre del profesional enlaza a `/c/{slug}` —
clic, abres su tarjeta pública en una pestaña nueva para revisar
cómo ha quedado.

## Pestaña B2B

Es lo que se vende a una organización (empresa, despacho, colegio,
asociación). Aquí está el grueso del valor a largo plazo porque
las suscripciones son recurrentes.

### Bloque 1 · Enlaces B2B (ES + CA)

Dos enlaces, cada uno con su botón Copiar:

- `https://perfilapro.es/es/empresas?via=TU_CODIGO`
- `https://perfilapro.es/ca/empresas?via=TU_CODIGO`

Compártelos según el idioma que use la organización a la que vas.
Catalunya y zonas catalanoparlantes → usa el CA; resto → ES.

Hay un texto de ayuda debajo que recuerda: "Cuando rellenen el
formulario, tu código queda registrado en el lead para que la
atribución llegue a tu liquidación." Es exactamente eso —
`b2b_leads.agent_code` se llena con tu código al instante que el
lead pulsa "Enviar →".

### Bloque 2 · KPIs B2B

- **Orgs activas** — organizaciones con suscripción `active`
  atribuidas a tu código. Una org cancelada deja de contar.
- **MRR estimado** — €/mes recurrente. Para suscripciones
  mensuales, el invoice es directo; para anuales, el invoice se
  divide entre 12. Es una aproximación: una org que pasó de
  monthly a annual hace una semana puede sesgar el dato unos
  días hasta que estabilice.
- **Facturas recibidas** — número de `invoice.paid` registradas
  para tus orgs en los últimos meses (límite 20).

### Bloque 3 · Resumen mensual B2B

Tabla análoga a la de cards pero con facturas B2B:

| Columna | Qué es |
|---|---|
| Período | Mes (`May 2026`). |
| Facturas propias | Invoices de orgs tuyas pagados ese mes. |
| Facturas red | Invoices de orgs de tus sub-agentes ese mes. |
| Comisión B2B | Lo que generas ese mes en B2B (incluye L2). |
| Estado | `Pendiente` o `Liquidado`. |

### Bloque 4 · Organizaciones

Listado de tus orgs activas y canceladas:

- Nombre + slug interno (`empresa-x`).
- Tier + ciclo (Equipo · Mensual, Organización · Anual, …).
- Seats: número de profesionales contratados.
- Estado: Activa / Trial / Impago / Pausada / Cancelada.
- Renueva el: fecha del próximo período.

El nombre enlaza a `/e/{slug}` — la página pública branded de la
organización. Útil para verificar que el logo y los colores de tu
cliente están bien puestos.

### Bloque 5 · Últimas facturas

Las últimas 20 facturas pagadas, fecha + org + plan + seats +
importe. La columna org muestra los primeros 8 caracteres del UUID
de la organización (suficiente para identificarla en una
conversación con el founder; si necesitas el ID completo, lo verás
en el CSV exportado).

## Historial de liquidaciones (común, al pie)

Bajo las dos pestañas hay siempre una tabla común con todas las
liquidaciones que el founder te ha pagado:

| Periodo | Ventas | Importe | Comisión | Pagado |
|---|---|---|---|---|

- **Comisión** es la suma cards + B2B que se te pagó en ese cierre.
- **Pagado** es la fecha en la que el founder marcó el periodo
  como liquidado. La fecha en la que apareció el dinero en tu
  cuenta puede ser unos días después según el banco.
- Si ves que un periodo cerrado no aparece o aparece con cifras
  raras, escribe al founder con el periodo concreto.

## Botón Exportar CSV ↓

Arriba a la derecha de la tabla de liquidaciones. Pulsado descarga
`extracto-TUCODIGO-AAAA-MM-DD.csv` con cinco bloques en orden:

1. **Resumen** — código, comisión base (%), override (%), totales.
2. **Resumen mensual** — fila por mes con cards + B2B + comisiones
   desglosadas + estado.
3. **Últimas tarjetas (autónomos)** — top 20 ventas cards.
4. **Últimas facturas B2B** — top 20 invoices B2B.
5. **Liquidaciones pagadas** — historial completo.

El CSV está en UTF-8 con BOM, separador coma, comillas escapadas
RFC-4180. Excel-ES lo abre sin pedir paso de importación.

**Para qué sirve**: como soporte documental cuando emites tu
factura a PerfilaPro por la comisión del periodo. Adjúntalo. Más
detalle en [operativa-cobros.md](kit-agente-operativa-cobros.md).

## Cosas que no encontrarás en el portal

- **Crear sub-agentes.** Solo el founder puede dar de alta agentes
  hijos bajo tu `parent_agent_id`. Si quieres que alguien venda
  bajo tu paraguas, escribe al founder.
- **Cambiar tu rate de comisión.** Lo fija el founder al alta y
  cualquier cambio pasa por él.
- **Editar fichas de tus clientes.** No tienes acceso a sus cards
  ni a sus paneles. Esa frontera es deliberada: tu trabajo es
  captar, el cliente gestiona su propia card / org.
- **Reasignar leads o orgs entre agentes.** Lo hace el founder
  desde el admin.
- **Modificar tu NIF / dirección / razón social.** Editables solo
  vía founder. Si cambian tus datos fiscales, avisa por email.
