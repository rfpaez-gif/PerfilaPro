-- ============================================================
-- 039_cantera_enrollment_charges.sql · Cargos programados del
-- plan de pagos a medida (concepts_jsonb de la 037) vía Stripe
-- Connect. Un cargo por concepto y por jugador.
--
-- Motivación: el plan de pagos a medida (migración 037 + feature
-- "conceptos con fecha") se cobraba MANUALMENTE en el MVP. Para que el
-- dinero pase por Stripe Connect — y con él nuestra application_fee — cada
-- concepto del plan se materializa como una fila aquí cuando una familia se
-- inscribe pagando online: lo que vence ya se cobra en el acto y el resto
-- queda 'scheduled' para que un cron lo cobre off-session en su fecha.
--
-- El cobro manual (external_payments, 034) sigue vivo como alternativa para
-- clubes sin Stripe; esta tabla solo se rellena en el carril online.
--
-- Ejecutar manualmente en Supabase SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS enrollment_charges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug               text NOT NULL REFERENCES cards(slug),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  enrollment_campaign_id  uuid REFERENCES enrollment_campaigns(id),
  concepto                text NOT NULL,
  amount_cents            integer NOT NULL,
  currency                text NOT NULL DEFAULT 'eur',
  due_date                date NOT NULL,
  status                  text NOT NULL DEFAULT 'scheduled',
  application_fee_cents   integer,
  stripe_payment_intent_id text,
  stripe_customer_id      text,
  paid_at                 timestamptz,
  attempts                integer NOT NULL DEFAULT 0,
  last_error              text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Sin ON DELETE en las FK (NO ACTION): mismo criterio que
-- parent_subscriptions / external_payments — un cargo no se borra en
-- cascada al limpiar la card; obliga a una limpieza explícita.

ALTER TABLE enrollment_charges DROP CONSTRAINT IF EXISTS enrollment_charges_amount_check;
ALTER TABLE enrollment_charges ADD CONSTRAINT enrollment_charges_amount_check
  CHECK (amount_cents >= 0);

--    'scheduled'  = creado, esperando su fecha (lo cobra el cron).
--    'processing' = PaymentIntent creado, liquidación en curso (SEPA async).
--    'paid'       = cobrado con éxito.
--    'failed'     = el cobro falló (mandato revocado, fondos, etc).
--    'canceled'   = baja del jugador / plan anulado.
--    'manual'     = el club cobra ESTE concepto fuera de Stripe (fallback).
ALTER TABLE enrollment_charges DROP CONSTRAINT IF EXISTS enrollment_charges_status_check;
ALTER TABLE enrollment_charges ADD CONSTRAINT enrollment_charges_status_check
  CHECK (status IN ('scheduled','processing','paid','failed','canceled','manual'));

-- El cron busca los cargos vencidos pendientes: índice parcial sobre los
-- que aún hay que cobrar, ordenados por fecha.
CREATE INDEX IF NOT EXISTS idx_enrollment_charges_due
  ON enrollment_charges (due_date)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_enrollment_charges_card
  ON enrollment_charges (card_slug, due_date);

CREATE INDEX IF NOT EXISTS idx_enrollment_charges_club
  ON enrollment_charges (organization_id, due_date DESC);

-- Un PaymentIntent no puede asociarse a dos cargos (cuando se rellena).
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_charges_pi
  ON enrollment_charges (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- RLS on + REVOKE desde el arranque (patrón Cantera 033/034/035). El
-- acceso es exclusivamente vía SUPABASE_SERVICE_KEY, que salta RLS; anon /
-- authenticated quedan denegados por defecto (importes + Stripe IDs).
ALTER TABLE enrollment_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON enrollment_charges FROM anon, authenticated;

-- ── Contramigración (manual) ──────────────────────────────
-- DROP TABLE IF EXISTS enrollment_charges;
