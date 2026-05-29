-- ============================================================
-- 035_cantera_transfers.sql · Cantera capa 3b · handoff transaccional
-- Ejecutar manualmente en Supabase SQL Editor, después de 033/034.
--
-- Aterriza el traspaso de un jugador entre clubes PerfilaPro (camino 2
-- del fichaje). La atomicidad NO se delega a la app: vive en funciones
-- SECURITY DEFINER que corren en una única transacción Postgres, así un
-- fallo a media operación revierte TODO (cerrar fila vieja + abrir nueva
-- + UPDATE cards.organization_id + consentimiento). La Data API no tiene
-- transacción multi-statement; por eso esto es SQL.
--
-- Idempotente. Reversible: contramigración al final.
-- ============================================================

-- 1. Solicitud de traspaso entre clubes ------------------------
--    Flujo: el club que ficha (to_org) crea la solicitud 'pending';
--    el tutor legal la acepta (ejecuta cantera_execute_transfer); el
--    founder puede forzar/cancelar desde admin-orgs.
CREATE TABLE IF NOT EXISTS club_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug          text NOT NULL REFERENCES cards(slug) ON DELETE CASCADE,
  from_org_id        uuid REFERENCES organizations(id),
  to_org_id          uuid NOT NULL REFERENCES organizations(id),
  requested_by_email text NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  season             text NOT NULL,
  dorsal             integer,
  position           text,
  team_name          text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by_email  text
);

ALTER TABLE club_transfers DROP CONSTRAINT IF EXISTS club_transfers_status_check;
ALTER TABLE club_transfers ADD CONSTRAINT club_transfers_status_check
  CHECK (status IN ('pending', 'accepted', 'cancelled', 'rejected'));

ALTER TABLE club_transfers DROP CONSTRAINT IF EXISTS club_transfers_dorsal_check;
ALTER TABLE club_transfers ADD CONSTRAINT club_transfers_dorsal_check
  CHECK (dorsal IS NULL OR dorsal >= 0);

-- Un solo traspaso pendiente por jugador a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_transfers_pending_card
  ON club_transfers (card_slug) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_club_transfers_to_org
  ON club_transfers (to_org_id, status);
CREATE INDEX IF NOT EXISTS idx_club_transfers_from_org
  ON club_transfers (from_org_id, status);

-- 2. card_consents: admitir granted_by_role='founder' ----------
--    El override del founder (force-accept de un traspaso atascado)
--    registra el consentimiento club_handoff a su nombre. Honestidad
--    del audit trail: no se disfraza de tutor.
ALTER TABLE card_consents DROP CONSTRAINT IF EXISTS card_consents_granted_by_role_check;
ALTER TABLE card_consents ADD CONSTRAINT card_consents_granted_by_role_check
  CHECK (granted_by_role IN ('tutor_legal', 'tutor_secundario', 'player_self', 'club_admin', 'founder'));

