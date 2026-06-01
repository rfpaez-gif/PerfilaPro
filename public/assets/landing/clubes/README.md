# Imágenes de la landing de clubes (/es/clubes · /ca/clubs)

Dos imágenes reales (hero + carnet), ambas optimizadas con `sharp`. La banda
"escaparate del equipo" es un **mockup CSS** dentro del propio HTML (réplica de
`org.js`), no un archivo — nítido en cualquier pantalla y sin riesgo LOPD.

| Archivo | Dónde | Formato | Notas |
|---|---|---|---|
| `hero-celebracion.jpg` | Fondo del hero | JPG 1024px, 156 KB | Celebración / equipo. Lleva scrim navy encima (58–82%). **IA o stock con derechos — NO niños reales identificables sin cesión.** Si falta, el hero usa degradado de marca (fallback CSS). Optimizado mozjpeg q82 desde PNG de 1,7 MB. |
| `carnet-pvc.jpg` | Banda "Carnet PVC + NFC" | JPG 1264×846, 85 KB | Foto del carnet físico sobre superficie (club ficticio EFB Universal, IA). Llena el marco a sangre. Si falta, queda el degradado `--card`. Optimizado mozjpeg q84 desde PNG de 1,2 MB. |

Para reemplazar cualquiera: sube el archivo con el mismo nombre y, si es PNG
pesado, pásalo por `sharp`/squoosh/tinypng antes (es una landing pública).
