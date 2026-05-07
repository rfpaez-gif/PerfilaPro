-- ============================================================
-- 014 · Catálogo de ocupaciones SEPE/SISPE 2011 (Sprint SEO fundamentos II)
-- 2.221 ocupaciones específicas (8 dígitos CNO-SISPE) mapeadas a los
-- 20 sectores internos PerfilaPro. Alimenta el autocomplete del picker
-- 'No me veo' en alta.html via /api/ocupaciones-search?q=...
--
-- Datos: dataset oficial FUNDAE/SEPE — solo se persisten ocupaciones de
-- 8 dígitos (lenguaje natural, ej. "Fontaneros"); los agrupadores de
-- 1/2/3/4 dígitos son agregadores estadísticos y se descartan.
-- ============================================================

-- 1. Extensión pg_trgm para búsqueda ILIKE eficiente con índice GIN.
-- Soportada por defecto en Supabase. La línea es idempotente.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Tabla ocupaciones
CREATE TABLE IF NOT EXISTS ocupaciones (
  code             text PRIMARY KEY CHECK (code ~ '^[0-9]{8}$'),
  name             text NOT NULL,
  name_normalized  text NOT NULL,  -- lowercase + sin diacríticos para LIKE
  sector_slug      text NOT NULL CHECK (sector_slug IN (
    'oficios','salud','educacion','comercial','belleza','reforma',
    'hosteleria','tech','legal','jardineria','transporte','fotografia',
    'eventos','automocion','seguridad','cuidados','fitness','turismo',
    'comercio','otro'
  ))
);

-- Índice GIN trigram sobre name_normalized: permite ILIKE '%xxx%' en O(log n).
CREATE INDEX IF NOT EXISTS idx_ocupaciones_name_trgm
  ON ocupaciones USING gin (name_normalized gin_trgm_ops);

-- Índice secundario por sector para filtros 'sugerencias del sector X'.
CREATE INDEX IF NOT EXISTS idx_ocupaciones_sector
  ON ocupaciones (sector_slug);

-- 3. Nueva columna cards.ocupacion_code (8 dígitos CNO-SISPE).
-- Nullable: si el alta no usa el catálogo (free text antiguo), queda NULL.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ocupacion_code text;
ALTER TABLE cards ADD CONSTRAINT cards_ocupacion_format
  CHECK (ocupacion_code IS NULL OR ocupacion_code ~ '^[0-9]{8}$') NOT VALID;

-- 4. Seeds: importar 014_ocupaciones_seeds.csv via Supabase Table Editor.
--    UI: Table Editor → ocupaciones → Insert → Import data from CSV.
--    Archivo: supabase/migrations/014_ocupaciones_seeds.csv (2221 filas).
