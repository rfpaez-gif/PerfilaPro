-- ============================================================
-- 022_cards_plan_b2b.sql · Expande cards_plan_check con 'b2b'
--
-- Sprint 3 · PR #96 introdujo el carril B2B (plan='b2b') en
-- register-b2b.js y editar.html, pero la migración del CHECK
-- constraint se olvidó. Resultado: `register-b2b` (alta del
-- onboarding B2B) y `admin-orgs.invite_agent` (PR #97) fallan
-- con:
--
--   new row for relation "cards" violates check constraint
--   "cards_plan_check"
--
-- Esta migración recrea el constraint con la lista completa
-- de valores actualmente en uso por la aplicación:
--   - 'free'        → alta gratuita pre-pago
--   - 'base'        → plan trimestral 9€
--   - 'pro'         → plan anual 19€
--   - 'renovacion'  → renovación 5€ (admin-data lo cuenta)
--   - 'b2b'         → carril B2B (PR #96)
--
-- Idempotente: DROP IF EXISTS y luego ADD CONSTRAINT con el
-- mismo nombre. Si por algún motivo la base ya tiene un
-- constraint con esa lista expandida, recrearla no introduce
-- nada raro.
--
-- Reversible: para deshacer, ejecutar:
--   ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_plan_check;
--   ALTER TABLE cards ADD CONSTRAINT cards_plan_check
--     CHECK (plan IN ('free','base','pro','renovacion'));
-- (asume que no hay filas con plan='b2b' en BD; si las hay,
-- migrarlas a 'base' antes de revertir).
-- ============================================================

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_plan_check;

ALTER TABLE cards
  ADD CONSTRAINT cards_plan_check
  CHECK (plan IN ('free', 'base', 'pro', 'renovacion', 'b2b'));

-- Verificación: el constraint quedó como debe.
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'cards'::regclass
  AND conname = 'cards_plan_check';
