-- ============================================================
-- 036_cantera_club_fee.sql · Cantera capa 4b · cuota del club
-- Ejecutar manualmente en Supabase, después de 033/034/035.
--
-- Cuota mensual que el club cobra a cada familia (en céntimos). MVP:
-- una cuota por club (no por categoría todavía — refinamiento futuro).
-- La paga el padre vía Stripe Connect (create-parent-checkout, 4b);
-- PerfilaPro retiene application_fee (STRIPE_PLATFORM_FEE_BPS).
--
-- Nullable: un club sin cuota configurada no puede cobrar (el endpoint
-- devuelve 409). Idempotente. Reversible (DROP COLUMN al final).
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cantera_monthly_fee_cents integer;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_cantera_fee_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_cantera_fee_check
  CHECK (cantera_monthly_fee_cents IS NULL OR cantera_monthly_fee_cents >= 0);

-- ============================================================
-- CONTRAMIGRACIÓN
--   ALTER TABLE organizations
--     DROP CONSTRAINT IF EXISTS organizations_cantera_fee_check,
--     DROP COLUMN IF EXISTS cantera_monthly_fee_cents;
-- ============================================================
