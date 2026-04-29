-- ============================================================
-- Fase 4: Perfiles semilla (escaparate)
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_seed boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cards_seed ON cards (is_seed) WHERE is_seed = true;
