-- ============================================================
-- 033_cantera_v1.sql · Vertical deporte base (Cantera)
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Activa el carril sports_club sobre la infra B2B existente.
-- Cero impacto en orgs/cards preexistentes: card_kind default
-- 'autonomo', organizations.kind default NULL (= business legacy).
--
-- Gate runtime: env var CANTERA_VERTICAL_ACTIVE=1. Sin ella, los
-- endpoints del carril devuelven 410 Gone aunque las tablas existan.
--
-- Reversible: contramigración documentada al final del archivo y
-- en CLAUDE.md (sección "Cantera · vertical deporte base").
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Discriminador de tipo de organización ---------------------
--    'business'      = B2B genérico (despachos, consultoras, ...).
--    'sports_club'   = club deportivo (carril Cantera).
--    NULL legacy     = orgs creadas pre-033, tratadas como business.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS kind  text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sport text;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_kind_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_kind_check
  CHECK (kind IS NULL OR kind IN ('business','sports_club'));

-- Sin CHECK en sport: el catálogo vivo es sports_categories. Permite
-- añadir deportes nuevos sin migración.

CREATE INDEX IF NOT EXISTS idx_organizations_sports_club
  ON organizations (sport)
  WHERE kind = 'sports_club' AND deleted_at IS NULL;

-- 2. Stripe Connect Standard ----------------------------------
--    Sólo se rellena para kind='sports_club'. La cuota mensual
--    padre→club pasa por la cuenta conectada del club; PerfilaPro
--    cobra application_fee_percent definido en env var.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_connect_account_id      text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_connect
  ON organizations (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- 3. Discriminador de tipo de card ----------------------------
--    'autonomo'   = card de profesional individual (carril legacy).
--    'player'     = jugador menor o adulto de un club deportivo.
--    'club_staff' = entrenador/delegado/médico/directivo del club.
--    Default 'autonomo' preserva el comportamiento de cards pre-033.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_kind text NOT NULL DEFAULT 'autonomo';

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_card_kind_check;
ALTER TABLE cards ADD CONSTRAINT cards_card_kind_check
  CHECK (card_kind IN ('autonomo','player','club_staff'));

CREATE INDEX IF NOT EXISTS idx_cards_kind_active
  ON cards (card_kind, organization_id)
  WHERE deleted_at IS NULL;

-- 4. Datos personales del menor (sólo si card_kind='player') --
--    fecha de nacimiento cifrada en reposo con pgcrypto + clave en
--    env var CANTERA_PII_KEY. birth_year en claro (es el único campo
--    necesario para queries de asignación de categoría; revelar año
--    sin día/mes es riesgo bajo).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS birth_date_encrypted bytea;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS birth_year integer;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_gender_check;
ALTER TABLE cards ADD CONSTRAINT cards_gender_check
  CHECK (gender IS NULL OR gender IN ('M','F','X'));

-- Rango razonable y estático para no acoplar a EXTRACT(now()) en CHECK
-- (las funciones non-IMMUTABLE no se permiten). El sanity check
-- contextual (no mayor que año actual) vive en el backend.
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_birth_year_check;
ALTER TABLE cards ADD CONSTRAINT cards_birth_year_check
  CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= 2200));

-- 5. Visibilidad pública por defecto OFF para menores ---------
--    card.js gatea el render de /c/:slug por este flag cuando
--    card_kind='player'. Sin él, /c/:slug devuelve 404. Para
--    autónomos preexistentes el default true preserva el render
--    actual (los autónomos siempre han sido públicos).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS public_card boolean NOT NULL DEFAULT true;

-- 6. Multi-admin sobre la card --------------------------------
--    Reemplaza el modelo single-token cards.edit_token sólo cuando
--    card_kind='player'. Padre + madre + tutor secundario + el
--    propio jugador (a partir de los 16, opt-in parental).
--
--    Para autónomos sigue usándose cards.edit_token in-place — no
--    se migran datos preexistentes.
CREATE TABLE IF NOT EXISTS card_admins (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug              text NOT NULL REFERENCES cards(slug) ON DELETE CASCADE,
  email                  text NOT NULL,
  role                   text NOT NULL,
  edit_token             text,
  edit_token_expires_at  timestamptz,
  invited_at             timestamptz NOT NULL DEFAULT now(),
  accepted_at            timestamptz,
  revoked_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_slug, email)
);

ALTER TABLE card_admins DROP CONSTRAINT IF EXISTS card_admins_role_check;
ALTER TABLE card_admins ADD CONSTRAINT card_admins_role_check
  CHECK (role IN ('tutor_legal','tutor_secundario','player_self','club_admin'));

