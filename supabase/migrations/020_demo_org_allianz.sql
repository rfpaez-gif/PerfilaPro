-- ============================================================
-- 020_demo_org_allianz.sql · Seed B2B demo · Allianz Agentes
-- Ejecutar manualmente en Supabase SQL Editor (depende de 019).
--
-- Crea la organización "Allianz Agentes" con su azul corporativo
-- para presentar el piloto B2B a un admin de Allianz España que
-- gestiona cartera de agentes. La URL será /e/allianz-agentes.
--
-- Allianz es marca registrada de Allianz SE. Esta seed se incluye
-- para una evaluación interna con un contacto autorizado del
-- equipo de Allianz España. No se difunde públicamente, no se
-- indexa (la página /e/:slug emite robots noindex,nofollow) y
-- debe retirarse del entorno si la conversación piloto no avanza.
--
-- Idempotencia: ON CONFLICT (slug) DO NOTHING. Re-ejecutar la
-- migración no duplica ni sobreescribe el row existente.
--
-- Reversibilidad: para limpiar, ejecutar:
--   UPDATE cards SET organization_id = NULL
--   WHERE organization_id = (SELECT id FROM organizations WHERE slug='allianz-agentes');
--   DELETE FROM organizations WHERE slug = 'allianz-agentes';
-- ============================================================

INSERT INTO organizations (slug, name, tagline, logo_url, color_primary, nif, email)
VALUES (
  'allianz-agentes',
  'Allianz Agentes',
  'Cartera de agentes Allianz España · piloto PerfilaPro',
  NULL,                            -- ver sección "Subir logo" más abajo
  '#003781',                       -- Allianz corporate navy
  NULL,
  NULL
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Subir logo y enlazarlo (manual, fuera de esta migración):
--   1. Dashboard Supabase → Storage → bucket "Avatars".
--   2. Sube el PNG/SVG del logo Allianz autorizado.
--   3. Copia la "Public URL" del archivo.
--   4. Sustituye <URL_PUBLICA> abajo y ejecuta el UPDATE.
--
-- UPDATE organizations
-- SET logo_url = '<URL_PUBLICA_DEL_BUCKET_AVATARS>'
-- WHERE slug = 'allianz-agentes';
--
-- Nota: el backend (lib/org-utils.isSafeLogoUrl) solo acepta URLs
-- que contengan "supabase.co/storage" o "supabase.in/storage". Una
-- URL de cdn.allianz.com o wikipedia.org se guardaría en BD pero
-- el render la ignoraría. Si necesitas relajar esto, hablamos —
-- el whitelist evita XSS via SVG y mixed-content.
-- ============================================================

-- Asignar las cards seed existentes a la nueva org. WHERE filtra
-- por is_seed=true para nunca tocar perfiles reales. Si las cards
-- no existen todavía, el UPDATE afecta 0 filas — sin error.
UPDATE cards
SET organization_id = (SELECT id FROM organizations WHERE slug = 'allianz-agentes')
WHERE is_seed = true
  AND organization_id IS NULL
  AND deleted_at IS NULL;

-- ============================================================
-- Verificación: listar la org y sus cards asignadas.
-- ============================================================
SELECT o.slug AS org, o.name, o.color_primary, c.slug AS card, c.nombre
FROM organizations o
LEFT JOIN cards c ON c.organization_id = o.id AND c.deleted_at IS NULL
WHERE o.slug = 'allianz-agentes'
ORDER BY c.nombre;
