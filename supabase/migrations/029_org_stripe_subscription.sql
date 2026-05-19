-- ============================================================
-- 029_org_stripe_subscription.sql · Bloque C · Stripe Subscription B2B
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Persiste el estado de Stripe Subscription por organización + la
-- atribución comercial al agente que cerró la venta. La tabla
-- org_invoices guarda histórico de invoice.paid para que el portal
-- de agentes (/agente) calcule comisión recurrente sin re-llamar
-- a Stripe en cada carga.
--
-- Reversible: todas las columnas nullable, sin default. Si el carril
-- B2B se aparca, las orgs creadas manualmente (admin-orgs) siguen
-- funcionando porque jamás se rellenan estos campos.
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

-- 1. Atribución agente comercial → organización.
--    NULL = bolsa founder (venta directa o pre-Stripe). El admin
--    puede reasignar en Bloque D desde admin-orgs.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agent_code text;

CREATE INDEX IF NOT EXISTS idx_organizations_agent_code
  ON organizations (agent_code)
  WHERE agent_code IS NOT NULL AND deleted_at IS NULL;

-- 2. Stripe metadata persistente.
--    stripe_customer_id se usa en customer.subscription.* para
--    resolver la org cuando Stripe sólo manda el customer.
--    stripe_subscription_id es la clave de upsert (UNIQUE).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id     text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tier                   text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cycle                  text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seats                  integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status    text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end     timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id
  ON organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- 3. Constraints de tier/cycle (NULL permitido para orgs pre-Stripe).
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_tier_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_tier_check
  CHECK (tier IS NULL OR tier IN ('team', 'org', 'enterprise'));

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_cycle_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_cycle_check
  CHECK (cycle IS NULL OR cycle IN ('monthly', 'annual'));

-- 4. Histórico de invoices recurrentes B2B.
--    Una fila por cada invoice.paid recibido del webhook. Permite
--    calcular comisión del agente, MRR por mes y churn sin llamadas
--    a Stripe API en runtime.
--
--    agent_code se persiste como SNAPSHOT al momento del invoice:
--    si la org cambia de agente (admin reasigna), los invoices ya
--    pagados conservan su atribución histórica.
CREATE TABLE IF NOT EXISTS org_invoices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid REFERENCES organizations(id),
  stripe_invoice_id      text UNIQUE NOT NULL,
  stripe_subscription_id text,
  amount_cents           integer NOT NULL,
  currency               text NOT NULL DEFAULT 'eur',
  period_start           timestamptz,
  period_end             timestamptz,
  paid_at                timestamptz NOT NULL,
  agent_code             text,
  tier                   text,
  cycle                  text,
  seats                  integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_invoices_agent_code
  ON org_invoices (agent_code, paid_at DESC)
  WHERE agent_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_invoices_org
  ON org_invoices (organization_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_invoices_subscription
  ON org_invoices (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ============================================================
-- Notas:
--   * NO se añaden cambios a la tabla agents — el flujo seat-based
--     reusa agents.commission_rate (% por defecto 15) sobre el
--     amount del invoice. L2-on-L1 override 5% sigue aplicando.
--   * subscription_status mapea 1:1 a los valores de Stripe:
--     'active' | 'past_due' | 'canceled' | 'incomplete' |
--     'incomplete_expired' | 'trialing' | 'unpaid' | 'paused'.
--     Sin CHECK constraint para no acoplarnos a un enum si Stripe
--     añade estados nuevos.
--   * org_invoices.currency con default 'eur' — todos los pagos del
--     piloto van en euros. Si llega un invoice en otra divisa, se
--     persiste tal cual y la conversión a comisión queda como deuda
--     consciente (alertar al founder por log).
-- ============================================================
