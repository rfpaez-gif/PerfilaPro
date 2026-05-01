# Row Level Security · Decisiones y estado

Este documento explica el estado de RLS en Supabase para PerfilaPro
y bajo qué circunstancias debería revisitarse.

## Estado actual

PerfilaPro accede a Supabase **exclusivamente desde Netlify
Functions** usando `SUPABASE_SERVICE_KEY` (service_role). El
service_role salta RLS por diseño, por lo que la postura por
defecto del proyecto es:

- **RLS desactivada** en todas las tablas del esquema `public`
  excepto en `admin_audit_log`, que tiene RLS activada sin
  policies (blindado por defecto).
- **Ningún acceso anónimo directo** desde el frontend a Supabase:
  `SUPABASE_ANON_KEY` no se usa en este repo.

Tablas con RLS desactivada (acceso vía service_role únicamente):

- `cards`
- `settings`
- `facturas`
- `agents`
- `agent_liquidations`
- `visits`
- `categories`

Tabla con RLS activada y sin policies:

- `admin_audit_log` (migración `002_audit_log.sql`)

## Por qué RLS off es aceptable hoy

1. El frontend nunca tiene credenciales de Supabase. Toda lectura
   y escritura pasa por una Netlify Function que ya valida
   permisos a nivel de aplicación (admin password + TOTP, JWT de
   agente, edit token con TTL).
2. Las funciones añaden allowlisting de campos antes de cada
   `update` (`legal-settings`, `edit-card`), validan formato de
   inputs (`stripTags`, regex de phone/email) y restringen URLs
   de avatar al bucket de Supabase.
3. La tabla `admin_audit_log` está blindada con RLS para evitar
   que cualquier integración futura con `anon` o `authenticated`
   pueda leer un registro de auditoría sin pasar por el
   service_role.

## Cuándo conviene revisitar y activar RLS

Activar RLS y escribir policies pasa a ser necesario cuando se
cumpla CUALQUIERA de estas condiciones:

- Se introduce acceso directo desde el frontend a Supabase con
  `SUPABASE_ANON_KEY` (por ejemplo, suscripciones realtime,
  Storage signed URLs en cliente, login con Supabase Auth).
- Se añade un rol `authenticated` para usuarios finales y se
  expone parte del modelo a esos usuarios.
- Se externaliza alguna ruta de lectura a un servicio que no
  pertenezca a este repo (microservicio, integración con
  partners, panel BI con conexión directa).
- Se introduce multi-tenancy real (por ejemplo cuentas de
  empresa con sus propias tarjetas), donde la separación de datos
  entre tenants no se puede confiar a la lógica de la función.

## Política operativa

- No habilitar RLS sin escribir las policies correspondientes en
  el mismo PR. Una tabla con RLS y sin policies queda inaccesible
  para `anon` y `authenticated`, y aunque eso es seguro, conviene
  hacerlo de forma deliberada (como en `admin_audit_log`) y no
  por descuido.
- Cualquier nueva migración que introduzca una tabla debe
  declarar explícitamente su postura de RLS (on/off) y, si on,
  acompañar las policies. Si la tabla solo se lee/escribe desde
  funciones con service_role, dejar RLS off y comentarlo en la
  migración.