-- 3. RPC atómica · ejecutar traspaso ---------------------------
--    Cierra la membresía activa de jugador (snapshot inmutable),
--    resuelve la categoría en el club nuevo desde birth_year + sport,
--    abre la membresía nueva, actualiza el club denormalizado y graba
--    el consentimiento club_handoff. Todo en una transacción.
CREATE OR REPLACE FUNCTION cantera_execute_transfer(
  p_transfer_id uuid,
  p_actor_email text,
  p_actor_role  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t            club_transfers%ROWTYPE;
  v_old        member_club_seasons%ROWTYPE;
  v_new_id     uuid;
  v_category   uuid;
  v_season_yr  int;
BEGIN
  SELECT * INTO t FROM club_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;

  -- Cierra la membresía de jugador activa (si la hay) congelando snapshot.
  SELECT * INTO v_old FROM member_club_seasons
    WHERE card_slug = t.card_slug AND left_at IS NULL AND role = 'jugador'
    FOR UPDATE;
  IF FOUND THEN
    UPDATE member_club_seasons
      SET left_at = now(),
          exit_reason = 'fichaje',
          closed_snapshot_jsonb = jsonb_build_object(
            'dorsal', v_old.dorsal, 'position', v_old.position,
            'category_id', v_old.category_id, 'team_name', v_old.team_name,
            'stats', v_old.stats_jsonb, 'organization_id', v_old.organization_id,
            'season', v_old.season)
      WHERE id = v_old.id;
  END IF;

  -- Categoría en el club nuevo (birth_year + offsets del catálogo).
  v_season_yr := split_part(t.season, '-', 1)::int;
  SELECT sc.id INTO v_category
    FROM cards c
    JOIN organizations o  ON o.id = t.to_org_id
    JOIN sports_categories sc ON sc.sport = o.sport
   WHERE c.slug = t.card_slug
     AND c.birth_year IS NOT NULL
     AND c.birth_year BETWEEN (v_season_yr + sc.min_birth_year_offset)
                          AND (v_season_yr + sc.max_birth_year_offset)
   ORDER BY sc.sort_order
   LIMIT 1;

  -- Abre la membresía nueva.
  INSERT INTO member_club_seasons
    (card_slug, organization_id, season, role, category_id, team_name, dorsal, position)
    VALUES (t.card_slug, t.to_org_id, t.season, 'jugador', v_category, t.team_name, t.dorsal, t.position)
    RETURNING id INTO v_new_id;

  -- Club actual denormalizado.
  UPDATE cards SET organization_id = t.to_org_id WHERE slug = t.card_slug;

  -- Consentimiento append-only.
  INSERT INTO card_consents
    (card_slug, consent_type, granted_by_email, granted_by_role, related_club_id, related_season)
    VALUES (t.card_slug, 'club_handoff', p_actor_email, p_actor_role, t.from_org_id, t.season);

  -- Marca el traspaso aceptado.
  UPDATE club_transfers
    SET status = 'accepted', resolved_at = now(), resolved_by_email = p_actor_email
    WHERE id = t.id;

  RETURN jsonb_build_object('ok', true, 'new_membership_id', v_new_id, 'category_id', v_category);
END;
$$;

-- 4. RPC atómica · cerrar membresía (baja / fichaje off-platform)
--    Cierra la membresía activa de jugador y deja la card sin club
--    activo. Un único statement lógico, transacción Postgres.
CREATE OR REPLACE FUNCTION cantera_close_membership(
  p_card_slug   text,
  p_exit_reason text,
  p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old member_club_seasons%ROWTYPE;
BEGIN
  SELECT * INTO v_old FROM member_club_seasons
    WHERE card_slug = p_card_slug AND left_at IS NULL AND role = 'jugador'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_active_membership'; END IF;

  UPDATE member_club_seasons
    SET left_at = now(),
        exit_reason = p_exit_reason,
        closed_snapshot_jsonb = jsonb_build_object(
          'dorsal', v_old.dorsal, 'position', v_old.position,
          'category_id', v_old.category_id, 'team_name', v_old.team_name,
          'stats', v_old.stats_jsonb, 'organization_id', v_old.organization_id,
          'season', v_old.season)
    WHERE id = v_old.id;

  UPDATE cards SET organization_id = NULL WHERE slug = p_card_slug;

  -- Cancela cualquier traspaso pendiente (queda sin sentido).
  UPDATE club_transfers SET status = 'cancelled', resolved_at = now()
    WHERE card_slug = p_card_slug AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'closed_membership_id', v_old.id);
END;
$$;

-- 5. RLS + grants ---------------------------------------------
ALTER TABLE club_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_transfers FROM anon, authenticated;

-- Las funciones SECURITY DEFINER solo deben invocarse desde las Netlify
-- Functions (service_role). Fuera de PUBLIC; explícito a service_role.
REVOKE ALL ON FUNCTION cantera_execute_transfer(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION cantera_close_membership(text, text, text)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cantera_execute_transfer(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION cantera_close_membership(text, text, text)  TO service_role;

-- ============================================================
-- CONTRAMIGRACIÓN
--   BEGIN;
--   DROP FUNCTION IF EXISTS cantera_close_membership(text, text, text);
--   DROP FUNCTION IF EXISTS cantera_execute_transfer(uuid, text, text);
--   DROP TABLE IF EXISTS club_transfers CASCADE;
--   -- (opcional) revertir el CHECK de card_consents a la lista de 033:
--   -- ALTER TABLE card_consents DROP CONSTRAINT IF EXISTS card_consents_granted_by_role_check;
--   -- ALTER TABLE card_consents ADD CONSTRAINT card_consents_granted_by_role_check
--   --   CHECK (granted_by_role IN ('tutor_legal','tutor_secundario','player_self','club_admin'));
--   COMMIT;
-- ============================================================
