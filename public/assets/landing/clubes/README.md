# Imágenes de la landing de clubes (/es/clubes · /ca/clubs)

Imágenes reales (hero + carnet), optimizadas con `sharp`. La banda "escaparate
del equipo" y el desplegable de competiciones de la sección de fútbol femenino
son **mockups CSS** dentro del propio HTML (réplicas de `org.js` y `panel.html`),
no archivos — nítidos en cualquier pantalla y sin riesgo LOPD.

| Archivo | Dónde | Formato | Notas |
|---|---|---|---|
| `hero-celebracion.jpg` | Fondo del hero en `/es/clubes` | JPG 1024px, 156 KB | Celebración / equipo. Lleva scrim navy encima (58–82%). **IA o stock con derechos — NO niños reales identificables sin cesión.** Si falta, el hero usa degradado de marca (fallback CSS). Optimizado mozjpeg q82 desde PNG de 1,7 MB. |
| `hero-femeni.jpg` | Fondo del hero en `/ca/clubs` | JPG 1170×627, 155 KB | Equipo femenino de base celebrando con copa (IA, Gemini). Portada propia de la catalana. Verificada en escritorio y móvil: el titular se lee sobre el cielo claro y la piña central sobrevive al recorte de `cover` en pantalla estrecha. Si falta, `/ca/clubs` cae sola a `hero-celebracion.jpg` y, si tampoco estuviera, al degradado de marca — no hay estado roto. Receta de regeneración abajo. |
| `carnet-pvc.jpg` | Banda "Carnet PVC + NFC" | JPG 1264×846, 85 KB | Foto del carnet físico sobre superficie (club ficticio EFB Universal, IA). Llena el marco a sangre. Si falta, queda el degradado `--card`. Optimizado mozjpeg q84 desde PNG de 1,2 MB. |

Para reemplazar cualquiera: sube el archivo con el mismo nombre y, si es PNG
pesado, pásalo por `sharp`/squoosh/tinypng antes (es una landing pública).

## Cómo regenerar `hero-femeni.jpg`

Con `/lab-gemini.html` en producción (pide `ADMIN_PASSWORD`; usa Gemini 2.5
Flash Image). Ojo: el lab manda **solo texto**, sin parámetro de relación de
aspecto, así que el formato apaisado hay que pedirlo dentro del prompt y aun
así puede salir cuadrado — si pasa, recorta a 16:9 dejando el grupo centrado
(centrado, no descentrado: en móvil el hero recorta por los lados y una
composición lateral pierde a las jugadoras). Prompt que produjo la actual:

> Fotografía documental horizontal, formato panorámico 16:9 (ancho, NO
> cuadrado), de un equipo femenino de fútbol base celebrando sobre el campo al
> final de un partido. Ocho niñas de entre 10 y 12 años con equipación lisa
> azul y blanca, sin ninguna letra, número, escudo, marca ni logotipo visible.
> Todas llevan botas de fútbol y medias altas; camisetas y piernas manchadas de
> barro y hierba. Abrazadas y saltando de alegría en grupo, con euforia natural.
> Campo municipal modesto, césped desgastado, atardecer con luz cálida rasante,
> grada sencilla con público desenfocado al fondo. Sin pancartas, sin carteles,
> sin marcador, sin publicidad y sin texto de ningún tipo. Estilo de prensa
> deportiva local: 35 mm, profundidad de campo suave, grano natural. Nada de
> pose de estudio ni estética de banco de imágenes, sin marcas de agua.
> Una de las niñas levanta una copa dorada sencilla, sin grabados.

Las dos trampas que hay que vigilar en el resultado: **texto inventado** en
camisetas y pancartas (el tell clásico de la IA, y encima envejece — una
pancarta con un año concreto caduca), y **jugadoras descalzas**, que un
coordinador de club detecta al instante.

Después, antes de subirla:

1. Comprueba que **no hay caras de menores reales identificables** ni escudos
   de clubes existentes — la imagen es IA precisamente por eso.
2. Verifica que el centro aguanta el titular: encima lleva un scrim navy al
   58–82 %, así que las zonas claras del centro no deben competir con el texto.
3. Optimiza a JPG de 1400-1600 px de ancho y ≤180 KB (más ancho que el hero
   castellano: esta imagen es muy apaisada y a 1024 se ablanda en monitores
   grandes):
   `npx sharp-cli -i entrada.png -o hero-femeni.jpg resize 1600 -- jpeg --quality 82 --mozjpeg`
4. Súbela a esta carpeta. `/ca/clubs` la coge sin tocar CSS.
