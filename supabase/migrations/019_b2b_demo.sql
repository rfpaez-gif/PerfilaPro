-- ============================================================
-- 019_b2b_demo.sql · Branding de organizaciones (B2B demo)
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Activa el scaffolding dormido de la migración 007 (organizations
-- + cards.organization_id) añadiendo los campos necesarios para
-- una página /e/:slug branded: slug público, logo, color primario,
-- tagline.
--
-- Reversible: las columnas son nullable, sin valor por defecto.
-- Si la demo se descarta, basta con borrar /e/:slug, dejar las
-- columnas dormidas o DROP COLUMN en una contramigración.
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

-- 1. Campos de branding (nullable, cero impacto en orgs preexistentes)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug          text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url      text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS color_primary text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tagline       text;

-- 2. Unicidad de slug solo cuando está set y la org no está borrada.
--    Permite "soft-deletar" una org y reusar su slug más tarde.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug
  ON organizations (slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

-- 3. Formato hex de color_primary (#RRGGBB). NULL permitido — el
--    backend cae al color por defecto del registro frío del directorio.
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_color_primary_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_color_primary_check
  CHECK (color_primary IS NULL OR color_primary ~ '^#[0-9a-fA-F]{6}$');

-- ============================================================
-- Notas:
--   * logo_url se valida en el backend con la misma whitelist que
--     cards.foto_url (supabase.co/storage, supabase.in/storage).
--     No se restringe a nivel DB porque la URL canónica depende del
--     proyecto Supabase y queremos poder mover de proyecto sin
--     migración SQL.
--   * tagline: texto libre, hasta ~140 chars. Lo limita el backend.
--   * NO se añade aún Stripe Subscription ni billing B2B; eso
--     entra en Sprint 3 cuando el modelo de cobro recurrente se
--     active y el proveedor Verifactu esté integrado.
-- ============================================================
