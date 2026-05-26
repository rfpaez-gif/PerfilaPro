# Guion de demo · 5 minutos en el B2B Studio

> Guion operativo para enseñar PerfilaPro en directo a un prospect B2B
> durante una videollamada. Diseñado para 5 minutos de demo neta + 2 min
> de marco + 3 min de cierre = bloque de 10 min dentro de una llamada
> comercial de 15-20 min.
>
> Audiencia: founder o agente comercial. Lectura en paralelo a la
> llamada con Studio abierto en otra pestaña.

---

## Antes de la llamada (3 minutos)

### Checklist

- [ ] **Studio abierto** en `https://perfilapro.es/admin-orgs.html`, sesión iniciada (password + TOTP), pestaña separada para compartir solo eso.
- [ ] **Logo del prospect** descargado al escritorio. Si no encuentras versión limpia: captura de la web a 2x y recórtalo en Vista Previa. PNG con fondo transparente ideal; JPG también vale.
- [ ] **Color de marca** identificado (HEX). Inspeccionar la web del prospect con DevTools si hace falta. Si no hay marca clara: `#0A1F44` (verde institucional) como fallback.
- [ ] **Slug pre-pensado**: nombre corto, sin tildes ni ñ. Ej. `acme-legal`, `clinica-roma`, `colegio-arq-bcn`. Apuntalo en una nota — escribir slugs en directo es donde se atascan los nervios.
- [ ] **Org de respaldo** ya montada por si Studio falla. Recomendado: una org tipo `acmedemo` con 3 miembros, logo y color. Si algo se rompe, abres `/e/acmedemo` directamente y sigues sin que se note.
- [ ] **Compartir pantalla** preparado: pestaña Studio + pestaña en blanco para `/e/:slug`.

### Qualifying en los 2 min previos

Antes de demarrar la demo, confirma 3 cosas con el prospect:

1. **Cuántos profesionales** tienen / quieren incluir. Determina el tier (Equipo 5-30 / Organización 30-100 / Enterprise 100+).
2. **Qué quieren resolver**: imagen homogénea, retención de marca, directorio público, tarjeta digital para feria, otro.
3. **Decisor o influyente**: si no es el decisor, ajusta cierre para que se lleve material en lugar de pedir compromiso.

> Si responden las tres con vaguedad, **no hagas la demo**. Pide datos y agenda una segunda llamada. La demo se quema solo se enseña dos veces; no la gastes con quien no sabe lo que quiere.

---

## Durante la demo (5 minutos)

### 0:00 - 0:30 · Marco

**Lo que dices:**
> "Voy a montar contigo una organización con vuestra marca en directo
> para que veáis cómo queda. No es una maqueta — al final de los 5
> minutos esto que estamos creando es una URL pública real, indexable y
> compartible. Si os encaja, mañana mismo está en producción."

**Lo que haces:**
- Comparte pestaña Studio.
- Tienes la lista de orgs visible. Click en "Crear nueva organización".

**Por qué este marco**: separa la demo de cualquier prototipo o slide deck. El prospect ve software vivo, no un mockup.

### 0:30 - 1:30 · Crear la organización

**Lo que haces:**

1. **Nombre**: escribes el nombre real del prospect ("Despacho Martínez & Asociados").
2. **Slug**: el que pre-pensaste ("despacho-martinez"). Comenta en voz alta: *"esto será perfilapro.es/e/despacho-martinez, la URL pública que compartiríais con clientes"*.
3. **Logo**: drag-and-drop desde el escritorio. Espera el upload silenciosamente (~2 seg) — **NO hables durante el upload**. Deja que vean la magia.
4. **Color**: pegas el HEX en el picker. El preview lateral se actualiza al instante.

**Lo que dices mientras:**
> "Logo, color, tagline opcional, y descripción si queréis. Tres campos.
> No hay maquetador, no hay CMS, no hay plantillas que elegir. Si vuestro
> color cambia el año que viene, lo cambiáis aquí en 5 segundos y se
> propaga a todas las tarjetas de los miembros."

**Variantes según sector** (cambia 1 frase del pitch):

| Sector | Frase clave |
|---|---|
| Despacho / consultora | "Para que todos los socios y asociados se vean homogéneos, da igual quien os contacte." |
| Empresa con red comercial | "Cuando alguien se va de la empresa, su tarjeta se desactiva en un clic — el contacto se queda en casa." |
| Colegio profesional | "Tu directorio público de colegiados, bajo tu marca, sin desarrollo a medida." |
| Sector público / ONG | "Identidad institucional sin pasar por un proyecto de CMS de 4 meses." |

### 1:30 - 2:00 · Resultado público

**Lo que haces:**
- Click en "Ver pública ↗" o copias la URL `/e/despacho-martinez` y la abres en la pestaña en blanco que tenías lista.
- La página se carga con el hero del color del prospect, su logo y su nombre.

**Lo que dices:**
> "Esto es lo que ve un cliente vuestro que recibe el link. Indexable
> en Google, compartible en WhatsApp, con vista móvil pulida. Aún no
> hay profesionales dentro — vamos a meter uno."

### 2:00 - 3:15 · Invitar al primer miembro

**Lo que haces:**
- Vuelves a Studio.
- Click en "Invitar miembros".
- Añades 1 fila: nombre real (el del propio prospect si está dispuesto, o "Juan García" si no), su email, cargo ("Socio fundador").
- Click en "Enviar invitaciones".

**Lo que dices:**
> "Esta persona acaba de recibir un email con un magic-link. No tiene
> que registrarse, no tiene que recordar una contraseña. Hace click,
> sube su foto, ajusta su WhatsApp si quiere, y queda activo en el
> directorio. 3 minutos por persona. Y os adjunto su tarjeta de visita
> física ya con vuestra marca."

