# Imágenes de la landing de clubes (/es/clubes · /ca/clubs)

Imágenes reales (hero + carnet), optimizadas con `sharp`. La banda "escaparate
del equipo" y el desplegable de competiciones de la sección de fútbol femenino
son **mockups CSS** dentro del propio HTML (réplicas de `org.js` y `panel.html`),
no archivos — nítidos en cualquier pantalla y sin riesgo LOPD.

| Archivo | Dónde | Formato | Notas |
|---|---|---|---|
| `hero-celebracion.jpg` | Fondo del hero en `/es/clubes` | JPG 1024px, 156 KB | Celebración / equipo. Lleva scrim navy encima (58–82%). **IA o stock con derechos — NO niños reales identificables sin cesión.** Si falta, el hero usa degradado de marca (fallback CSS). Optimizado mozjpeg q82 desde PNG de 1,7 MB. |
| `hero-femeni.jpg` | Fondo del hero en `/ca/clubs` | JPG ~1024px, ≤180 KB | **Pendiente de generar.** Portada propia de la catalana: **niñas** jugando a fútbol. Mismas restricciones LOPD que el hero castellano. Mientras no exista, `/ca/clubs` cae sola a `hero-celebracion.jpg` y, si tampoco estuviera, al degradado de marca — no hay estado roto. Ver receta abajo. |
| `carnet-pvc.jpg` | Banda "Carnet PVC + NFC" | JPG 1264×846, 85 KB | Foto del carnet físico sobre superficie (club ficticio EFB Universal, IA). Llena el marco a sangre. Si falta, queda el degradado `--card`. Optimizado mozjpeg q84 desde PNG de 1,2 MB. |

Para reemplazar cualquiera: sube el archivo con el mismo nombre y, si es PNG
pesado, pásalo por `sharp`/squoosh/tinypng antes (es una landing pública).

## Cómo generar `hero-femeni.jpg`

Con `/lab-gemini.html` en producción (pide `ADMIN_PASSWORD`; usa Gemini 2.5
Flash Image). Prompt de partida:

> Fotografía documental de un equipo de fútbol base femenino celebrando en el
> campo al final de un partido. Niñas de 10 a 12 años con equipación deportiva
> genérica sin marcas ni escudos reconocibles, sonriendo y chocando las manos.
> Luz de tarde, césped natural, fondo desenfocado de campo municipal modesto.
> Encuadre horizontal amplio con espacio libre en el centro para superponer
> texto. Estilo natural, sin pose de estudio, sin texto en la imagen.

Después, antes de subirla:

1. Comprueba que **no hay caras de menores reales identificables** ni escudos
   de clubes existentes — la imagen es IA precisamente por eso.
2. Verifica que el centro aguanta el titular: encima lleva un scrim navy al
   58–82 %, así que las zonas claras del centro no deben competir con el texto.
3. Optimiza a JPG ~1024 px de ancho y ≤180 KB:
   `npx sharp-cli -i entrada.png -o hero-femeni.jpg resize 1024 -- jpeg --quality 82 --mozjpeg`
4. Súbela a esta carpeta. `/ca/clubs` la coge sin tocar CSS.
