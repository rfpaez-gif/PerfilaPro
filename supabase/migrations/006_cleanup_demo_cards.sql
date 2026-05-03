-- ============================================================
-- 006_cleanup_demo_cards.sql · Limpieza de cards demo manuales
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Contexto: la auditoria externa detecto el card publico
-- /c/benjamin-rodriguez con datos reales (email real, telefono
-- mal formado, ubicacion incoherente con la home). El HTML
-- de public/index.html linkeaba a tres slugs inventados:
--   - benjamin-rodriguez
--   - maria-garcia
--   - luis-pena
-- El HTML ya no los linkea (commit posterior). Falta decidir
-- que hacer con las filas si existen en BD.
--
-- Estos slugs no estan en archetypes.json (no son seeds
-- automaticos). Lo mas probable: cards creadas a mano durante
-- pruebas, contaminadas con datos reales del tester.
--
-- Estrategia segura por pasos:
--   1) Inspeccionar (SELECT)
--   2) Despublicar (UPDATE no destructivo)
--   3) Borrar (DELETE, requiere descomentar tras revisar)
-- ============================================================

-- 1. Inspeccion: listar las cards si existen.
SELECT
  slug, nombre, email, whatsapp, telefono, zona,
  status, directory_visible, is_seed, created_at,
  stripe_session_id
FROM cards
WHERE slug IN ('benjamin-rodriguez', 'maria-garcia', 'luis-pena');

-- ============================================================
-- 2. Despublicar (no destructivo): saca las cards del
--    directorio publico y archiva el status. Si la fila
--    resulta ser de un usuario legitimo, todavia se puede
--    reactivar.
-- ============================================================
UPDATE cards
SET
  directory_visible = false,
  status            = 'archived'
WHERE slug IN ('benjamin-rodriguez', 'maria-garcia', 'luis-pena')
  AND status <> 'archived';

-- ============================================================
-- 3. Borrar definitivamente (DESCOMENTAR solo despues de
--    verificar en el paso 1 que NO son usuarios legitimos).
--    Cascadeara a visits / facturas si las FK tienen ON DELETE
--    CASCADE; si no, borrar primero las dependencias.
-- ============================================================
-- DELETE FROM cards
-- WHERE slug IN ('benjamin-rodriguez', 'maria-garcia', 'luis-pena');

-- ============================================================
-- 4. Verificacion final: ya no deberian aparecer en
--    directory_public.
-- ============================================================
SELECT slug, status, directory_visible
FROM cards
WHERE slug IN ('benjamin-rodriguez', 'maria-garcia', 'luis-pena');
