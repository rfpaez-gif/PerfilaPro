-- ============================================================
-- 046_b2b_leads_modalidad.sql · Modalidad deportiva del lead
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- La landing de clubes (/es/clubes · /ca/clubs) pregunta qué equipos
-- tiene el club: masculino, femenino, ambos u otro deporte. El dato
-- llega al founder en el email interno del lead y se persiste aquí
-- para poder segmentar el pipeline (p.ej. "clubes con sección
-- femenina") sin releer la bandeja de correo.
--
-- Solo la envía la landing deportiva. Los leads de /es/empresas y
-- /ca/empresas siguen llegando con modalidad NULL — por eso la columna
-- es nullable y sin default.
--
-- lead-b2b.js es tolerante a que esta migración no se haya ejecutado
-- todavía: si el INSERT falla por columna desconocida, reintenta sin
-- el campo para no perder el lead. Aun así, ejecútala ANTES del deploy.
--
-- Reversible: ALTER TABLE b2b_leads DROP COLUMN modalidad.
-- Idempotente: IF NOT EXISTS + DROP CONSTRAINT previo.
-- ============================================================

ALTER TABLE b2b_leads ADD COLUMN IF NOT EXISTS modalidad text;

ALTER TABLE b2b_leads DROP CONSTRAINT IF EXISTS b2b_leads_modalidad_check;
ALTER TABLE b2b_leads ADD CONSTRAINT b2b_leads_modalidad_check
  CHECK (modalidad IS NULL OR modalidad IN ('masculino','femenino','mixto','otro_deporte'));

-- Índice parcial: la consulta útil es "leads deportivos pendientes"
-- (los genéricos tienen modalidad NULL y quedan fuera del índice).
CREATE INDEX IF NOT EXISTS b2b_leads_modalidad_pending_idx
  ON b2b_leads (modalidad)
  WHERE modalidad IS NOT NULL AND redeemed_at IS NULL;