CREATE INDEX IF NOT EXISTS idx_card_admins_card_active
  ON card_admins (card_slug)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_admins_edit_token
  ON card_admins (edit_token)
  WHERE edit_token IS NOT NULL AND revoked_at IS NULL;

-- 7. Audit trail LOPDGDD (append-only) ------------------------
--    Sin UPDATE ni DELETE. RLS lo refuerza más abajo. Esto es lo
--    que el inspector AEPD pediría ver en una hipotética inspección.
CREATE TABLE IF NOT EXISTS card_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug        text NOT NULL REFERENCES cards(slug) ON DELETE RESTRICT,
  consent_type     text NOT NULL,
  granted_by_email text NOT NULL,
  granted_by_role  text NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  ip_address       inet,
  user_agent       text,
  evidence_jsonb   jsonb,
  related_club_id  uuid REFERENCES organizations(id),
  related_season   text
);

ALTER TABLE card_consents DROP CONSTRAINT IF EXISTS card_consents_type_check;
ALTER TABLE card_consents ADD CONSTRAINT card_consents_type_check
  CHECK (consent_type IN (
    'parental_initial',
    'data_processing',
    'public_visibility',
    'club_handoff',
    'image_rights',
    'transfer_to_player'
  ));

ALTER TABLE card_consents DROP CONSTRAINT IF EXISTS card_consents_granted_by_role_check;
ALTER TABLE card_consents ADD CONSTRAINT card_consents_granted_by_role_check
  CHECK (granted_by_role IN ('tutor_legal','tutor_secundario','player_self','club_admin'));

CREATE INDEX IF NOT EXISTS idx_card_consents_card
  ON card_consents (card_slug, granted_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_consents_type
  ON card_consents (consent_type, granted_at DESC);

-- 8. Catálogo de categorías deportivas ------------------------
--    Lookup table multi-deporte. Seed inicial sólo fútbol; el resto
--    de deportes se añade vía UPSERT en migraciones posteriores
--    sin tocar este archivo.
CREATE TABLE IF NOT EXISTS sports_categories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport                 text NOT NULL,
  code                  text NOT NULL,
  display_name_es       text NOT NULL,
  display_name_ca       text,
  min_birth_year_offset integer,
  max_birth_year_offset integer,
  sort_order            integer NOT NULL DEFAULT 0,
  UNIQUE (sport, code)
);

CREATE INDEX IF NOT EXISTS idx_sports_categories_sport
  ON sports_categories (sport, sort_order);

-- 9. CORE · histórico relacional miembro ↔ club --------------
--    Una fila por (card, club, temporada, role). Para jugadores
--    lleva dorsal/posición/categoría/stats. Para staff (entrenador,
--    delegado, médico, presidente) esos campos quedan NULL y
--    discrimina el `role`.
--
--    closed_snapshot_jsonb se rellena al cerrar (left_at no NULL):
--    congela stats + dorsal + categoría a la fecha de cierre. Hist
--    inmutable aunque luego cambien las stats por correcciones.
CREATE TABLE IF NOT EXISTS member_club_seasons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug             text NOT NULL REFERENCES cards(slug) ON DELETE CASCADE,
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  season                text NOT NULL,
  role                  text NOT NULL,
  category_id           uuid REFERENCES sports_categories(id),
  team_name             text,
  dorsal                integer,
  position              text,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  left_at               timestamptz,
  exit_reason           text,
  stats_jsonb           jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_snapshot_jsonb jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE member_club_seasons DROP CONSTRAINT IF EXISTS member_club_seasons_role_check;
ALTER TABLE member_club_seasons ADD CONSTRAINT member_club_seasons_role_check
  CHECK (role IN (
    'jugador',
    'entrenador',
    'delegado',
    'medico',
    'fisio',
    'preparador',
    'presidente',
    'directiva',
    'otro'
  ));

ALTER TABLE member_club_seasons DROP CONSTRAINT IF EXISTS member_club_seasons_exit_reason_check;
ALTER TABLE member_club_seasons ADD CONSTRAINT member_club_seasons_exit_reason_check
  CHECK (exit_reason IS NULL OR exit_reason IN (
    'fichaje',
    'baja',
    'fin_temporada',
    'expulsion',
    'baja_voluntaria',
    'cese_actividad'
  ));

ALTER TABLE member_club_seasons DROP CONSTRAINT IF EXISTS member_club_seasons_dorsal_only_player;
ALTER TABLE member_club_seasons ADD CONSTRAINT member_club_seasons_dorsal_only_player
  CHECK (dorsal IS NULL OR role = 'jugador');

