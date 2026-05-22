-- ============================================================
-- 032_cards_offboard_trail.sql
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Preserva la atribución cuando una card B2B sale del equipo de una
-- organización vía offboard_card (admin-orgs) u offboard_member (panel
-- cliente, próximo commit). Permite al founder ver "miembros dados de
-- baja recientemente de [Org]" y revertir el offboard con restore_member.
--
-- Semántica del offboard ya existente:
--   - organization_id = NULL (sale del equipo)
--   - plan = 'base', expires_at = NOW+90d (cortesía gratis)
--   - reset reminders
--   - email al trabajador
--
-- Con esta migración añadimos:
--   - previous_organization_id: a qué org pertenecía antes
--   - offboarded_at: cuándo se dio de baja
--   - offboarded_by: quién disparó la baja ('client' = panel; 'founder'
--     = admin-orgs)
--
-- Cuando un restore_member ocurre:
--   - organization_id = previous_organization_id
--   - plan = 'b2b', expires_at = NULL
--   - previous_organization_id = NULL, offboarded_at = NULL, offboarded_by = NULL
--
-- Reversibilidad:
--   ALTER TABLE cards DROP COLUMN IF EXISTS offboarded_by;
--   ALTER TABLE cards DROP COLUMN IF EXISTS offboarded_at;
--   ALTER TABLE cards DROP COLUMN IF EXISTS previous_organization_id;
-- ============================================================

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS previous_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS offboarded_at timestamptz;

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS offboarded_by text;

-- CHECK idempotente: si la constraint ya existe, no falla.
DO $$ BEGIN
  ALTER TABLE cards
    ADD CONSTRAINT cards_offboarded_by_check
    CHECK (offboarded_by IS NULL OR offboarded_by IN ('client', 'founder'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice para la lista del founder "miembros recientemente dados de baja
-- de [Org]". Parcial sobre offboarded_at IS NOT NULL para no inflar el
-- índice con la inmensa mayoría de cards activas.
CREATE INDEX IF NOT EXISTS cards_recently_offboarded_idx
  ON cards (previous_organization_id, offboarded_at DESC)
  WHERE offboarded_at IS NOT NULL;
