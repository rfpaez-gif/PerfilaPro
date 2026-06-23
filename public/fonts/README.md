# Fuentes autoalojadas

Estos `.woff2` se sirven desde el mismo origen para **no hacer peticiones a
Google Fonts** (RGPD/AEPD: cargar Google Fonts envía la IP del visitante a
Google sin consentimiento — el motivo de las sanciones a webs que lo hacían).
Las declaraciones `@font-face` viven en `../styles/fonts.css`, que importa
`tokens-typography.css` y al que enlazan directamente todas las páginas.

## Familias y licencias
- **Inter** — SIL Open Font License 1.1
- **Source Serif 4** — SIL Open Font License 1.1 (normal + italic)
- **JetBrains Mono** — SIL Open Font License 1.1
- **Dancing Script** — SIL Open Font License 1.1

Todas son OFL: el autoalojamiento está permitido.

## Cómo regenerar (si se cambian familias o pesos)
Son los `woff2` variables (un fichero por subset cubre todo el rango de pesos),
subsets `latin` + `latin-ext` (suficiente para es/ca). Se obtienen pidiendo el
CSS de Google con un User-Agent de Chrome (devuelve URLs `.woff2` de gstatic) y
descargando los ficheros de los subsets `latin`/`latin-ext`:

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
curl -A "$UA" "https://fonts.googleapis.com/css2?family=Inter:wght@400..900&family=Source+Serif+4:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400..500&family=Dancing+Script:wght@400..700&display=swap"
# de la salida, guardar los .woff2 de los bloques /* latin */ y /* latin-ext */
# y reescribir las URLs a /fonts/... en ../styles/fonts.css
```
