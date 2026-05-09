# PerfilaPro · Brand Kit

> Kit de marca exportable para uso en documentos legales, impresión, vinilo de furgo, redes, merchandising y comunicación interna. Todos los assets están en `public/assets/brand/` y son **vectoriales (SVG con paths)** + raster en tres densidades.
>
> **Tagline maestro:** *Tu trabajo merece verse.*
> **Origen:** Hecho en Orihuela · Made in Spain.

---

## 1. Paleta de marca

| Token | Hex | Uso principal |
|---|---|---|
| **Tinta** | `#0A1F44` | Texto principal, fondos oscuros, "Perfila" del wordmark |
| **Verde Match** | `#00C277` | Color de marca, "Pro" del wordmark, CTAs, isotipo |
| **Verde dark** | `#00A865` | Hover/active del verde match |
| **Verde light** | `#E6F9F0` | Bloques destacados sutiles |
| **Crema** | `#FAF7F0` | Fondo principal de página |
| **Piedra** | `#F7F8FA` | Fondos secundarios, separadores |
| **Blanco** | `#FFFFFF` | Tarjetas, headers claros, texto sobre tinta/verde |
| **Coral** | `#E5484D` | Estados de error (no usar en marca) |

> **Sincronía técnica:** estos hex viven hardcodeados en `public/styles/tokens-color.css`, `netlify/functions/lib/email-layout.js` y `scripts/generate-brand-assets.js`. Cualquier cambio de paleta requiere editar los tres en el mismo commit.

---

## 2. Tipografía

| Familia | Pesos usados | Uso |
|---|---|---|
| **Source Serif 4** (Google Fonts) | `Semibold` (600) + `Semibold Italic` | Wordmark, isotipo, títulos, taglines |
| **Inter** (Google Fonts) | `Regular`, `SemiBold`, `Bold` | Cuerpo de texto, UI, formularios |

**TTFs locales** (subset auto-embebido en cada PDF generado):
- `netlify/functions/lib/fonts/SourceSerif4-Semibold.ttf`
- `netlify/functions/lib/fonts/SourceSerif4-SemiboldIt.ttf`
- `netlify/functions/lib/fonts/Inter-{Regular,SemiBold,Bold}.ttf`

---

## 3. Wordmark `PerfilaPro`

### Construcción
- Tipografía: **Source Serif 4 SemiBold (600)**
- "Perfila" en romana, "Pro" en italic, sin espacio entre ambas palabras
- Letter-spacing: `-0.02em` (en CSS); en los SVG generados el kerning está aplicado por glifo
- Letter-shaping: cada glifo está **convertido a paths** — los SVGs no dependen de que la fuente esté instalada en el destino

### Variantes disponibles

| Archivo SVG | Caso de uso | Fondo recomendado |
|---|---|---|
| `wordmark-default` | **Uso por defecto** · documentos, factura, deck, web | Crema, blanco, piedra |
| `wordmark-on-tinta` | Header oscuro, sobres, páginas internas oscuras | Tinta `#0A1F44` |
| `wordmark-on-verde` | Banderines, hero verde, comunicaciones de marca | Verde Match `#00C277` |
| `wordmark-mono-tinta` | **Impresión B/N**, fotocopia, fax, grabado láser | Cualquier fondo claro |
| `wordmark-mono-blanco` | Merchandising oscuro, vinilo en superficie negra | Tinta o cualquier oscuro |
| `wordmark-mono-verde` | Merchandising vibrante, sello verde | Cualquier fondo claro |

### Escalas recomendadas (raster)

Cada variante existe en `@1x`, `@2x` y `@3x`. Las dimensiones base son **480 px de ancho** (wordmark estándar):

| Densidad | Ancho píxel | Uso típico |
|---|---|---|
| `@1x` | 480 px | Email firma, Slack, miniaturas |
| `@2x` | 960 px | Presentaciones HD, web retina, redes sociales |
| `@3x` | 1440 px | Posters digitales, cabeceras de prensa |

> **Para impresión grande** (más de A4) **usa siempre el SVG**, no el PNG. El SVG escala infinitamente sin pérdida.

### Espacio de seguridad

El wordmark trae **clearance integrado** equivalente a la mitad de su altura tipográfica (≈ x-height) en cada lado. **Nunca** se añade texto, iconos ni bordes dentro de ese margen.

```
┌─────────────────────────────────┐
│ ▒▒▒▒ clearance ▒▒▒▒              │
│ ▒▒  PerfilaPro             ▒▒    │
│ ▒▒▒▒                ▒▒▒▒        │
└─────────────────────────────────┘
```

### Tamaño mínimo legible

- **Pantalla:** 14 px de alto del wordmark — por debajo, usar el isotipo.
- **Impresión:** 8 mm de alto del wordmark — por debajo, usar el isotipo.

