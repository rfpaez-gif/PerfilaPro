# INMO · rastreo de subastas inmobiliarias (costa de Tarragona)

Vertical para **rastrear de forma automática y privada** las subastas de
inmuebles que se publican en el **Portal de Subastas del BOE**
(`subastas.boe.es`) y quedarse solo con las de la **franja costera de la
provincia de Tarragona** (Costa Daurada + costa de les Terres de l'Ebre).

Montado sobre la infraestructura de PerfilaPro (Supabase + scheduled
function + Resend + render público server-side) pero como **entidad
propia** — una finca no es una persona, así que **no se sobrecarga
`cards`**: tiene sus tablas (`subastas`, `subasta_visits`).

Todo el carril está **gateado** por `INMO_VERTICAL_ACTIVE`. Con cualquier
valor distinto de `'1'` queda dormido: el cron no hace nada y `/s/:slug`
devuelve 404. Cero impacto en autónomos / B2B / Cantera.

## Piezas

| Pieza | Archivo |
|---|---|
| Migración (tablas) | `supabase/migrations/045_inmo_subastas.sql` |
| Gate de runtime | `netlify/functions/lib/inmo/flag.js` |
| **Zona costera** (lista blanca + geofiltro) | `netlify/functions/lib/inmo/municipios.js` |
| Cliente BOE (fetch + parseo) | `netlify/functions/lib/inmo/boe-client.js` |
| Modelo (importes, fechas, slug, estado) | `netlify/functions/lib/inmo/subasta-model.js` |
| Email de aviso | `netlify/functions/lib/inmo/subasta-email.js` |
| Render público de la ficha | `netlify/functions/lib/inmo/subasta-render.js` |
| Scheduled function (rastreo diario) | `netlify/functions/inmo-scrape-subastas.js` |
| Página pública `/s/:slug` | `netlify/functions/subasta.js` |

## Flujo

1. **Cron diario 07:00** (`inmo-scrape-subastas`): busca inmuebles en la
   provincia 43 → recoge los identificadores `SUB-…` del listado → abre
   el detalle de cada uno → se queda **solo con los bienes cuya localidad
   cae en la franja costera** (`municipioCostero`) → upsert en `subastas`.
2. **Aviso**: si `INMO_ALERT_INBOX` está configurado, manda un email con
   las subastas **nuevas** y las que **cierran pronto** (≤3 días). Marca
   `notified_new` / `notified_closing` para no repetir.
3. **Vitrina**: cada finca tiene su ficha pública en `/s/:slug` (foto,
   dirección, mapa, valor, depósito, fechas, enlace al BOE). `noindex`.

## El filtro "costa" (el núcleo de valor)

El BOE filtra por **provincia**, no por costa. La franja la define la
lista blanca de `municipios.js`: municipios litorales + sus localidades /
pedanías costeras + variantes de nombre (catalán/castellano, con y sin
artículo, renombres oficiales). El matching se hace **solo contra la
localidad del bien** (no contra un texto que incluya la provincia), para
no dar falsos positivos con el token "Tarragona" en municipios de
interior. Cubierto por `tests/inmo-municipios.test.js`.

Para añadir/quitar municipios, editar `MUNICIPIOS_COSTA` y añadir el caso
al test.

## ⚠️ Verificación en la PRIMERA ejecución real

El parseo se ancla en texto estable (el identificador `idSub=…` y las
etiquetas en español que ve el usuario), y está cubierto por tests con
fixtures **representativos**. Pero el HTML real del portal **no es
accesible desde el entorno de desarrollo** (egress bloqueado), así que en
el primer deploy con `INMO_VERTICAL_ACTIVE=1` hay que confirmar dos cosas:

1. **`INMO_BOE_SEARCH_URL`** — lo más fiable: abrir `subastas.boe.es`,
   aplicar en el buscador avanzado **Provincia = Tarragona** + **Tipo de
   bien = Inmuebles**, y pegar la URL resultante en la env var (el portal
   conserva el filtro en la query string). Si se deja vacía se usa un
   default best-effort (provincia 43 / inmuebles) que conviene validar.
2. **Las etiquetas de `parseDetalle`** coinciden con las del HTML vivo. Si
   el portal cambió algún literal ("Valor de subasta", "Localidad", "Fecha
   de conclusión"…), ajustar la lista de sinónimos en `boe-client.field`.

Cómo validar rápido: encender el flag en un deploy de preview, disparar la
función una vez y revisar el log (`scraped` / `en la costa`) + una ficha
`/s/:slug`. Si `scraped` es 0 con subastas activas en Tarragona, casi
seguro es (1) la search URL o (2) un literal de etiqueta.

## Variables de entorno

Ver bloque `INMO ·` en `.env.example`. Resumen: `INMO_VERTICAL_ACTIVE`,
`INMO_ALERT_INBOX`, `INMO_BOE_SEARCH_URL`, `INMO_MAX_PAGES`,
`INMO_REQUEST_DELAY_MS`.

## Buen ciudadano

El portal del BOE es un servicio público. El cliente manda un `User-Agent`
identificable y **espacia las peticiones** (`INMO_REQUEST_DELAY_MS`, 800 ms
por defecto) con un tope de páginas. No martillear el portal.

## Reversibilidad

- **Apagado runtime**: borrar `INMO_VERTICAL_ACTIVE`. El cron pasa a no-op
  y `/s/:slug` devuelve 404. Las tablas quedan con sus datos, inertes.
- **Apagado total**: quitar el bloque `[functions."inmo-scrape-subastas"]`
  y la redirect `/s/:slug` de `netlify.toml`, borrar los archivos del
  carril, y ejecutar la contramigración (al pie de `045_inmo_subastas.sql`)
  para tirar las tablas. Cero efecto sobre el resto de PerfilaPro.

## Fuera de scope (deuda consciente)

- **Geocodificación** (lat/lng) de la dirección para un polígono costero
  fino — las columnas existen pero hoy el filtro es por municipio.
- **Multi-lote**: se modela un bien por subasta (el caso común). Subastas
  con varios inmuebles en distintos municipios capturan el primero costero.
- **Subastas notariales** (`subastas.notariado.org`) — fuente aparte; hoy
  solo BOE (judicial + AEAT + Seg. Social + concursal).
- **Índice/listado navegable** (`/inmo`) — hoy la vitrina es ficha a ficha
  + el email de aviso; un índice agregado es el siguiente paso natural.
