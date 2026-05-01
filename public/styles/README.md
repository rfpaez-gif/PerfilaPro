# PerfilaPro · Brand styles

Capa de marca compartida. Punto de entrada único:
`<link rel="stylesheet" href="/styles/brand.css">`.

```
public/styles/
├── tokens.css       Variables CSS (color, tipografía, espaciado,
│                    radios, sombras, transiciones, z-index).
├── base.css         Reset mínimo y estilos globales del body.
├── components.css   Componentes prefijados pp-* (BEM-light).
└── brand.css        Punto de entrada · @import de los anteriores.
```

## Paleta · dos registros

PerfilaPro usa DOS registros cromáticos coexistentes:

### Sistema general (defecto)

Variables `--pp-color-*` sin sufijo. Aplica a toda la UI web:
landing, admin, alta, editar, agente, perfil público, directorios.

| Token                       | Valor                  |
|-----------------------------|------------------------|
| `--pp-color-ink`            | `#0A1F44` (azul tinta) |
| `--pp-color-accent`         | `#00C277` (verde match)|
| `--pp-color-bg`             | `#F5F2EC` (crema)      |
| `--pp-color-surface`        | `#FFFFFF`              |

### Registro cálido

Variables `--pp-color-warm-*`. Uso EXCLUSIVO en:

1. Componentes con modificador `--warm` (ej. `pp-card--warm`,
   `pp-btn--warm`).
2. HTML de emails transaccionales (vía mapa `COLORS` de
   `netlify/functions/lib/email-layout.js`).
3. La tarjeta digital profesional renderizada por `card.js`
   (decisión Fase 1, paso 3).

| Token                       | Valor                     |
|-----------------------------|---------------------------|
| `--pp-color-warm-ink`       | `#1E1B14` (tinta cálida)  |
| `--pp-color-warm-accent`    | `#01696F` (verde petróleo)|
| `--pp-color-warm-bg`        | `#FAF3E6` (Piedra Cálida) |
| `--pp-color-warm-surface`   | `#FFFFFF`                 |

### Regla de oro

Texto sobre `warm-bg` usa `warm-ink`, NUNCA `ink`.
Acento sobre `warm-bg` usa `warm-accent`, NUNCA `accent`.
**Cruzar los registros rompe la marca.**

### Estados (compartidos)

| Token                  | Valor     |
|------------------------|-----------|
| `--pp-color-success`   | `#00A866` |
| `--pp-color-warning`   | `#B8860B` |
| `--pp-color-danger`    | `#B23A48` |

## Sincronización tokens.css ↔ email-layout.js

Cualquier cambio de paleta exige tocar AMBOS archivos en el
MISMO commit:

- `tokens.css` usa `var()` y `rgba()`.
- `lib/email-layout.js` (mapa `COLORS`) usa **hex literales
  sólidos**. Outlook clásico no renderiza `rgba()` de forma
  fiable: las equivalencias sólidas (`inkSoft`, `accentSoft`,
  `border`) están pre-calculadas sobre fondo Piedra Cálida
  `#FAF3E6` y NO deben sustituirse por `rgba()` aunque el
  render local lo tolere.

## Convenciones

- **Prefijo `pp-` obligatorio** en cualquier clase nueva.
  Las clases legacy (`btn-primary`, `card`, `badge`, etc.)
  no se tocan en Fase 0; conviven durante la migración
  gradual de Fase 1.
- **BEM-light**: `pp-card`, `pp-card__header`,
  `pp-card--featured`. Nunca `pp_card` ni `PpCard`.
- **Tokens semánticos antes que valores literales**.

## Variables legacy `--pp-c-*`

`tokens.css` mantiene las variables `--pp-c-*` antiguas mientras
`components.css` las referencie. Se retirarán cuando todas las
superficies se hayan migrado a `--pp-color-*` durante Fase 1.
**No introducir nuevos usos** de `--pp-c-*`.
