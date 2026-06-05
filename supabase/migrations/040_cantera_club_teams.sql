-- ============================================================
-- 040_cantera_club_teams.sql · Equipos gestionados del club
-- (CANTERA). El coordinador define los equipos reales del club
-- (p.ej. "Cadete A", "Alevín B"), cada uno compitiendo en UNA
-- categoría, y la plantilla asigna jugadores a esos equipos en
-- vez de teclear un texto libre por ficha.
--
-- Motivación: hasta ahora `member_club_seasons.team_name` era texto
-- libre → typos ("Alevín A" vs "alevin a"), imposible filtrar de forma
-- fiable ni agrupar por equipo. Con una entidad gestionada por club:
--   - la asignación es un desplegable consistente,
--   - se puede filtrar/agrupar la plantilla por equipo,
--   - desbloquea (fase 2) acciones por equipo en Carnets/Cobros.
--
-- `team_name` se conserva como espejo denormalizado (lo siguen leyendo
-- billing_matrix/CSV); cuando hay team_id, org-panel lo sincroniza con el
-- nombre del equipo. Sin team_id, el texto libre antiguo se sigue viendo.
--
-- Ejecutar manualmente en Supabase SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS club_teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL,
  category_id      uuid NOT NULL REFERENCES sports_categories(id),
  color            text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Color opcional, sólo #RRGGBB cuando viene (espejo del CHECK de
-- organizations.color_primary de la 019).
ALTER TABLE club_teams DROP CONSTRAINT IF EXISTS club_teams_color_check;
ALTER TABLE club_teams ADD CONSTRAINT club_teams_color_check
  CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');

-- Un club no puede tener dos equipos vivos con el mismo nombre
-- (case-insensitive). Los soft-deleted no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_teams_name
  ON club_teams (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_teams_org
  ON club_teams (organization_id, sort_order)
  WHERE deleted_at IS NULL;

-- El jugador apunta a su equipo gestionado. ON DELETE SET NULL: si un
-- equipo se borra en duro, sus jugadores quedan "sin equipo" en vez de
-- romper la fila (el soft-delete del club lo hace explícito en org-panel).
ALTER TABLE member_club_seasons
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES club_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_member_seasons_team
  ON member_club_seasons (team_id)
  WHERE team_id IS NOT NULL;

-- RLS on + REVOKE desde el arranque (patrón Cantera 033/034/035/039). El
-- acceso es exclusivamente vía SUPABASE_SERVICE_KEY (salta RLS); anon /
-- authenticated quedan denegados por defecto.
ALTER TABLE club_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_teams FROM anon, authenticated;

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE member_club_seasons DROP COLUMN IF EXISTS team_id;
-- DROP TABLE IF EXISTS club_teams;
