# PerfilaPro
Proyecto para profesionales

## Sistema de marca

A partir de Fase 0 del rebrand, todos los estilos compartidos
viven en `public/styles/`. La filosofía vanilla del repo se
mantiene: no hay build step, no hay framework, los archivos
se sirven tal cual.

### Estructura

```
public/styles/
├── tokens.css       Variables CSS (colores, tipografía,
│                    espaciado, radios, sombras, transiciones,
│                    z-index). v0.1 con paleta provisional.
├── base.css         Reset mínimo y estilos globales del body.
├── components.css   Componentes base prefijados pp-*.
└── brand.css        Punto de entrada único: importa los tres
                     anteriores con @import.
```

### Cómo enlazar desde un HTML estático o desde una función SSR

Un único `<link>`, siempre el mismo:

```html
<link rel="stylesheet" href="/styles/brand.css">
```

Nunca enlazar `tokens.css`, `base.css` o `components.css`
directamente desde un HTML — los `@import` los gestiona
`brand.css` para evitar waterfalls de carga y permitir que
Netlify cachee una sola URL.

### Convenciones

- **Prefijo `pp-` obligatorio** en cualquier clase nueva
  introducida por el rebrand. Las clases existentes del repo
  (`btn-primary`, `card`, `badge`, etc.) NO se tocan en Fase 0:
  conviven con las nuevas durante la migración gradual de
  Fase 1.
- **BEM-light dentro del prefijo**: `pp-card`, `pp-card__header`,
  `pp-card--featured`. Nunca `pp_card` ni `PpCard`.
- **Tokens semánticos antes que valores literales**: usar
  `var(--pp-c-accent)` para acciones y `var(--pp-c-primary)`
  para identidad. Cuando cambie la paleta definitiva (decisión
  CEO pendiente), basta con actualizar los hex en `tokens.css`.
- **Emails NO usan variables CSS** (los clientes de email no
  las soportan). El helper `lib/email-layout.js` mantiene un
  mapa interno de hex codes sincronizado manualmente con
  `tokens.css`.

### Cuándo NO usar el sistema

- En páginas que aún no se han migrado a Fase 1: si una página
  todavía tiene su `<style>` inline antiguo, no enlazar
  `brand.css` mezclado con clases viejas — esperar a su PR de
  migración.
- En emails transaccionales: ahí va `lib/email-layout.js`, no
  `brand.css`.

### Cómo extender

Componentes nuevos en `components.css` siguiendo las
convenciones BEM-light. Tokens nuevos solo en `tokens.css`,
nunca hardcodeados en componentes.