ALTER TABLE member_club_seasons DROP CONSTRAINT IF EXISTS member_club_seasons_closed_consistency;
ALTER TABLE member_club_seasons ADD CONSTRAINT member_club_seasons_closed_consistency
  CHECK (
    (left_at IS NULL AND closed_snapshot_jsonb IS NULL AND exit_reason IS NULL) OR
    (left_at IS NOT NULL)
  );

-- Una sola membership activa por (card, club, role) — un mismo
-- chaval no puede ser jugador dos veces en el mismo club. Permite
-- que sea jugador Y delegado a la vez (caso raro pero válido).
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_active_per_club_role
  ON member_club_seasons (card_slug, organization_id, role)
  WHERE left_at IS NULL;

-- Regla federativa: un jugador no puede estar fichado por dos
-- clubes a la vez. Para multi-deporte futuro este índice se relaja
-- a (card_slug, sport) cuando se añada `sport` snapshot en la fila.
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_active_globally
  ON member_club_seasons (card_slug)
  WHERE left_at IS NULL AND role = 'jugador';

CREATE INDEX IF NOT EXISTS idx_member_by_club_active
  ON member_club_seasons (organization_id, role, category_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_by_card_history
  ON member_club_seasons (card_slug, joined_at DESC);

-- 10. Pedido de carnet físico PVC + NFC -----------------------
--     Lo dispara el Studio del club: setup fee 19€ × N fichajes.
--     El cobro va directo a PerfilaPro (no Connect). Al confirmar
--     payment, status pasa de pending→paid y se genera el PDF.
CREATE TABLE IF NOT EXISTS card_print_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug                text NOT NULL REFERENCES cards(slug),
  organization_id          uuid REFERENCES organizations(id),
  season                   text,
  status                   text NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id text,
  shipping_address         jsonb,
  tracking_carrier         text,
  tracking_number          text,
  nfc_uid                  text,
  amount_cents             integer,
  kind                     text NOT NULL DEFAULT 'setup',
  ordered_at               timestamptz NOT NULL DEFAULT now(),
  shipped_at               timestamptz,
  delivered_at             timestamptz,
  notes                    text
);

ALTER TABLE card_print_orders DROP CONSTRAINT IF EXISTS card_print_orders_status_check;
ALTER TABLE card_print_orders ADD CONSTRAINT card_print_orders_status_check
  CHECK (status IN (
    'pending',
    'paid',
    'sent_to_printer',
    'shipped',
    'delivered',
    'failed',
    'refunded'
  ));

ALTER TABLE card_print_orders DROP CONSTRAINT IF EXISTS card_print_orders_kind_check;
ALTER TABLE card_print_orders ADD CONSTRAINT card_print_orders_kind_check
  CHECK (kind IN ('setup','renewal','replacement'));

