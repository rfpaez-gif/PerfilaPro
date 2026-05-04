-- ============================================================
-- 009_reset_pre_landing_v2.sql · Reset de datos de prueba
-- antes de la nueva landing v2 (PR #42).
--
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Contexto: el CEO confirma que las cards activas hoy son
-- pruebas de colegas (no clientes reales). Acordamos resetear
-- al 100% antes de empezar a captar tras el rediseno de la
-- landing y la rotacion de la promesa de producto a "Tu trabajo
-- merece verse".
--
-- Que se borra (datos de prueba):
--   - visits          (logs de visitas a cards, FK -> cards.slug)
--   - facturas        (PDFs y numeros de factura, FK -> cards.slug)
--   - cards           (perfiles profesionales)
--
-- Que se mantiene intacto:
--   - settings              (legal_name, legal_nif, legal_address, legal_email)
--   - organizations         (vacia, scaffolding fase 3)
--   - agents                (sistema de agentes referidos sigue activo)
--   - agent_liquidations    (historico de comisiones)
--   - audit_log si existe   (trazabilidad de operaciones)
--
-- Storage Supabase (NO se puede tocar desde SQL, hacer manual):
--   - bucket "Avatars"  -> VACIAR desde Storage > Avatars > Delete all
--                          (avatares de pagantes-amigos huerfanos
--                           sin sus cards)
--   - bucket "fotos"    -> MANTENER (las del rail de la home)
--
-- Stripe: no requiere accion. El historico de checkout sessions
-- queda en Stripe pero no se referencia desde codigo nuevo.
-- ============================================================

-- ============================================================
-- 1. Inspeccion previa: que vamos a borrar (siempre primero).
--    Si los counts no son lo que esperabas, NO sigas. Avisa.
-- ============================================================

SELECT 'cards'        AS tabla, COUNT(*) AS filas FROM cards
UNION ALL
SELECT 'facturas'     AS tabla, COUNT(*) AS filas FROM facturas
UNION ALL
SELECT 'visits'       AS tabla, COUNT(*) AS filas FROM visits;

-- Sample de las cards que se van a borrar (para verificar
-- una ultima vez que no hay nada vivo de produccion real).
SELECT slug, nombre, email, status, plan, created_at
FROM cards
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
-- 2. Borrado en orden seguro (de hijas a padre).
--    Independiente de si las FK tienen CASCADE, este orden
--    funciona siempre.
-- ============================================================

-- 2.a Visits: log de visitas, depende de cards.slug.
DELETE FROM visits;

-- 2.b Facturas: registros de facturas, depende de cards.slug.
DELETE FROM facturas;

-- 2.c Cards: perfiles profesionales (la tabla raiz).
DELETE FROM cards;

-- ============================================================
-- 3. Verificacion: las tres tablas deben quedar a 0 filas.
-- ============================================================

SELECT 'cards'        AS tabla, COUNT(*) AS filas FROM cards
UNION ALL
SELECT 'facturas'     AS tabla, COUNT(*) AS filas FROM facturas
UNION ALL
SELECT 'visits'       AS tabla, COUNT(*) AS filas FROM visits;

-- ============================================================
-- 4. Acciones manuales pendientes en el panel Supabase:
--
--    a) Storage > Avatars > seleccionar todo > Delete
--       (los avatares ya no apuntan a ninguna card valida).
--
--    b) (Opcional) Si quieres regenerar la secuencia de
--       numeros de factura desde 1 para el ano actual,
--       ejecuta tambien:
--
--       -- DELETE FROM facturas;  -- ya hecho arriba
--       -- No hay sequence dedicada: getNextInvoiceNumber()
--       -- en invoice-utils.js calcula MAX(numero)+1 sobre
--       -- facturas filtradas por ano. Vacia la tabla =>
--       -- la proxima factura sera FAC-2026-0001.
-- ============================================================
