# Kit del agente PerfilaPro

Pieza 3 del paquete comercial. Este kit existe para que un colaborador
comercial pueda (a) entender el producto que vende y cómo cobra, (b)
operar su portal sin preguntas básicas al founder, y (c) salir a la
calle con plantillas reales que ahorran fricción.

Pensado para autónomos comerciales y partners pequeños que cierran
organizaciones B2B con `?via=agent-XXX`. No es un manual de empleado;
es un manual de trabajo en el día a día.

## Cómo usar el kit

Los seis documentos son independientes y cada uno cubre una capa
distinta. No hace falta leerlos en orden, pero si entras de cero:

1. **[Portal — qué ves y cómo se navega](kit-agente-portal-readme.md)**
   Tu inicio de sesión, las dos pestañas (Autónomos / B2B), qué
   significa cada KPI, cómo descargas el extracto.
2. **[Links de referido — autónomos vs B2B](kit-agente-links-referido.md)**
   Qué link reparto, en qué situación, y cómo se atribuye cada uno
   por dentro.
3. **[Comisiones — modelo con números reales](kit-agente-comisiones.md)**
   El % propio, el 5% L2 sobre la red, y cuatro escenarios cerrados
   con euros para que sepas qué pides al cliente y qué cobras tú.
4. **[Plantillas de prospección — email, WhatsApp, LinkedIn](kit-agente-plantillas-prospeccion.md)**
   En español y catalán, para empresas con red comercial, despachos
   y colegios profesionales. Copia, personaliza, envía.
5. **[Operativa de cobros — facturación y liquidaciones](kit-agente-operativa-cobros.md)**
   Cuándo se cierran liquidaciones, cómo facturas a PerfilaPro, qué
   datos tiene que tener al día tu ficha de agente.
6. **[Qué NO hacer — promesas, descuentos, leads del founder](kit-agente-que-no-hacer.md)**
   Lo que el producto no es. Descuentos no autorizados. Cómo se
   manejan las cuentas que ya están en cartera del founder.

## Estado del producto y de los carriles

- **B2B (carril principal).** Vivo y cobrando recurring. Toda la
  atribución funciona end-to-end: link `?via=` → lead → org →
  factura → comisión recurrente en tu portal.
- **Autónomos.** Vivo. El link `?ref=AGENT` se captura en `/alta` y
  el `agent_code` se persiste en `cards`; el upgrade de un autónomo
  free a Pro mantiene la atribución.
- **Demo / promo.** Hay grifos que regalan Pro a autónomos en
  campañas concretas (`WEB_FUNNEL_FREE_ACTIVE`, `DEMO_FUNNEL_FREE_ACTIVE`).
  Cuando uno está encendido y entra un autónomo con tu `?ref=`, su
  card queda como Pro gratis. La atribución se registra igual pero
  **no genera comisión cards** porque el cliente no pagó. Tu valor
  en esa campaña es de embudo hacia B2B, no de comisión inmediata.

## Antes de salir a vender, una vez

- Verifica que entras al portal con tu email y contraseña en
  `https://perfilapro.es/agente-login.html`.
- Comprueba que en la topbar aparece tu nombre.
- Comprueba que tu `commission_rate` (vas a verlo en el extracto
  CSV) es el que acordaste con el founder.
- Comprueba que tu ficha tiene NIF + dirección + razón social
  rellenos. Si no, no puedes facturar — escribe al founder.

## A quién contactar

- Soporte de producto, dudas técnicas, dudas de descuentos, cuentas
  grandes: `hola@perfilapro.es`.
- Problemas con tu portal (no entras, KPIs descuadrados,
  liquidación que no aparece): mismo email, pero menciona "portal
  agente" en el asunto.
- No hay teléfono de soporte. Email es el canal.