---

## 4. Isotipo (la `P`)

### Construcción
- "P" italic en Source Serif 4 SemiBold Italic, **misma "P" del wordmark "Pro"** — no es un símbolo arbitrario
- Cuadrado redondeado: lado completo, radio = 22 % del lado
- Centrado óptico: ajuste +2 % vertical hacia abajo para compensar la inclinación visual de la italica

### Variantes

| Archivo SVG | Cuadrado | "P" | Caso de uso |
|---|---|---|---|
| `isotype-tinta` | Tinta `#0A1F44` | Verde `#00C277` | **Default** · favicon, sello QR, watermark |
| `isotype-verde` | Verde `#00C277` | Blanco | App icon redes (Instagram, LinkedIn, X) |
| `isotype-white` | Blanco | Tinta `#0A1F44` | Watermark sobre fondo claro (añadir borde 1 px tinta si va sobre crema) |

### Tamaños canónicos

| Tamaño | Uso |
|---|---|
| 16 px | Mínimo absoluto · favicon legacy |
| 32 px | Favicon estándar |
| 48 px | Sello sobre QR |
| 64 px | Avatar redes sociales |
| 128 px | App icon (iOS/Android) |
| 256 px | App icon retina, perfiles destacados |
| 512+ px | Splash screens, iconos de tienda |

PNGs generados: `@1x` 256 px, `@2x` 512 px, `@3x` 768 px.

---

## 5. Lockup con tagline

`lockup-default.svg` — wordmark grande + *"Tu trabajo merece verse."* en italic centrado debajo.

**Cuándo usarlo:**
- Hero de landing
- Portada de deck / propuesta comercial
- Cabecera de factura
- Asset descargable / firma de email institucional
- Cierre de vídeo / cortinilla

**Cuándo NO usarlo:**
- Espacios estrechos (header, navbar) — usa el wordmark solo
- Cuando el tagline ya aparece en otro sitio cerca (no duplicar)
- Sobre fondos cargados de imágenes (compite visualmente)

PNGs generados: `@1x` 600 px, `@2x` 1200 px, `@3x` 1800 px.

---

## 6. Aplicaciones por canal

| Canal / soporte | Asset recomendado | Formato |
|---|---|---|
| **Documentos legales (Word/Google Docs/PDF)** | `wordmark-default` o `wordmark-mono-tinta` para B/N | SVG (insertar como imagen) o PNG @2x |
| **Factura PDF** | Ya integrado vía `lib/pdf-fonts.js` (renderizado in-place con la fuente embebida); para overrides usa `lockup-default` | — |
| **Vinilo de furgo** | `wordmark-default` o `wordmark-on-tinta` (según color de furgo) | **SVG obligatorio** |
| **Cartelería gran formato** | `lockup-default` o `wordmark-default` | **SVG obligatorio** |
| **Tarjeta de visita física** | `wordmark-default` (anverso) + `isotype-tinta` (reverso, al 30 % opacidad como watermark) | SVG/PDF |
| **Email signature** | `wordmark-default@2x.png` (480 px) | PNG |
| **Slack / WhatsApp / mensajería** | `isotype-tinta@2x.png` o `wordmark-default@2x.png` | PNG |
| **Avatar Instagram / LinkedIn / X** | `isotype-verde@2x.png` (512 px, recortado en círculo automáticamente) | PNG |
| **Favicon web** | Ya configurado: `public/assets/favicon.svg` | SVG |
| **Apple Touch Icon** | Ya configurado: `public/assets/apple-touch-icon.png` | PNG |
| **Open Graph (compartir en redes)** | Ya configurado: `public/assets/og-default.png` | PNG |
| **Merchandising claro (taza, bolsa cruda)** | `wordmark-mono-tinta` o `wordmark-mono-verde` | SVG/PDF a imprenta |
| **Merchandising oscuro (camiseta negra, gorra tinta)** | `wordmark-mono-blanco` o `wordmark-on-tinta` (con caja tinta) | SVG/PDF a imprenta |
| **Sello en QR de la tarjeta** | `isotype-tinta` a 48 px | SVG |
| **Press kit / dossier prensa** | `lockup-default` + las 4 variantes principales del wordmark | Carpeta SVG + PNG |
| **Watermark documental** | `isotype-white` al 8 % opacidad | SVG |

---

## 7. Usos prohibidos

