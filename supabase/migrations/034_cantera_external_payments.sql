-- ============================================================
-- 034_cantera_external_payments.sql · Cantera capa 0.5
-- Ejecutar manualmente en Supabase SQL Editor, después de 033.
--
-- Aterriza dos decisiones del handoff (docs/cantera-handoff.md):
--   Q1 = sí · gestión manual de pagos (Bizum/efectivo) en el MVP.
--   Q2 = texto libre · histórico pre-plataforma del jugador.
--
-- Cero impacto fuera del carril Cantera: external_payments es tabla
-- nueva y previous_club_name es columna nullable sobre una tabla
-- que sólo existe para sports_club.
--
-- Idempotente: re-ejecutar no rompe nada.
-- Reversible: contramigración documentada al final del archivo.
-- ============================================================

-- 1. Histórico pre-plataforma del jugador (Q2 · texto libre) ---
--    El nombre legible del club del que llega el chaval cuando ese
--    club NO está en PerfilaPro (caso dominante en fase 1: todos los
--    fichajes entrantes vienen de clubes off-platform). No enlaza a
--    organizations — es captura de histórico, no relación. El handoff
--    transaccional entre clubes PerfilaPro sigue usando organization_id.
ALTER TABLE member_club_seasons
  ADD COLUMN IF NOT EXISTS previous_club_name text;

-- 2. Pagos manuales registrados (Q1 · Bizum/efectivo en MVP) ---
--    El club apunta aquí los cobros que recibe fuera de Stripe Connect
--    (Bizum personal del coordinador, efectivo, transferencia suelta).
--    La pestaña Cobros del Studio une parent_subscriptions (Stripe) +
--    external_payments (manual) en una sola vista de "quién pagó".
--
--    NO es un registro fiscal: la factura/recibo SEPA legal la emite el
--    club fuera de PerfilaPro. receipt_number guarda el número del
--    "recibo" informativo (plantilla recibo, no factura, de
--    invoice-utils.js) cuando el club lo genera para un padre que lo pide.
CREATE TABLE IF NOT EXISTS external_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug       text NOT NULL REFERENCES cards(slug),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period          text,
  amount_cents    integer NOT NULL,
  currency        text NOT NULL DEFAULT 'eur',
  method          text NOT NULL,
  recorded_by     text NOT NULL,
  paid_at         timestamptz NOT NULL DEFAULT now(),
  receipt_number  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Sin ON DELETE en las FK (NO ACTION): mismo criterio que
-- parent_subscriptions / card_print_orders — un registro de cobro no se
-- borra en cascada al limpiar la card; obliga a una limpieza explícita.

ALTER TABLE external_payments DROP CONSTRAINT IF EXISTS external_payments_amount_check;
ALTER TABLE external_payments ADD CONSTRAINT external_payments_amount_check
  CHECK (amount_cents >= 0);

--    'bizum'         = Bizum (dominante en clubes de cantera).
--    'efectivo'      = cash a la puerta del vestuario.
--    'transferencia' = transferencia bancaria suelta.
--    'otro'          = cualquier otro canal manual.
ALTER TABLE external_payments DROP CONSTRAINT IF EXISTS external_payments_method_check;
ALTER TABLE external_payments ADD CONSTRAINT external_payments_method_check
  CHECK (method IN ('bizum','efectivo','transferencia','otro'));

CREATE INDEX IF NOT EXISTS idx_external_payments_club
  ON external_payments (organization_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_payments_card
  ON external_payments (card_slug, paid_at DESC);

-- Un número de recibo no puede repetirse (cuando se rellena).
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_payments_receipt
  ON external_payments (receipt_number)
  WHERE receipt_number IS NOT NULL;

-- 3. Row Level Security ---------------------------------------
--    Política operativa del repo (supabase/RLS.md): tabla nueva →
--    RLS habilitado + REVOKE a anon/authenticated. Acceso sólo via
--    service_role desde Netlify Functions.
ALTER TABLE external_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON external_payments FROM anon, authenticated;

-- ============================================================
-- CONTRAMIGRACIÓN (si se aparca Bizum/efectivo o el carril entero).
-- Ejecutar SÓLO con cero filas en external_payments.
--
--   BEGIN;
--   DROP TABLE IF EXISTS external_payments CASCADE;
--   ALTER TABLE member_club_seasons
--     DROP COLUMN IF EXISTS previous_club_name;
--   COMMIT;
--
-- Nota: previous_club_name es nullable y sin default → el DROP no
-- afecta ninguna query del carril autónomo ni B2B genérico.
-- ============================================================