**Si el prospect te dio un email real**: abre Resend o tu Gmail compartido para enseñar el email entrando en tiempo real (impacta). Si no, sigue.

### 3:15 - 4:00 · Tarjeta de visita PDF

**Lo que haces:**
- En la lista de miembros, click en el icono 🪪 de la fila recién creada.
- Se descarga `tarjeta-juan-garcia.pdf`.
- Lo abres en Vista Previa.

**Lo que dices:**
> "85 por 55 milímetros, formato ISO de tarjeta de visita. Sale así
> directo a cualquier imprenta digital — Onlineprinters, Vistaprint,
> la imprenta del barrio. El QR de atrás abre el perfil digital. Lo
> mismo en booklet único para todo el equipo si tenéis 40 personas y
> queréis llevarlas a una feria."

### 4:00 - 4:45 · Perfil digital del miembro

**Lo que haces:**
- En la fila del miembro, abres `/c/juan-garcia` (link "Ver perfil").
- Muestras la página: foto (placeholder por ahora), nombre, cargo, WhatsApp con botón directo, QR.
- Apuntas a la franja superior del color del prospect: "Esa franja se aplica sola desde la marca que pusimos arriba".

**Lo que dices:**
> "Cuando Juan acabe de personalizar su perfil — foto, lista de
> servicios, descripción — esto es lo que ven sus clientes al
> escanear el QR de la tarjeta o pinchar en el link de su firma de
> email. Mismo color, mismo logo, misma identidad. Cero variación
> entre profesionales."

### 4:45 - 5:00 · Cierre técnico de la demo

**Lo que dices:**
> "Esto que acabamos de hacer en 5 minutos es lo mismo que harías el
> primer día con tu equipo. Subes los emails de tus profesionales en
> CSV o uno a uno, ellos reciben el magic-link, y en 24-48h tienes
> el directorio completo activo."

---

## Después de la demo (3 minutos · cierre)

### Las tres preguntas que debes hacer

1. **"¿Qué te ha llamado más la atención?"**
   - Te da la palanca real. Apunta literal lo que diga; será el copy del primer email de seguimiento.

2. **"¿Qué falta para que esto sea sí?"**
   - Mejor pregunta que "¿qué te parece?". Fuerza al prospect a verbalizar el bloqueo (precio, decisor, plazo, integración con X).

3. **"¿Cuándo es el siguiente paso?"**
   - No "¿te gusta?". Pasa directo a calendario.

### Materiales de salida (mandar en los 30 min posteriores)

| Material | A quién | Cuándo |
|---|---|---|
| One-pager B2B (PDF) | Siempre | Mismo día, max +2h |
| Link a la org de demo que acabamos de crear (`/e/...`) | Siempre | Mismo día |
| Propuesta económica concreta con tier y precio total | Si pidieron presupuesto | +24h |
| Plantilla de email de invitación al equipo | Si avanzan a piloto | Tras confirmar |

### Limpieza (al colgar)

- Si la org creada en directo no avanza: **bórrala** desde Studio en 7 días si no contestan. Tarjetas demo huérfanas acumulan ruido.
- Si avanza a piloto: renómbrala, asigna el agente correspondiente vía `agent_code`, configura email de la org para que reciba el magic-link al panel cliente.

---

## Backup plan · qué hacer si algo falla

| Falla | Plan B |
|---|---|
| Studio no carga / 500 | Compartes `/e/acmedemo` (la org de respaldo) y haces la demo "narrada" sin crear nada en directo. |
| Logo no sube (>2 MB o formato raro) | Pasa al siguiente paso; di "*el upload de logo lo hacemos luego, va igual con uno por defecto*". El color y el slug ya impactan. |
| El prospect no entiende qué es `/e/:slug` | Cambia de tab y enseña 2 ejemplos reales del directorio (cuidadoras, comercializadora eléctrica). |
| Te quedas en blanco a media demo | Pausa: *"Permíteme un segundo, abro la siguiente vista"*. No improvises features. |

---

## Lo que NO debes hacer

- **No enseñar el admin panel** (`admin.html`). Confuso, lleno de campos internos que el prospect no entiende y le hacen pensar "esto es complicado".
- **No mencionar Verifactu / AEAT** salvo que pregunten directamente por facturación legal. Si preguntan, respuesta honesta: *"Lo enchufamos vía Quipu cuando estéis listos para operación 100% comercial — hoy somos fase piloto"*.
- **No prometer features que no existen** ("integración con HubSpot", "API REST", "SSO con Google Workspace"). Si insisten, di *"no está hoy, pero si firmamos piloto evaluamos para roadmap del trimestre"*.
- **No bajar precio en la propia demo**. Si protestan, di *"el precio lo cerramos por escrito tras esta llamada, dame 24h"*. Da tiempo para pensar la propuesta sin descuento por reflejo.
- **No hablar de competencia salvo que ellos la mencionen**. Si la mencionan, una sola frase: *"Sí, [competidor] existe. La diferencia es [diferenciador concreto]. ¿Lo habéis probado?"*.

---

## Métricas que importa registrar tras cada demo

Apunta en `05 · Pilotos / Leads B2B / [nombre-prospect].md`:

- Fecha + duración real de la llamada
- Tier mencionado y tamaño de equipo declarado
- Respuesta literal a las 3 preguntas de cierre
- Siguiente paso comprometido y fecha
- Materiales enviados

> Tras 10 demos, mira el ratio demo→piloto y demo→silencio.
> Si demo→silencio > 70%: el problema es el qualifying, no la demo.
