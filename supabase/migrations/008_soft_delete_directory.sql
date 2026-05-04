-- ============================================================
-- 008_soft_delete_directory.sql · Sprint 1.b
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Tras el refactor de delete-account a soft-delete (deleted_at),
-- la vista directory_public sigue exponiendo perfiles "borrados"
-- porque su WHERE no contempla la columna nueva. Esta migracion
-- la recrea con el filtro.
--
-- Idempotente: CREATE OR REPLACE VIEW.
-- ============================================================

CREATE OR REPLACE VIEW directory_public AS
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
