# PerfilaPro — Brief para ilustrador

**Componente:** banner "Mundo físico" en `/editar`
**Entregables:** 2 ilustraciones (`local`, `tarjeta`) en la misma serie visual que la `furgoneta` ya existente.
**Plazo:** antes del merge de la rama `claude/close-picker-landing-MxxGV`.

---

## 1 · Lo que hay en esta carpeta

| Archivo | Propósito |
|---|---|
| `README.md` | Este brief (contexto + restricciones + entrega) |
| `local.svg` | Wireframe del vector `local` con el hueco QR clavado en sus coordenadas exactas |
| `tarjeta.svg` | Wireframe del vector `tarjeta` con el hueco QR clavado |
| (referencia) | `public/images/furgoneta-960.png` — el vector que ya existe, usar como guía de estilo |

Los SVG son **wireframes geométricos**, no arte final. El ilustrador los abre, traza encima manteniendo las coordenadas del rectángulo discontinuo y entrega el arte vectorial finalizado.

---

## 2 · Estilo de la serie (no negociable)

- **Vector flat**, líneas finas oscuras (`#0A1F44`), sin sombreados foto-realistas, sin texturas.
- **Fondo blanco puro** (`#FFFFFF`) en `local`; fondo crema `#FAF7F0` en `tarjeta`.
- **Sin personas, sin caras, sin manos identificables**. Tiene que servir para hombre/mujer, joven/mayor, cualquier sector.
- **Sin texto añadido** salvo el wordmark `PerfilaPro` en verde-match y el copy `Escanea para abrir este perfil`.
- **Sin elementos típicos de un solo gremio**. El "local" no puede leerse como peluquería ni comercio en exclusiva; tiene que valer para los 6 sectores que cubre.

---

## 3 · Paleta de marca (hex codes exactos)

| Token | Hex | Uso |
|---|---|---|
| verde-match | `#00C277` | Panel del QR, wordmark, copy, marco discontinuo |
| verde-dark | `#00A865` | Sombras puntuales del verde |
| tinta | `#0A1F44` | Líneas de contorno, detalles oscuros |
| blanco | `#FFFFFF` | Fondo lienzo `local`, cuerpo de la tarjeta |
| gris-200 | `#E5E7EB` | Sombras frías, reflejos de cristal |
| crema | `#FAF7F0` | Fondo lienzo `tarjeta`, reflejos cálidos del interior |
| piedra | `#F7F8FA` | Reflejos fríos del cristal |

---

## 4 · CONSTRAINT GEOMÉTRICO (lo más crítico)

Los 3 vectores de la serie comparten un hueco QR en las **mismas coordenadas relativas**. El QR del usuario se renderiza encima por CSS — la ilustración solo necesita reservar ese espacio con un rectángulo discontinuo.

### Lienzo de trabajo: 1920 × 960 px

| Elemento | Posición | Tamaño |
|---|---|---|
| Hueco QR (esq. sup. izq.) | `x = 821.76 px` (42.8%) · `y = 223.68 px` (23.3%) | `232.32 × 232.32 px` |

### Equivalente para el lienzo de display (960 × 480)

| Elemento | Posición | Tamaño |
|---|---|---|
| Hueco QR | `x = 410.88 px` · `y = 111.84 px` | `116.16 × 116.16 px` |

### Cómo dibujar el hueco

- Rectángulo discontinuo (dashed stroke), color `#00C277`, grosor ~6 px en 1920×960 (≈3 px en 960×480), dash-array `16 8`.
- El rectángulo permanece en el arte final: actúa como marco visual del QR del usuario.
- Si el rectángulo se desplaza aunque sea 5 px, el QR sale desencajado.

---

## 5 · Direcciones de arte específicas

### `local` — el del cristal

Cristal de un local visto desde fuera, con un cartel A4/A5 pegado por dentro donde va el QR.

- Marco del escaparate: dintel + rótulo verde-match plano sin texto + cristal grande + zócalo.
- Reflejos del cristal en gris-200 / crema, gradiente diagonal muy suave.
- **Sin pista de oficio detrás del cristal**: nada de tijeras, herramientas, tazas, ropa. El interior es un degradado cálido con siluetas geométricas indefinidas.
- Wordmark **PerfilaPro** abajo en el zócalo o sobre la base.

**Test mental:** ¿este local podría ser una peluquería, una tienda de ropa, un taller mecánico, una clínica de fisioterapia, un gimnasio y una cafetería? Si alguno chirría, des-tipificar más.

### `tarjeta` — el del papel

Tarjeta de visita rectangular, **flat, sin perspectiva** (la perspectiva rompe la calibración del overlay).

- Tarjeta blanca con fina banda verde-match arriba, esquinas suavemente redondeadas.
- Hueco QR ocupa la zona izquierda; copy "Escanea para abrir este perfil" a la derecha.
- **Sin mano sosteniéndola** (introduce edad / género / etnia). La tarjeta apoyada o flotando con sombra suave debajo.
- Wordmark **PerfilaPro** dentro de la tarjeta, debajo del QR o flotando bajo la tarjeta.

**Test mental:** ¿esta tarjeta vale igual para cuidador de mayores, abogada, fotógrafo, desarrollador y profesora particular? Si chirría hacia "comercial corporativo", suavizar.

---

## 6 · Entregables

Para cada vector (`local`, `tarjeta`):

| Archivo | Resolución | Formato | Notas |
|---|---|---|---|
| `local-960.png` | 960 × 480 | PNG-24 | Fondo opaco, no transparente |
| `local-960.webp` | 960 × 480 | WebP calidad 85+ | |
| `tarjeta-960.png` | 960 × 480 | PNG-24 | |
| `tarjeta-960.webp` | 960 × 480 | WebP calidad 85+ | |
| Fuente editable | 1920 × 960 nativo | AI / SVG / Figma | Para retoques sin pérdida |

**Tamaño objetivo:** PNG ≤ 30 KB, WebP ≤ 35 KB (la furgoneta actual: 25 / 29 KB).
**Naming literal:** los nombres de la tabla. Si cambian, hay que tocar código.
**Destino en repo:** `public/images/`.

---

## 7 · Validación visual

Una vez los archivos estén en `/public/images/`, validar en navegador:

```
https://perfilapro.es/editar?preview=free&vector=local
https://perfilapro.es/editar?preview=free&vector=tarjeta
https://perfilapro.es/editar?preview=free&vector=van     (referencia)
```

El QR del usuario aparece overlayed en tiempo real. Si no encaja en el rectángulo discontinuo, las coordenadas están mal.

---

## 8 · Checklist final

- [ ] Lienzo 960×480 (display) + fuente 1920×960 entregados.
- [ ] Hueco QR (rectángulo discontinuo verde-match) en `x=821.76 / y=223.68 / 232.32×232.32` (lienzo 1920×960). **Medido, no estimado**.
- [ ] Sin caras, sin manos, sin texto identificativo.
- [ ] Paleta limitada a los hex codes de §3.
- [ ] PNG con fondo opaco.
- [ ] PNG ≤ 30 KB, WebP ≤ 35 KB.
- [ ] Naming literal: `local-960.{png,webp}` y `tarjeta-960.{png,webp}`.
- [ ] Test de ambigüedad pasado: `local` vale para los 6 sectores; `tarjeta` para los 10 que cubre.
