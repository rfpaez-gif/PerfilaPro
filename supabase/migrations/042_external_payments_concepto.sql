-- ============================================================
-- 042_external_payments_concepto.sql · Cantera
--
-- El club que usa el modelo "plan de pagos a medida" (conceptos con fecha
-- en enrollment_campaigns.concepts_jsonb) necesita poder apuntar un cobro
-- manual (Bizum/efectivo) contra UN concepto concreto del plan
-- (Inscripción, Ficha federativa, Material, 2º plazo…). Sin esto, el cobro
-- manual no se podía reconciliar con la columna correcta de la matriz de
-- Cobros y el coordinador no sabía qué concepto había quedado cubierto.
--
-- `concepto` es texto libre (espejo del nombre del concepto en el plan), no
-- una FK: el plan vive en un jsonb, no en una tabla. NULL para pagos sueltos
-- o para clubes en modelo mensual (que siguen usando `period`).
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- ============================================================

ALTER TABLE external_payments ADD COLUMN IF NOT EXISTS concepto text;

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE external_payments DROP COLUMN IF EXISTS concepto;
