# Imágenes de la landing de clubes (/es/clubes · /ca/clubs)

Solo **una** imagen real pendiente: el fondo del hero. El carnet PVC y la web
del club son **mockups CSS** dentro del propio HTML (réplica del producto que
generan `renderPlayerCard` y `org.js`), no archivos — nítidos en cualquier
pantalla y sin riesgo LOPD.

| Archivo | Dónde | Formato | Notas |
|---|---|---|---|
| `hero-celebracion.jpg` | Fondo del hero | JPG ~1024px, < 300 KB | Celebración / equipo. Lleva scrim oscuro encima: que tenga zonas no demasiado claras detrás del texto. **IA o stock con derechos — NO niños reales identificables sin cesión de imagen.** Mientras no exista, el hero usa un degradado de marca (fallback CSS). Optimizado con `sharp` (mozjpeg q82) desde el PNG original de 1,7 MB → 156 KB. |

Optimiza el peso (squoosh / tinypng) antes de subir: es una landing pública.
