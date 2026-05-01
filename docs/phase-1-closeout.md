# Fase 1 · Cierre formal

Cierre del rebrand visual de PerfilaPro. Sin cambios de feature, sin
cambios de modelo de negocio. Sólo consolidación de identidad
gráfica y arquitectura CSS sobre el código existente.

## a · Resumen ejecutivo

**Alcance ejecutado** — rebrand visual completo de todas las
superficies (web autenticada y pública, emails transaccionales,
tarjeta SSR `/c/:slug`, superficies de directorio SEO). Sin tocar
features ni monetización.

**Decisiones CEO cerradas en Fase 1**

- **6.1 Paleta** — A. Híbrido. Sistema general (`--pp-color-*`)
  para UI web autenticada, landing, formularios, admin, agente,
  legales, feedback, success. Registro cálido (`--pp-color-warm-*`)
  exclusivo para emails y tarjeta profesional `/c/:slug`.
- **6.2 Alcance Fase 1** — A. Rebrand visual sin tocar features.
- **6.3 Monetización** — statu quo. Base 9 € / Pro 19 € / Renovación
  5 €. Pago único en todos los planes.

**8 PRs mergeados (2026-05-01 → 2026-05-02)**

| # | Rama | Superficie |
|---|---|---|
| 21 | `claude/phase-1-landing-rebrand-QuaNw` | `index.html` |
| 22 | `claude/phase-1-step-2-emails` | 5 funciones de email + `lib/email-layout.js` |
| 23 | `claude/phase-1-card-js-U2vJJ` | `card.js` (SSR `/c/:slug`, registro cálido) |
| 24 | `claude/phase-1-step-4-dir-perfil` | `perfil-publico.js` + `dir-{sector,especialidad,ciudad}.js` + `lib/dir-utils.js` + `public/directorio/index.html` |
| 25 | `claude/phase-1-step-5-forms-mojNP` | `alta.html` + `editar.html` |
| 26 | `claude/phase-1-step-6-admin` | `admin.html` |
| 27 | `claude/phase-1-step-7-agente-Nmpkp` | `agente.html` + `agente-login.html` |
| 28 | `claude/phase-1-step-8-legal` | `legal.html` + `terminos.html` + `privacidad.html` + `feedback.html` + `success.html` + retirada legacy |

**Estado al cierre** — 264/264 tests verde, working tree limpio,
producción visualmente consistente.

**Arquitectura CSS consolidada**

- Punto único de entrada: `public/styles/brand.css`, que importa
  `tokens.css → base.css → components.css`.
- Tipografía unificada: Fraunces + Geist + Geist Mono.
- Convenciones vinculantes: prefijo `pp-*` en clases nuevas;
  estados JS `is-active / is-done / is-visible / is-selected /
  is-error / is-open / is-copied / is-hidden`; texto sobre
  `warm-bg` usa `warm-ink` (nunca `ink`); acento sobre `warm-bg`
  usa `warm-accent`.
- Componentes específicos de página = inline scoped por defecto.
  Subir a `components.css` sólo con 3+ callers confirmados.
- Hex hardcoded en SSR/emails se sincroniza con `tokens.css` en el
  **mismo commit** que los tokens (regla cross-archivo
  documentada en `email-layout.js`, `card.js`, `dir-utils.js`).

**Legacy retirado en PR #28**

- `public/assets/css/{base,components,tokens}.css` borrados.
- `public/assets/js/theme.js` borrado.
- `public/assets/test.html` borrado.
- `public/assets/icons/`, `favicon.svg`, `apple-touch-icon.png`,
  `og-default.png` se quedan: los referencian `render.js` y
  `admin.html`.

