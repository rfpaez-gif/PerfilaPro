# Row Level Security · Decisiones y estado

Este documento explica el estado de RLS en Supabase para PerfilaPro
y bajo qué circunstancias debería revisitarse.

## Estado actual

PerfilaPro accede a Supabase **exclusivamente desde Netlify
Functions** usando `SUPABASE_SERVICE_KEY` (service_role). El
service_role salta RLS por diseño, y `SUPABASE_ANON_KEY` no se usa
en ningún sitio del repo.

Aun así, desde la migración `024_enable_rls_all_tables.sql` la
postura del proyecto es **RLS activada en todas las tablas del
esquema `public`, sin policies**. Es la misma estrategia que ya se
aplicaba a `admin_audit_log` desde la migración 002, generalizada al
resto del modelo:

- `service_role` salta RLS  → las funciones Netlify siguen funcionando
  sin cambios.
- `anon` y `authenticated` sin policies  → denegado por defecto.

Esto silencia al Security Advisor de Supabase (que marca CRITICAL
cualquier tabla en `public` sin RLS) y aporta defense-in-depth: si
la anon key se filtra o si en el futuro alguien expone una ruta
directa desde el frontend, las tablas no quedan abiertas.

Tablas con RLS activada (sin policies, solo accesibles via
service_role):

- `cards`
- `settings`
- `facturas`
- `agents`
- `agent_liquidations`
- `visits`
- `organizations`
- `b2b_leads`
- `categories`
- `cities`
- `postal_codes`
- `ocupaciones`
- `admin_audit_log` (activada originalmente en migración 002)

## Por qué no hay policies

1. El frontend nunca tiene credenciales de Supabase. Toda lectura
   y escritura pasa por una Netlify Function que ya valida
   permisos a nivel de aplicación (admin password + TOTP, JWT de
   agente, edit token con TTL).
2. Las funciones añaden allowlisting de campos antes de cada
   `update` (`legal-settings`, `edit-card`), validan formato de
   inputs (`stripTags`, regex de phone/email) y restringen URLs
   de avatar al bucket de Supabase.
3. Sin policies, ni `anon` ni `authenticated` pueden tocar las
   tablas. Mientras el único cliente real sea el service_role,
   añadir policies sería ruido.

## Cuándo conviene escribir policies

Escribir policies pasa a ser necesario cuando se cumpla CUALQUIERA
de estas condiciones:

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

- Cualquier nueva migración que introduzca una tabla debe
  `ENABLE ROW LEVEL SECURITY` en la misma migración, aunque no
  declare policies (postura por defecto del proyecto).
- Si la nueva tabla sí necesita ser accesible desde `anon` o
  `authenticated`, declarar las policies en la misma migración.
  Nunca dejar una policy permisiva (`USING (true)`) por
  comodidad — eso es equivalente a tener RLS off pero con peor
  legibilidad.
- Cualquier nueva VIEW en `public` debe crearse con
  `WITH (security_invoker = on)`. Una view sin esa opción se
  ejecuta con permisos del creador (postgres) y bypassa la RLS
  de las tablas subyacentes — exactamente el agujero que cierra
  la migración `025_directory_public_invoker.sql`.
- Para verificar el estado real en una base de datos:
  ```sql
  SELECT relname, relrowsecurity
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relkind = 'r'
   ORDER BY relname;
  ```
  Todas las filas deben mostrar `relrowsecurity = true`.
