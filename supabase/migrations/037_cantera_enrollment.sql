-- Migración 037 · Cantera · inscripción de temporada (capa I0)
--
-- Esquema DORMIDO para la captación masiva de inicio de temporada
-- (docs/cantera-inscripcion-temporada.md). Cero impacto en autónomos,
-- B2B genérico ni el resto del carril Cantera: todo es tabla nueva o
-- columna nullable. Nada se activa hasta que aterricen las capas I1-I7.
--
-- Contiene:
--   1. enrollment_campaigns  — la campaña con enlace público.
--   2. cards.{doc_kind,doc_number,nationality} — puente federativo.
--   3. card_admins.{name,dni,phone} — datos del tutor (federativa+cobros).
--   4. card_documents — DNI/libro de familia/cert. médico (completables
--      después; decisión 2 del diseño).
--   5. parent_subscriptions.{enrollment_campaign_id,matricula_cents,
--      matricula_paid_at} — matrícula one-shot ligada a la suscripción
--      (decisión 1) para que el centro de cobros la concilie.
--
-- Reversible: contramigración al pie.

-- ── 1. Campaña de inscripción ─────────────────────────────
CREATE TABLE IF NOT EXISTS enrollment_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  season            text NOT NULL,
  public_token      text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'open',
  matricula_cents   integer,
  monthly_fee_cents integer,
  num_installments  integer NOT NULL DEFAULT 9,
  concepts_jsonb    jsonb NOT NULL DEFAULT '{}'::jsonb,
  opens_at          timestamptz,
  closes_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE enrollment_campaigns DROP CONSTRAINT IF EXISTS enrollment_campaigns_status_check;
ALTER TABLE enrollment_campaigns ADD CONSTRAINT enrollment_campaigns_status_check
  CHECK (status IN ('open', 'closed'));

ALTER TABLE enrollment_campaigns DROP CONSTRAINT IF EXISTS enrollment_campaigns_amounts_check;
ALTER TABLE enrollment_campaigns ADD CONSTRAINT enrollment_campaigns_amounts_check
  CHECK ((matricula_cents IS NULL OR matricula_cents >= 0)
     AND (monthly_fee_cents IS NULL OR monthly_fee_cents >= 0)
     AND num_installments >= 0);

-- Lookup por club; el público va por public_token (ya único).
CREATE INDEX IF NOT EXISTS idx_enrollment_campaigns_org
  ON enrollment_campaigns (organization_id);

-- Una sola campaña abierta por (club, temporada): evita repartir dos
-- enlaces vivos a la vez. Cerrar la vieja antes de abrir otra.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_campaign_open_unique
  ON enrollment_campaigns (organization_id, season)
  WHERE status = 'open';

-- ── 2. Puente federativo en la card del jugador ───────────
-- Nullable: solo se rellena para card_kind='player'. Identidad flexible
-- (un alevín sin DNI usa libro de familia + DNI del tutor).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS doc_kind    text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS doc_number  text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS nationality text;

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_doc_kind_check;
ALTER TABLE cards ADD CONSTRAINT cards_doc_kind_check
  CHECK (doc_kind IS NULL OR doc_kind IN ('dni', 'nie', 'pasaporte', 'libro_familia'));

-- ── 3. Datos del tutor (federativa + facturación) ─────────
-- card_admins solo tenía email/role/edit_token; la ficha federativa y la
-- facturación exigen nombre + DNI + teléfono del tutor.
ALTER TABLE card_admins ADD COLUMN IF NOT EXISTS name  text;
ALTER TABLE card_admins ADD COLUMN IF NOT EXISTS dni   text;
ALTER TABLE card_admins ADD COLUMN IF NOT EXISTS phone text;

-- ── 4. Documentos del jugador (completables después) ───────
-- Foto va en cards.foto_url; aquí los documentos federativos que el padre
-- puede subir en la inscripción o más tarde desde el panel (decisión 2).
CREATE TABLE IF NOT EXISTS card_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_slug   text NOT NULL REFERENCES cards(slug) ON DELETE CASCADE,
  kind        text NOT NULL,
  url         text NOT NULL,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE card_documents DROP CONSTRAINT IF EXISTS card_documents_kind_check;
ALTER TABLE card_documents ADD CONSTRAINT card_documents_kind_check
  CHECK (kind IN ('dni', 'libro_familia', 'certificado_medico', 'mutualidad', 'otro'));

CREATE INDEX IF NOT EXISTS idx_card_documents_slug
  ON card_documents (card_slug);

-- ── 5. Matrícula one-shot ligada a la suscripción ─────────
-- La matrícula (decisión 1) se cobra una vez en el mismo checkout que
-- arranca la cuota. Se snapshotea aquí para que el centro de cobros la
-- concilie sin re-consultar Stripe.
ALTER TABLE parent_subscriptions ADD COLUMN IF NOT EXISTS enrollment_campaign_id uuid REFERENCES enrollment_campaigns(id);
ALTER TABLE parent_subscriptions ADD COLUMN IF NOT EXISTS matricula_cents        integer;
ALTER TABLE parent_subscriptions ADD COLUMN IF NOT EXISTS matricula_paid_at      timestamptz;

ALTER TABLE parent_subscriptions DROP CONSTRAINT IF EXISTS parent_subscriptions_matricula_check;
ALTER TABLE parent_subscriptions ADD CONSTRAINT parent_subscriptions_matricula_check
  CHECK (matricula_cents IS NULL OR matricula_cents >= 0);

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE parent_subscriptions DROP CONSTRAINT IF EXISTS parent_subscriptions_matricula_check;
-- ALTER TABLE parent_subscriptions DROP COLUMN IF EXISTS matricula_paid_at;
-- ALTER TABLE parent_subscriptions DROP COLUMN IF EXISTS matricula_cents;
-- ALTER TABLE parent_subscriptions DROP COLUMN IF EXISTS enrollment_campaign_id;
-- DROP INDEX IF EXISTS idx_card_documents_slug;
-- DROP TABLE IF EXISTS card_documents;
-- ALTER TABLE card_admins DROP COLUMN IF EXISTS phone;
-- ALTER TABLE card_admins DROP COLUMN IF EXISTS dni;
-- ALTER TABLE card_admins DROP COLUMN IF EXISTS name;
-- ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_doc_kind_check;
-- ALTER TABLE cards DROP COLUMN IF EXISTS nationality;
-- ALTER TABLE cards DROP COLUMN IF EXISTS doc_number;
-- ALTER TABLE cards DROP COLUMN IF EXISTS doc_kind;
-- DROP INDEX IF EXISTS idx_enrollment_campaign_open_unique;
-- DROP INDEX IF EXISTS idx_enrollment_campaigns_org;
-- DROP TABLE IF EXISTS enrollment_campaigns;
-- ── Fin contramigración ───────────────────────────────────
