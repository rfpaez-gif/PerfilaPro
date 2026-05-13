-- ============================================================
-- 025_directory_public_invoker.sql · Quita SECURITY DEFINER de la view
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Motivación:
--   El Security Advisor de Supabase marca CRITICAL la view
--   `public.directory_public` porque está creada con la propiedad
--   SECURITY DEFINER (default histórico en Postgres < 15 y default
--   de las views creadas por el dashboard de Supabase).
--
--   SECURITY DEFINER hace que la view se ejecute con los permisos
--   del CREADOR (postgres / superuser) en lugar del rol que
--   consulta. Eso bypassa RLS de las tablas subyacentes (`cards`,
--   `categories`, `cities`) — justo lo contrario de lo que la
--   migración 024 acaba de habilitar.
--
--   La fix es marcar la view con `security_invoker = on`, que hace
--   que respete las policies del rol que ejecuta el SELECT.
--
-- Por qué NO rompe nada hoy:
--   `directory_public` se consume exclusivamente desde Netlify
--   Functions (lib/get-profile.js) con el cliente service_role, que
--   salta RLS por diseño. Como no hay queries directas desde anon /
--   authenticated, el cambio es funcionalmente invisible para la app.
--
-- Idempotente: CREATE OR REPLACE VIEW + WITH (security_invoker = on).
-- Reversible: re-emitir el CREATE OR REPLACE VIEW sin la opción.
-- ============================================================

CREATE OR REPLACE VIEW directory_public
WITH (security_invoker = on) AS
SELECT
  c.slug,
  c.nombre,
  c.tagline,
  c.foto_url,
  c.whatsapp,
  c.plan,
  c.stripe_session_id,
  c.profile_views,
  c.directory_featured,
  c.city_slug,
  cat.sector,
  cat.sector_label,
  cat.specialty,
  cat.specialty_label,
  ci.name     AS city_name,
  ci.province
FROM cards c
JOIN  categories cat ON c.category_id = cat.id
LEFT JOIN cities ci  ON ci.slug = c.city_slug
WHERE c.directory_visible = true
  AND c.status = 'active'
  AND c.deleted_at IS NULL;

-- ============================================================
-- Verificación post-ejecución:
--   SELECT relname, reloptions
--     FROM pg_class
--    WHERE relname = 'directory_public';
--   reloptions debe incluir 'security_invoker=on'.
--
-- Nota operativa:
--   Cualquier view nueva que se cree en el schema `public` debe
--   declarar `WITH (security_invoker = on)` desde el principio, por
--   la misma razón que toda tabla nueva debe `ENABLE ROW LEVEL
--   SECURITY` (postura unificada — ver supabase/RLS.md).
-- ============================================================
