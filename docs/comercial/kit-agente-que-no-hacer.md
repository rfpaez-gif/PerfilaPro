# Qué NO hacer — promesas, descuentos, leads del founder

Este documento existe para ahorrar problemas. Léelo entero
antes de empezar. La mayoría son cosas que **parecen pequeñas
pero rompen confianza** con el cliente o con PerfilaPro.

## Promesas que no podemos cumplir

Lista no exhaustiva — el principio general: **vende lo que ves
funcionar en el landing y en la demo, no añadas por tu cuenta**.

### ❌ Diseño gráfico a medida de las tarjetas

Lo que adjuntamos al welcome kit del autónomo es un PDF A6
vertical estándar (105×148 mm). Para clientes B2B, el adjunto del
welcome kit del miembro es una tarjeta de visita 85×55 mm
horizontal estándar.

**Variables que sí están**: logotipo de la organización, color
primario (`#RRGGBB`), nombre del profesional, cargo, contacto,
QR.

**No prometas**: rediseño de plantilla, tipografías custom,
cara reverso adicional, formato distinto, fondos con imagen.
Si surge una demanda real de un cliente grande, escálalo al
founder y se evalúa.

### ❌ Integración con CRM / ERP

No hay integración con HubSpot, Salesforce, SAP, Holded, ni
nada. La organización exporta sus datos via JSON manualmente
(GDPR export endpoint) si lo necesita. No prometas integraciones
"en roadmap" salvo que tengas confirmación escrita del founder.

### ❌ Certificación ENS / ISO / acceso a contratos públicos

El landing B2B incluye una nota visible para el sector público:
"requisitos específicos (ENS, residencia de datos en España,
accesibilidad WCAG AA, contratación por pliego) se evalúan caso
por caso". Eso significa: **no tenemos ENS certificado, no
tenemos ISO 27001 certificado, no tenemos residencia de datos
garantizada solo en España**.

Si te preguntan por compliance específico:

- Si la pregunta es operativa ("¿usáis Supabase?", "¿GDPR?"), sí:
  Supabase EU, GDPR sí.
- Si la pregunta es de certificación (ENS, ISO, ENIAC), redirige
  al founder. No improvises.

### ❌ Soporte 24/7 o SLA

Soporte es `hola@perfilapro.es` en horario laboral europeo.
**No** prometas tiempos de respuesta concretos ni SLA
contractual. Si una organización pide SLA, escala al founder.

### ❌ Refacturación al cliente

PerfilaPro factura directamente al cliente B2B vía Stripe. **Tú
no eres intermediario fiscal**. No emitas facturas en tu nombre
al cliente final por suscripciones B2B — eso lo hace Stripe / la
empresa. Tu factura es a PerfilaPro por la comisión.

### ❌ Hosting custom / dominio propio del cliente

`https://perfilapro.es/e/[slug-org]` y `https://perfilapro.es/c/[slug]`.
No hay dominio propio del cliente (`*.cliente.com`). Si surge
demanda real, escala.

### ❌ "Aplicación móvil"

PerfilaPro es **web responsive**, no app nativa. Funciona perfecto
en móvil pero no hay descarga en App Store ni Play Store. No
hables de "app".

## Descuentos no autorizados

### Precios oficiales (del landing)

| Tier | Mensual | Anual (2 meses gratis) |
|---|---|---|
| Equipo | 5 €/profesional/mes | 4 €/profesional/mes |
| Organización | 6 €/profesional/mes | 5 €/profesional/mes |
| Enterprise | "desde 7 €" | "desde 6 €" |

### Lo que NO puedes ofrecer por tu cuenta

- Rebajas porcentuales ("para ti -20%").
- Periodos extra gratis ("primer trimestre gratis").
- Mezcla de tiers ("Organización al precio de Equipo").
- Comisiones reducidas para captar (sacrificar tu margen para
  cerrar).

### Excepciones que controla el founder

- **Founding partner -50%**. Aparece como garantía en el landing
  B2B. **NO** la ofrezcas sin confirmación explícita del founder
  para ese cliente concreto. Es una promo limitada y el founder
  decide caso por caso.
- **Demos personalizadas / piloto con descuento**. Si una org
  grande pide piloto pagado a precio reducido, escala. El
  founder decide y, si acepta, te lo dice por escrito.

### Cómo escalar una petición de descuento

Email a `hola@perfilapro.es` con asunto "Descuento solicitado ·
[Org]" + tres líneas: quién es, qué tier negocian, qué descuento
piden. Espera respuesta antes de prometer nada. Si el cliente
presiona, sé honesto: "Es algo que valida nuestra dirección, lo
confirmo en X días".

