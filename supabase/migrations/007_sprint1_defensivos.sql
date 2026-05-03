-- ============================================================
-- 007_sprint1_defensivos.sql · Defensivos pre-Phase 2
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Aprobado por consejo (kick-off Sprint 1):
--   1) soft-delete (deleted_at) en cards para evitar borrados
--      irrecuperables en BD productiva.
--   2) tabla organizations + cards.organization_id defensivo,
--      preparacion para fase 3 (B2B equipos) sin migracion
--      dolorosa cuando llegue.
--
-- Coste de aplicar: ~1 minuto. Coste de no aplicar y tener
-- que migrar en fase 3 con cards reales en BD: dias.
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

-- 1. Soft delete en cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Indice parcial para acelerar las queries que filtran "no borradas"
CREATE INDEX IF NOT EXISTS idx_cards_active_slug
  ON cards (slug)
  WHERE deleted_at IS NULL;

-- 2. Tabla organizations (vacia, sin logica de negocio aun)
CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  nif         text,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- 3. organization_id en cards (nullable, sin uso aun en fase 1-2)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_cards_organization
  ON cards (organization_id)
  WHERE organization_id IS NOT NULL;

-- ============================================================
-- Notas para Sprint 3 (Stripe Subscription + Quipu integration):
--
-- Las columnas para suscripcion recurrente (subscription_status,
-- stripe_subscription_id, etc.) NO se anaden aqui. Se anadiran
-- cuando se firme el modelo de cobro definitivo y el proveedor
-- de facturacion (Quipu / Holded / FacturaDirecta) este validado.
-- Anadir columnas especulativas hoy genera deuda si el modelo
-- final difiere.
-- ============================================================
