# Links de referido — autónomos vs B2B

Tienes **dos enlaces distintos** porque son **dos productos**
distintos con flujos de pago, atribución y comisión también
distintos. Antes de mandar un link a alguien, decide a qué carril
le va a entrar.

## Resumen rápido

| | Autónomos | B2B |
|---|---|---|
| **URL base ES** | `/?ref=AGENT` | `/es/empresas?via=AGENT` |
| **URL base CA** | (mismo, sin variante) | `/ca/empresas?via=AGENT` |
| **Quién paga** | El autónomo individual | La organización |
| **Modo** | One-shot (9€ o 19€) | Suscripción Stripe recurrente |
| **Atribución persiste en** | `cards.agent_code` | `b2b_leads.agent_code` → `organizations.agent_code` → `org_invoices.agent_code` |
| **Tu comisión es** | One-shot al pago | Recurrente, en cada `invoice.paid` |

Reemplaza `AGENT` por tu código (ej. `agent-12`). Puedes verlo en
tu portal en la caja "Tu enlace · autónomos" y "Tus enlaces · B2B".

## Link autónomos · `/?ref=AGENT`

### Qué hace

Lleva a la página de inicio (`/es/` o `/ca/` según browser del
visitante). El JS de la página guarda tu código en
`localStorage.pp_ref` y lo mantiene durante toda la navegación. Si
el visitante hace el alta más tarde en `/alta`, su `agent_code`
queda registrado en `cards`.

### Cuándo usarlo

- Hablas con un autónomo individual que quiere su tarjeta digital.
- Estás en un evento sectorial de oficios (gremios, ferias) y
  repartes el link impreso o por QR.
- Compartes en redes sociales orgánicas con un mensaje del tipo
  "Te monto tu tarjeta digital en 5 minutos · usa mi enlace".

### Cuándo NO usarlo

- Si la persona enfrente representa una organización (empresa,
  despacho, colegio), incluso si se presenta como "autónomo" pero
  tiene un equipo bajo él. Mejor el link B2B — la comisión
  recurrente es mucho mayor.
- Si hay una campaña activa de Pro-gratis (te lo avisa el founder).
  En ese caso el autónomo no paga y tu comisión cards en ese alta
  es 0 €. La atribución se registra, pero el embudo importa para
  el carril B2B, no para tu cobro inmediato.

### Cómo se atribuye, paso a paso

1. Visitante abre `https://perfilapro.es/?ref=agent-12`.
2. El JS detecta el query param, lo valida y guarda en
   `localStorage.pp_ref = 'agent-12'`.
3. Visitante navega a `/es/alta`. El form añade
   `agent_code: 'agent-12'` al POST que va a `/api/register-free`.
4. Backend valida formato, crea la card con
   `cards.agent_code = 'agent-12'`.
5. Si luego el autónomo pasa a Pro pagando, `stripe-webhook`
   conserva el `agent_code` previo (no lo borra al hacer el upsert).
6. En tu portal aparece la card en "Últimas tarjetas" y suma a
   tus KPIs.

### Ejemplo copiable

```
👋 Si quieres montar tu tarjeta digital con tu nombre,
WhatsApp y servicios — perfilapro.es te lo deja listo en 5 min.

Usa mi enlace: https://perfilapro.es/?ref=agent-12

Si te trabas en algo, me lo dices y te ayudo.
```

## Links B2B · `/es/empresas?via=AGENT` y `/ca/empresas?via=AGENT`

### Qué hacen

Llevan al landing B2B (`/es/empresas` o `/ca/empresas`). El JS del
landing detecta `?via=AGENT`, valida el formato y guarda el código
en `localStorage.pp_b2b_via`. Cuando el visitante rellena el form
de "demo / contacto", el código viaja al backend y queda en
`b2b_leads.agent_code` con índice de búsqueda.

A partir de ahí, el founder ve tu código en la fila del lead en el
B2B Studio (admin) y, cuando crea la organización, copia tu código
a `organizations.agent_code`. Cada factura recurrente posterior
queda atribuida a ti vía `org_invoices.agent_code`.

### Cuándo usar ES vs CA

- La organización está en Catalunya, Andorra, Baleares o País
  Valencià y opera en catalán → **CA**.
- Resto del Estado o si tienes dudas → **ES**.
- No mezcles: si mandas el link ES a un cliente catalán, el
  landing le saldrá en castellano y eso es señal de poco cuidado.