## Manejo de leads y atribución

### El principio

Tu atribución funciona automáticamente vía `?via=AGENT` →
`b2b_leads.agent_code`. Si el lead entra por tu link, la
organización es tuya cuando se cierre. Esa es la regla y casi
nunca se contesta.

### Casos en los que conviene preguntar antes

#### 1. Cuenta que crees que ya está en cartera del founder

Antes de invertir tiempo grande en una org concreta:

- Pregunta al founder en privado: "¿Tenéis ya conversación con
  [Org]?". Tres líneas.
- Si la respuesta es "no, adelante", trabajas tranquilo.
- Si la respuesta es "sí, lo lleva Founder / otro agente",
  retírate. Esa cuenta está bloqueada para ti.

Esto **no** es burocracia: te ahorra invertir en una cuenta que
no vas a cobrar.

#### 2. Lead que ya conoces personalmente

Si vas a vender a alguien que es amigo o exjefe — bien, pero
mándale el link explícito. No supongas que la atribución va a
"aparecer" sola.

#### 3. Empresa que ya tiene relación previa con PerfilaPro

Algunas orgs llegaron a PerfilaPro por otra vía (campaña,
mención en medios). Si crees que la org "podría tener historia",
pregunta antes de prospectar.

### Casos en los que NO está bien hacer

#### ❌ "Spam de descubrimiento"

Mandar 200 emails idénticos a una lista comprada. Esto
**funciona mal** (conversión < 0.1%) y **daña la reputación de
remitente** del dominio (clave para todos los demás emails de
PerfilaPro, incluidos los transaccionales). Si te detectamos
spam, perdemos sender score, y eso afecta a todos los agentes.

Regla operativa: **un email frío por organización, máximo, con
una razón específica para esa organización en el cuerpo**. Si
no tienes razón específica, no escribes.

#### ❌ Vampirizar leads ajenos

Si un colega agente comparte que está trabajando una cuenta, no
te metas. No mandes "ofertas mejoradas". La red comercial
funciona si los agentes confían en que su trabajo está
protegido.

#### ❌ Forzar atribución borrando localStorage del lead

Si un lead te dice "ya tengo a otro agente que me lo presentó",
no le digas que abra de incógnito tu link para "regenerar" la
atribución. Es manipulación y se nota.

## Comunicación post-venta

### Lo que SÍ haces tras cerrar

- Confirmar al cliente que la organización está montada (te avisa
  el founder).
- Acompañar 1-2 emails post-cierre para resolver dudas básicas
  del panel cliente (`/panel`).
- Estar disponible si surge una expansión: "queremos añadir
  10 seats más" → lo cuentas al founder y se incrementa.

### Lo que NO haces tras cerrar

- **Operativa cotidiana del cliente**. Si el cliente te pregunta
  cómo invitar a un nuevo miembro o cambiar el logo, **rediríge
  al panel cliente** (`/panel.html`) o a `hola@perfilapro.es`.
  No te conviertas en helpdesk del cliente — es trabajo
  no remunerado que te consume tiempo de prospección.
- **Editar perfiles de miembros del equipo del cliente**. No
  tienes acceso (deliberado) y no debes hacer las cosas "por
  ellos". Cada miembro recibe su edit-link y lo gestiona él.
- **Resolver bugs / incidencias técnicas**. Email al founder
  con `[Bug]` en el asunto.

## Cuando dudas

Tres reglas:

1. **Si tienes que mentir para cerrar, no cierras**. Esa venta
   se cae a los 3 meses con reembolso solicitado, y te quedas sin
   el cliente y sin la comisión recurrente.
2. **Pregunta antes de prometer**. Un email al founder ahorra una
   conversación incómoda con el cliente tres semanas después.
3. **El recurso es escasez**. Tu tiempo de prospección es lo más
   caro de tu operación. Inviértelo en cuentas reales con
   intención real, no en spray-and-pray.

## Resumen accionable (lo mínimo que recuerdas)

- No diseño custom, no SLA, no app, no integraciones, no ENS.
- No descuentos por tu cuenta — siempre escala.
- No metas en cuentas que pueden estar en cartera del founder
  sin preguntar.
- No te conviertas en helpdesk del cliente tras cerrar.
- Un email frío por organización con razón específica. No spam.

Si llega un caso no contemplado aquí: **escribe al founder antes
de actuar**. Cuesta cero minutos y te ahorra problemas.
