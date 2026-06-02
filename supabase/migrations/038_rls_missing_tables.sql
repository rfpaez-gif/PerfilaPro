-- ============================================================
-- 038_rls_missing_tables.sql · RLS defensiva en 3 tablas que se
-- crearon DESPUÉS de la migración 024 sin habilitar RLS.
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Motivación (auditoría de lanzamiento · Q2):
--   La migración 024 habilitó RLS en todas las tablas existentes en su
--   momento, y las tablas Cantera (033/034/035) arrancan ya con RLS +
--   REVOKE. Pero tres tablas posteriores quedaron SIN RLS, rompiendo el
--   patrón "RLS on en todo":
--
--     - org_invoices         (029) — importes de facturación B2B + agent_code.
--     - enrollment_campaigns (037) — campañas de inscripción de temporada.
--     - card_documents       (037) — documentos (DNI, libro de familia, cert.
--                                     médico) de menores. Especialmente sensible.
--
--   PerfilaPro accede a Supabase exclusivamente con SUPABASE_SERVICE_KEY
--   (que SALTA RLS por diseño), así que todas las funciones Netlify siguen
--   funcionando sin cambios. Activar RLS sin policies + REVOKE deja estas
--   tablas denegadas por defecto para anon/authenticated: si la anon key se
--   filtra o se expone una ruta directa, no quedan abiertas.
--
-- Idempotente: ENABLE ROW LEVEL SECURITY solo flipea un flag; REVOKE es
-- idempotente. Re-ejecutar no rompe nada.
-- ============================================================

ALTER TABLE org_invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_documents       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON org_invoices         FROM anon, authenticated;
REVOKE ALL ON enrollment_campaigns FROM anon, authenticated;
REVOKE ALL ON card_documents       FROM anon, authenticated;

-- Tras ejecutar este SQL, actualizar supabase/RLS.md para reflejar el
-- nuevo estado (las 3 tablas pasan a "RLS on, sin policies, service_role").

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE card_documents       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE enrollment_campaigns DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE org_invoices         DISABLE ROW LEVEL SECURITY;
-- ── Fin contramigración ───────────────────────────────────
