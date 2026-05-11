-- ============================================================
-- 020_demo_org_template.sql · Seed B2B demo · Template genérico
-- Ejecutar manualmente en Supabase SQL Editor (depende de 019).
--
-- Crea una organización "Demo B2B" neutra para verificar que el
-- pipeline (org + asignación + render) funciona antes de crear
-- organizaciones reales desde el B2B Demo Studio (admin-orgs.html).
--
-- Para cualquier piloto real (Allianz, Mapfre, etc.) NO se modifica
-- esta migración: se entra al Studio en /admin-orgs.html y se crea
-- la org desde el formulario, subiendo logo y eligiendo color.
-- Esto evita ensuciar el repo con marcas de terceros y permite
-- white-label sobre el mismo código.
--
-- Idempotencia: INSERT ... SELECT ... WHERE NOT EXISTS. Re-ejecutar
-- la migración inserta 0 filas si la org "demo-b2b" ya existe viva.
--
-- Reversibilidad: para limpiar, ejecutar:
--   UPDATE cards SET organization_id = NULL
--   WHERE organization_id = (SELECT id FROM organizations WHERE slug='demo-b2b');
--   DELETE FROM organizations WHERE slug = 'demo-b2b';
-- ============================================================

INSERT INTO organizations (slug, name, tagline, logo_url, color_primary, nif, email)
SELECT 'demo-b2b',
       'Demo B2B',
       'Plantilla genérica para verificar el pipeline B2B',
       NULL,
       '#0A1F44',                  -- PerfilaPro navy neutro
       NULL,
       NULL
WHERE NOT EXISTS (
  SELECT 1 FROM organizations
  WHERE slug = 'demo-b2b' AND deleted_at IS NULL
);

-- Asigna las cards seed (is_seed=true) a esta org template para que
-- /e/demo-b2b muestre profesionales sin tener que crear cards reales.
-- Si las cards seed no existen todavía, el UPDATE afecta 0 filas.
UPDATE cards
SET organization_id = (SELECT id FROM organizations WHERE slug = 'demo-b2b')
WHERE is_seed = true
  AND organization_id IS NULL
  AND deleted_at IS NULL;

-- ============================================================
-- Verificación
-- ============================================================
SELECT slug, name, color_primary
FROM organizations
WHERE slug = 'demo-b2b';