### Cuándo usar B2B vs Autónomos

Manda B2B siempre que la persona enfrente:

- Sea dueña o decisora de una **empresa con red comercial**
  (8+ profesionales bajo paraguas de marca).
- Lidere un **despacho o consultora** (abogados, fisios,
  arquitectos, psicólogos, peritos, agentes inmobiliarios).
- Represente un **colegio profesional, asociación o
  federación** con miembros profesionales.
- Hable en nombre de una **administración pública u ONG** con
  red de profesionales internos.

Si dudas, pregúntate: ¿esta persona toma decisiones por sí
misma o por un grupo? Si por un grupo → B2B.

### Cómo se atribuye, paso a paso

1. Lead abre `https://perfilapro.es/es/empresas?via=agent-12`.
2. JS del landing valida y guarda `localStorage.pp_b2b_via`.
3. Lead rellena el form (nombre, organización, email, tamaño de
   equipo, tipo de organización, mensaje). El hidden input `via`
   va con `agent-12`.
4. `/api/lead-b2b` persiste el lead con
   `b2b_leads.agent_code = 'agent-12'`. El founder recibe un email
   interno mostrando "Referido por: **agent-12**".
5. **El lead NO recibe el magic-link automáticamente**. El founder
   lo manda a mano desde admin-orgs después de hablar contigo (o
   con el lead) — ese gate manual evita que un formulario público
   abra un onboarding sin conversación previa.
6. Cuando se cierra la venta, el founder crea
   `organizations` con `agent_code = 'agent-12'` y configura la
   suscripción Stripe.
7. Cada `invoice.paid` posterior (mensual o anual) genera una fila
   en `org_invoices` con `agent_code = 'agent-12'`. Eso es lo que
   tu portal cuenta como comisión B2B recurrente.

### Atribución y carry-over

La copia de `b2b_leads.agent_code` a `organizations.agent_code`
**no es automática hoy**: el founder la hace manualmente al crear
la organización. Si llevas semanas con un lead activo, recuerda al
founder al cierre: "Esta org era mi lead, agent_code agent-12".

Una vez la org tiene `agent_code` rellenado, todo lo posterior se
encadena solo.

### Ejemplos copiables

**ES — abierto a tipo de organización:**

```
Hola [Nombre],

Trabajo con PerfilaPro, una plataforma para que organizaciones
con red de profesionales tengan a todo su equipo en miniwebs
profesionales con su misma marca (logo, color, dirección, dominio
público propio).

Pensé en [Org] porque [razón específica]. Te dejo el sitio para
que veas la propuesta y, si te encaja, escojas un hueco para una
demo de 15 min:

https://perfilapro.es/es/empresas?via=agent-12

Cualquier duda me la dices por aquí. Un saludo.
```

**CA — mismo ángulo:**

```
Hola [Nom],

Treballo amb PerfilaPro, una plataforma perquè organitzacions amb
xarxa de professionals tinguin tot l'equip amb miniwebs
professionals i identitat de la pròpia marca (logotip, color,
adreça, domini públic propi).

Vaig pensar en [Org] perquè [raó específica]. Et deixo el web
perquè vegis la proposta i, si t'encaixa, triïs un buit per a una
demo de 15 min:

https://perfilapro.es/ca/empresas?via=agent-12

Qualsevol dubte me'l dius per aquí. Salutacions.
```

Plantillas más concretas (por tipo de organización + canal) en
[plantillas-prospeccion.md](kit-agente-plantillas-prospeccion.md).

## Errores de atribución que te conviene evitar

- **Compartir el link sin tu código**. Si pegas
  `https://perfilapro.es/es/empresas` (sin `?via=AGENT`), el lead
  se atribuye al founder, no a ti. **Verifica el link cada vez**.
- **Acortar el link con un servicio que normaliza query params**.
  Algunos acortadores (raros) los strippean. Usa enlaces directos
  o un acortador que respete params (bit.ly los respeta).
- **Hacer doble atribución**: el visitante abre ES con
  `?via=agent-12`, luego abre el mismo link con `?via=agent-99`.
  Gana el último porque `localStorage.pp_b2b_via` se sobrescribe.
  Cuidado al pasar un link entre comerciales.
- **Pegar el link en redes sin contexto**. El landing B2B convierte
  cuando llega gente que ya tiene una sospecha de necesidad. El
  spray-and-pray funciona mal y queda como ruido.
