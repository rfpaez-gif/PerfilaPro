-- ============================================================
-- 044_org_payment_instructions.sql · Cantera (cobro manual)
--
-- Datos que el club publica al padre para pagar FUERA de Stripe
-- (transferencia o Bizum directo) cuando el club no tiene Stripe Connect.
-- El panel del padre los muestra en un bloque "Cómo pagar al club" en vez
-- del botón de pago online; el club concilia el ingreso en la pestaña
-- Cobros (external_payments), igual que hoy.
--
-- NO mueven dinero ni son registro fiscal: son texto informativo. El
-- backend los sanea (longitud + strip tags). NULL por defecto → si el club
-- no rellena nada, el padre ve un mensaje genérico ("el club te indicará
-- cómo pagar").
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_iban text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_bizum text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payment_instructions text;

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE organizations DROP COLUMN IF EXISTS payment_iban;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS payment_bizum;
-- ALTER TABLE organizations DROP COLUMN IF EXISTS payment_instructions;