CREATE INDEX IF NOT EXISTS idx_print_orders_status
  ON card_print_orders (status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_orders_club
  ON card_print_orders (organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_print_orders_nfc_uid
  ON card_print_orders (nfc_uid)
  WHERE nfc_uid IS NOT NULL;

-- 11. Cuotas mensuales padre→club (Stripe Connect) ------------
--     Diferenciada de org_invoices (que es para B2B genérico no
--     Connect). Aquí el cobro llega a la cuenta conectada del club
--     con application_fee_percent que cae en la cuenta platform.
CREATE TABLE IF NOT EXISTS parent_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug              text NOT NULL REFERENCES cards(slug),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  parent_email           text NOT NULL,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  amount_cents           integer NOT NULL,
  application_fee_bps    integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'incomplete',
  current_period_end     timestamptz,
  started_at             timestamptz NOT NULL DEFAULT now(),
  canceled_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_parent_subs_card
  ON parent_subscriptions (card_slug)
  WHERE canceled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parent_subs_club
  ON parent_subscriptions (organization_id)
  WHERE canceled_at IS NULL;

-- 12. Stats por partido (granularidad fina, opcional) ---------
--     stats_jsonb en member_club_seasons agrega. Esta tabla guarda
--     el evento crudo para clubes que usen la app de stats.
CREATE TABLE IF NOT EXISTS match_stats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug       text NOT NULL REFERENCES cards(slug),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  season          text NOT NULL,
  match_date      date NOT NULL,
  opponent        text,
  competition     text,
  stats_jsonb     jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_stats_card_season
  ON match_stats (card_slug, season, match_date DESC);

CREATE INDEX IF NOT EXISTS idx_match_stats_club
  ON match_stats (organization_id, match_date DESC);

-- 13. Row Level Security --------------------------------------
--     Regla operativa del repo (commit 1b42a95): tablas nuevas
--     arrancan con RLS habilitado + REVOKE a anon/authenticated.
--     El service_role bypass es lo que usan los Netlify Functions.
ALTER TABLE card_admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_consents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_club_seasons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_print_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_stats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports_categories    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON card_admins          FROM anon, authenticated;
REVOKE ALL ON card_consents        FROM anon, authenticated;
REVOKE ALL ON member_club_seasons  FROM anon, authenticated;
REVOKE ALL ON card_print_orders    FROM anon, authenticated;
REVOKE ALL ON parent_subscriptions FROM anon, authenticated;
REVOKE ALL ON match_stats          FROM anon, authenticated;

-- card_consents: append-only incluso para service_role en runtime.
-- Sin policy de UPDATE ni DELETE — sólo INSERT/SELECT. El service
-- key salta RLS pero esta postura blinda contra un endpoint mal
-- escrito que intente borrar evidencias.
REVOKE UPDATE, DELETE ON card_consents FROM PUBLIC;

-- sports_categories: read-only público (catálogo).
DROP POLICY IF EXISTS sports_categories_read ON sports_categories;
CREATE POLICY sports_categories_read ON sports_categories
  FOR SELECT USING (true);
GRANT SELECT ON sports_categories TO anon, authenticated;

-- 14. Seed inicial categorías fútbol --------------------------
--     Multi-deporte por diseño: para añadir baloncesto/balonmano
--     se crea una migración separada con UPSERTs idempotentes. NO
--     editar este archivo después de aplicado en producción.
INSERT INTO sports_categories
  (sport, code, display_name_es, display_name_ca, min_birth_year_offset, max_birth_year_offset, sort_order) VALUES
  ('futbol','prebenjamin','Prebenjamín','Prebenjamí',  -7,  -6, 10),
  ('futbol','benjamin',   'Benjamín',   'Benjamí',     -9,  -8, 20),
  ('futbol','alevin',     'Alevín',     'Aleví',      -11, -10, 30),
  ('futbol','infantil',   'Infantil',   'Infantil',   -13, -12, 40),
  ('futbol','cadete',     'Cadete',     'Cadet',      -15, -14, 50),
  ('futbol','juvenil',    'Juvenil',    'Juvenil',    -18, -16, 60),
  ('futbol','senior',     'Senior',     'Sènior',     -99, -19, 70)
ON CONFLICT (sport, code) DO NOTHING;

-- ============================================================
-- CONTRAMIGRACIÓN (si se aparca el carril Cantera).
-- Ejecutar SÓLO con CANTERA_VERTICAL_ACTIVE=0 y cero filas
-- en las tablas que se borran. Documentación equivalente en
-- CLAUDE.md sección "Cantera · vertical deporte base".
--
--   BEGIN;
--   DROP TABLE IF EXISTS match_stats          CASCADE;
--   DROP TABLE IF EXISTS parent_subscriptions CASCADE;
--   DROP TABLE IF EXISTS card_print_orders    CASCADE;
--   DROP TABLE IF EXISTS member_club_seasons  CASCADE;
--   DROP TABLE IF EXISTS card_consents        CASCADE;
--   DROP TABLE IF EXISTS card_admins          CASCADE;
--   DROP TABLE IF EXISTS sports_categories    CASCADE;
--   ALTER TABLE organizations
--     DROP COLUMN IF EXISTS stripe_connect_payouts_enabled,
--     DROP COLUMN IF EXISTS stripe_connect_charges_enabled,
--     DROP COLUMN IF EXISTS stripe_connect_account_id,
--     DROP COLUMN IF EXISTS sport,
--     DROP COLUMN IF EXISTS kind;
--   ALTER TABLE cards
--     DROP COLUMN IF EXISTS public_card,
--     DROP COLUMN IF EXISTS gender,
--     DROP COLUMN IF EXISTS birth_year,
--     DROP COLUMN IF EXISTS birth_date_encrypted,
--     DROP COLUMN IF EXISTS card_kind;
--   COMMIT;
--
-- Notas:
--   * card_kind tiene default 'autonomo' NOT NULL → el DROP COLUMN
--     no afecta queries existentes.
--   * organizations.kind es nullable → orgs preexistentes (kind=NULL)
--     siempre se han tratado como business genérico.
-- ============================================================