| Regla | Por qué importa |
|---|---|
| **No deformar ni inclinar** el wordmark más allá del italic propio del "Pro" | Rompe el rigor tipográfico de Source Serif 4 |
| **No usar otros colores** que los de la paleta | La marca se reconoce por el contraste tinta/verde — cualquier otro color rompe la asociación |
| **No añadir sombras, gradientes o brillos** | El logo es plano y serif; los efectos lo ensucian |
| **No cambiar la tipografía** ni a sans, ni a otra serif | La elección de Source Serif 4 es identidad |
| **No alterar el peso** (Light, Bold extra, etc.) — solo SemiBold (600) | El peso correcto es el que da el "carácter editorial" del logo |
| **No invertir el tratamiento** ("Perfila" italic verde + "Pro" tinta romano) | Rompe la jerarquía pensada |
| **No rellenar el clearance** con texto ni iconos | El aire alrededor es parte del logo |
| **No estirar horizontal o verticalmente** | Source Serif 4 ya tiene proporciones exactas |
| **No rotar** salvo en watermarks específicos a -20° tipo "DRAFT" | Confunde lectura |
| **No combinar con otros logos sin separación clara** | Pierde identidad |

---

## 8. Inventario completo de archivos

Todo en `public/assets/brand/`:

### SVG (10 archivos · vectorial · imprenta-proof)

```
svg/
  perfilapro-wordmark-default.svg       (6,5 KB)
  perfilapro-wordmark-on-tinta.svg      (6,6 KB)
  perfilapro-wordmark-on-verde.svg      (6,6 KB)
  perfilapro-wordmark-mono-tinta.svg    (6,5 KB)
  perfilapro-wordmark-mono-blanco.svg   (6,6 KB)
  perfilapro-wordmark-mono-verde.svg    (6,5 KB)
  perfilapro-isotype-tinta.svg          (1,0 KB)
  perfilapro-isotype-verde.svg          (1,0 KB)
  perfilapro-isotype-white.svg          (1,0 KB)
  perfilapro-lockup-default.svg         (22 KB)
```

### PNG (30 archivos · raster · digital)

Cada SVG tiene tres densidades. Los nombres siguen el patrón `<asset>@{1,2,3}x.png`:

- 6 wordmarks × 3 densidades = 18 PNGs (480 / 960 / 1440 px ancho)
- 3 isotipos × 3 densidades = 9 PNGs (256 / 512 / 768 px lado)
- 1 lockup × 3 densidades = 3 PNGs (600 / 1200 / 1800 px ancho)

Total: **40 archivos · ~620 KB**.

---

## 9. Regenerar el kit

Si la paleta cambia, si añades una variante o si actualizas la fuente:

```bash
node scripts/generate-brand-assets.js
```

El script:
1. Carga `SourceSerif4-Semibold.ttf` y `SourceSerif4-SemiboldIt.ttf` con `opentype.js`.
2. Renderiza cada glifo en (0, 0) y lo posiciona vía `transform="translate(...)"` en SVG (el render combinado de opentype tiene un bug de NaN con offsets decimales largos — el workaround está documentado en el script).
3. Aplica kerning manual entre glifos consecutivos.
4. Compone los SVGs con padding = x-height por lado.
5. Rasteriza cada SVG a PNG @1x/@2x/@3x con `@resvg/resvg-js`.
6. Verifica que ningún SVG contiene `NaN` antes de escribir.

---

## 10. Para imprenta profesional (vinilo, lona, gran formato)

Si la imprenta pide formato adicional al SVG:

- **PDF vectorial** → abre el SVG en Illustrator/Inkscape/Affinity Designer y exporta como PDF/X-1a.
- **EPS** → Illustrator → Save As → EPS Level 3.
- **Pantone equivalencias aproximadas** (validar contra muestrario físico de la imprenta):
  - Tinta `#0A1F44` ≈ Pantone **2766 C** o **289 C**
  - Verde Match `#00C277` ≈ Pantone **354 C** o **7481 C**
- **CMYK aproximado** (para offset, validar prueba de color):
  - Tinta `#0A1F44` ≈ C100 M85 Y30 K50
  - Verde Match `#00C277` ≈ C75 M0 Y75 K0

> Las equivalencias Pantone/CMYK son orientativas — siempre validar con prueba física antes de tirada grande.

---

## 11. Checklist antes de entregar a un proveedor

- [ ] He elegido la **variante correcta** según el fondo (default / on-tinta / on-verde / mono-*).
- [ ] He elegido el **formato correcto** (SVG para vector / impresión, PNG para digital).
- [ ] El proveedor entiende que el wordmark **no debe modificarse** — pasarle este `BRAND_GUIDE.md`.
- [ ] He confirmado el **tamaño mínimo** (≥ 14 px / ≥ 8 mm).
- [ ] Hay **clearance suficiente** alrededor (no pega a otros elementos).
- [ ] Para impresión: **prueba de color** validada antes de tirada.
- [ ] Para vinilo: archivo en **escala real** (no escalar después en imprenta).

---

*Última regeneración del kit: ver `git log -- public/assets/brand/`. Cualquier duda sobre uso o nuevas variantes, abrir issue en el repo.*