**Protocolo refrendado** — el checkpoint visual con CEO antes del
PR de `card.js` (#23) ocurrió y validó el cambio sobre superficie
sensible (pagantes activos en producción, tráfico SEO consolidado,
QRs físicos en circulación). Queda como protocolo replicable en
Fase 2 para superficies que cumplan al menos uno de esos
criterios — no se aplica a todas las superficies por defecto.

## b · Deuda técnica conocida

| Componente | Callers | Tipo | Lectura |
|---|---|---|---|
| `pp-stat` (+ `pp-stats`, `__label`, `__value`, `__sub`) | `admin.html` + `agente.html` | DEUDA REAL | Base idéntica byte-a-byte. Modificadores divergen por superficie (`--warning` y `--danger` en admin; `--primary` y `--success` en agente). Migración trivial cuando aparezca un 3er caller. |
| `pp-tbl-wrap` / `pp-tbl` (+ `th`, `td`, `tr:last-child`) | `admin.html` + `agente.html` | DEUDA REAL | Base idéntica. Modificadores scoped por superficie (`__name`, `__email`, `__card-link`, `__actions`, `__col-md`, `tr:hover td` en admin; `__strong`, `__link` en agente). Subir base, dejar modificadores scoped. |
| `pp-edit-card` (+ `__title`, `__sub`) | `editar.html` + `agente-login.html` | DECISIÓN DELIBERADA | Base casi idéntica salvo `max-width` (520 vs 400) y `text-align`. Comentario explícito en `agente-login.html` documenta el reuso confirmado y la regla 3+ callers para subir. |
| `pp-msg` (+ `--ok`, `--err`) | `editar.html` + `agente-login.html` | DECISIÓN DELIBERADA | Base casi idéntica. Divergencia notable: `agente-login.html` usa `display:none` + `.is-visible` (alineado con convención `is-*`); `editar.html` usa `style="display:none"` inline. Convergir al patrón limpio cuando se suba a `components.css`. |

**Resumen** — 4 candidatos. 2 deuda real, 2 decisión deliberada
documentada en código bajo regla 3+ callers. Cero acción inmediata.

## c · Decisiones diferidas explícitas

1. **Refactor `pp-stat` y `pp-tbl`** — subir base común a
   `components.css` cuando aparezca un 3er caller en Fase 2.
   Modificadores siguen scoped.

2. **Convergencia patrón visibility en `pp-msg`** — al promover el
   componente, alinear `editar.html` con el patrón `is-visible` que
   usa `agente-login.html`. Eliminar `style="display:none"` inline.

3. **Páginas estáticas en `sitemap-static.xml`** — el sub-sitemap
   creado para `/alta` está pensado para crecer. Si Fase 2 toca SEO,
   evaluar si `legal`, `terminos`, `privacidad`, `index` y
   `directorio` (raíz) deberían entrar como entradas estáticas
   adicionales — actualmente `directorio` está en
   `sitemap-categorias.xml` por convención y el resto no figura en
   ningún sitemap.

4. **Indexabilidad** — `meta robots` baseline cerrado:
   `alta.html` indexable, `admin.html` y `editar.html` con
   `noindex,nofollow`. El resto de páginas públicas no declara
   `meta robots` y permanece indexable de facto. Si Fase 2 quiere
   indexabilidad explícita, decidir en bloque.

## d · Lecciones del proceso

Cinco bullets honestos. Lectura de quien ejecutó los 8 PRs.

- **La regla "scoped por defecto, subir con 3+ callers" funcionó.**
  Evitó refactor prematuro y, en al menos un caso (`pp-edit-card`
  en `agente-login.html`), quedó documentada en el propio código
  con un comentario explícito. Eso convierte la deuda en
  inventario consultable, no en deuda olvidada. Replicar en Fase 2.

- **El invariante "hex hardcoded en SSR/emails sincronizado con
  `tokens.css` en el MISMO commit" fue clave.** Sin esa regla, las
  superficies SSR (card.js, emails, dir-utils.js) habrían driftado
  respecto al sistema de tokens. Mantener vinculante.

- **El checkpoint visual con CEO antes del PR de `card.js` valió
  la pena.** Superficie con pagantes activos, tráfico SEO
  consolidado y QRs físicos en circulación: el coste de un
  rollback hubiera sido alto. Replicable, pero sólo para
  superficies que cumplan ese tipo de criterios — no como
  default.

- **El handoff entre hilos perdió un dato verificable.** Afirmaba
  que `admin.html` llevaba `noindex,nofollow`; en realidad no
  llevaba `meta robots`. Lección: los handoffs futuros deberían
  describir convenciones y decisiones, pero estados concretos
  (qué archivo tiene qué meta, qué función expone qué endpoint)
  conviene verificarlos contra el código antes de tratarlos como
  hechos. Tiempo de verificación al inicio de hilo nuevo &lt; coste
  de propagar un dato erróneo.

- **Una rama por superficie funcionó mejor de lo esperado.**
  Permitió revisión incremental, rollback granular sin tocar el
  resto, y orden cronológico claro al cierre. La fricción
  esperada (más overhead de PRs) no se materializó porque cada
  PR era pequeño y revisable de un vistazo. Mantener en Fase 2.

**Lo que cambiaría** — la retirada de legacy se acumuló al último
PR (#28) por orden de dependencias. Funcionó, pero a futuro
preferiría retirar al final de **cada** PR lo que ese PR vuelve
inalcanzable, en lugar de acumular hasta el cierre. Reduce el
último PR de "PR final + limpieza grande" a sólo "PR final".
