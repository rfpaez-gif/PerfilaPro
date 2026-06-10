# Memo de autoría y prueba de anterioridad

**Documento de constancia de autoría — uso para depósito / sellado de tiempo.**
No es una publicación. Su finalidad es **fijar la fecha y la autoría** del concepto y de la
obra (documentos + código) descritos abajo, como medida de protección de la posición
(Fase 0 del `docs/carnet-ffrm-handoff.md`).

---

## 1 · Autor y titular

- **Autor y titular de los derechos:** «NOMBRE LEGAL COMPLETO» — «DNI/NIE» *(a rellenar por
  el founder)*.
- **Identificadores digitales verificables:** email `rfpaez@gmail.com`; cuenta GitHub
  `rfpaez-gif`; repositorio privado `rfpaez-gif/PerfilaPro`.
- **Asistencia técnica:** el desarrollo del código y la redacción de los documentos se
  realizó con la ayuda de un asistente de IA de programación (Claude Code). Por ese motivo
  los *commits* de git figuran con el committer `Claude <noreply@anthropic.com>`. **La
  concepción, la dirección estratégica y las decisiones de producto son del autor arriba
  identificado; el asistente operó como herramienta bajo su instrucción.** La titularidad
  intelectual y de explotación corresponde al autor/titular.

## 2 · Fecha

- **Fecha de este memo:** 2026-06-10.
- **Fechas con respaldo criptográfico (git, UTC):** ver §6. El contenido del concepto consta
  en el repositorio al menos desde **2026-06-10 11:37:32 +0000** (primer commit del
  documento de proyecto).

## 3 · Denominación (provisional)

Marca pendiente de elección y verificación (OEPM/EUIPO/dominios). Candidatos: programa
**«Arraigo»** + carnet **«Dorsal»**, o marca única **«Federia»** (ver §8-bis del handoff).
Mientras tanto, denominación de trabajo: **"Carnet FFRM · programa de identidad y protección
del deporte base"**.

## 4 · Descripción del concepto (objeto de la autoría)

Sistema y modelo de negocio para dotar a cada deportista de base de una **identidad deportiva
digital portable**, materializada en un **carnet físico PVC + NFC avalado por una federación
deportiva** (target inicial: Federación de Fútbol de la Región de Murcia, FFRM), con las
siguientes notas distintivas concebidas por el autor:

1. **Identidad portable del jugador entre clubes** como activo central (la card pertenece al
   jugador, no al club, y viaja con él; histórico federativo conservado).
2. **Carnet físico PVC + NFC** que da "cuerpo" a la licencia federativa (hoy un PDF digital
   intangible) y enlaza, vía NFC/QR, a la ficha digital del jugador.
3. **Motor económico por mecenazgo en la cara B del carnet**, con dos capas: patrocinador
   **local de club** y patrocinador **máster federativo**, y modelo de reparto
   federación/club/plataforma.
4. **Mecanismo de encaje** ("los dos botones"): la verificación de identidad / anti-fraude
   justifica que el carnet sea obligatorio y de distribución universal; esa distribución
   garantizada genera el valor publicitario que financia el programa.
5. **Encuadre "blanco"**: programa de **protección del menor (LOPIVI)**, hábitos saludables e
   inclusión, articulado como **mecenazgo** (no publicidad), apoyado en una **coalición
   público-privada** (administración deportiva autonómica + entidad mecenas) que hace inviable
   políticamente el rechazo de la federación.

La descripción completa, las decisiones-marco, las realidades verificadas, el análisis de
reutilización de código, el mapa de coalición y la hoja de ruta constan en el documento
`docs/carnet-ffrm-handoff.md` de este repositorio (parte integrante de este memo por
referencia).

## 5 · Estado de desarrollo y obra preexistente

A la fecha de este memo existe ya, en el repositorio del autor, una base de código
funcional reutilizable (vertical "Cantera"), que incluye, entre otros: generación del carnet
PVC+NFC (`buildPlayerCardPVC`), histórico portable entre clubes (`member_club_seasons`),
audit trail de consentimiento parental LOPDGDD (`card_consents`), y el soporte de
patrocinador en la cara B del carnet (`organizations.carnet_sponsor_url`,
`upload-carnet-sponsor-panel.js`, `renderPlayerCardBack`). Esta obra preexistente es del
autor/titular y forma parte del acervo cuya anterioridad se documenta.

## 6 · Prueba de anterioridad (evidencia verificable)

El historial de git es un **registro encadenado criptográficamente y datado** (cada commit
referencia el anterior por hash SHA-1; alterar un commit pasado invalida toda la cadena
posterior). Anclas de evidencia del documento de proyecto:

| Commit | Fecha (UTC) | Descripción |
|---|---|---|
| `6e17e83` | 2026-06-10 11:37:32 +0000 | Caja de migración + hoja de ruta del carnet FFRM (creación) |
| `2a56a86` | 2026-06-10 11:57:28 +0000 | Bootstrap + candidatos de marca |

- **Repositorio:** `rfpaez-gif/PerfilaPro`, rama `claude/greeting-5kgcks`.
- **Blob git del documento (`docs/carnet-ffrm-handoff.md`) en `2a56a86`:**
  `ca6e22e9f802c0df279bc4b823f323bd76443e24`.
- **SHA-256 del contenido de `docs/carnet-ffrm-handoff.md` a esta fecha:**
  `497883f16c18a467bbfde19ab11e26950910f53447d0628ba2c5ac7f31051769`.
- El propio acto de commitear este memo añadirá un commit datado adicional como evidencia.

## 7 · Naturaleza y alcance (qué protege y qué no)

- **Sí** establece la **autoría y la fecha** de la *expresión* concreta (los documentos y el
  código) y deja constancia de quién la concibió primero.
- **No** convierte por sí solo la *idea abstracta* en propiedad: las ideas no son protegibles
  como tales. La protección efectiva de la posición exige además **marca registrada**
  (OEPM/EUIPO), **dominios**, **contratos con cláusula de no-circunvención** y **secuencia de
  divulgación controlada** — todo ello planificado en la Fase 0 del handoff.

## 8 · Destino de este documento

Para fijar fecha cierta frente a terceros, depositar/sellar este memo por uno de estos
medios (a elección del autor, idealmente más de uno):

- Depósito en el **Registro de la Propiedad Intelectual**.
- **Sellado de tiempo** con prestador cualificado o servicio tipo *Safe Creative* / sellado
  en blockchain.
- Envío a uno mismo / a un tercero de confianza por medio con fecha fehaciente.

## 9 · Firma

Autor/titular: ____________________________  («NOMBRE LEGAL COMPLETO», «DNI/NIE»)

Lugar y fecha: __________________________, ____ / ____ / ________

Firma: ____________________________

---

> **Aviso:** este documento no es asesoramiento jurídico. Antes del depósito/registro y de
> las gestiones de marca y contratos, conviene revisarlo con un abogado de propiedad
> intelectual / mercantil (Fase 0).
