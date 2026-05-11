-- ============================================================
-- 021_b2b_leads.sql · Persistencia de leads del form /es/empresas
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Sprint 3 · pieza A · onboarding B2B con pre-relleno.
--
-- Hoy el form de /es/empresas solo envía un email a B2B_LEAD_INBOX.
-- Si el email se pierde, el lead se pierde. Esta tabla lo persiste y
-- añade un magic-link de un solo uso para que el lead aterrice en
-- /es/onboarding?token=… con sus datos ya rellenados.
--
-- Idempotente: re-ejecutar no rompe nada (uses IF NOT EXISTS).
-- Reversible: DROP TABLE b2b_leads y borrar las dos referencias en
--             lead-b2b.js (insert + magic-link email).
-- ============================================================

CREATE TABLE IF NOT EXISTS b2b_leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 48 chars hex (24 bytes) — mismo orden de magnitud que cards.edit_token (64
  -- chars hex / 32 bytes) pero más corto para que el magic-link entre en una
  -- línea de email sin wraps raros. Único + indexed para lookup O(1).
  invite_token    text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  name            text NOT NULL,
  company         text NOT NULL,
  email           text NOT NULL,
  team_size       text NOT NULL,
  sector          text NOT NULL,
  message         text,
  idioma          text NOT NULL DEFAULT 'es' CHECK (idioma IN ('es','ca')),
  -- NULL hasta que el admin asocia el lead a una org concreta desde Studio.
  -- ON DELETE SET NULL: si la org se soft-deleta y se purga, el lead queda
  -- huérfano pero el endpoint sigue siendo redimible (sin branding).
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  redeemed_at     timestamptz,
  -- ON DELETE SET NULL: si la card se borra por GDPR, el lead conserva su
  -- historial de redención sin colgar la integridad referencial.
  redeemed_card_slug text REFERENCES cards(slug) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS b2b_leads_email_idx ON b2b_leads(email);
CREATE INDEX IF NOT EXISTS b2b_leads_token_idx ON b2b_leads(invite_token);
-- Índice parcial: solo los leads pendientes (redeemed_at IS NULL). El admin
-- Studio filtra principalmente "pendientes de redimir" y este index sirve esa
-- query directamente. Cuando un lead se redime, sale del índice (ocupa cero).
CREATE INDEX IF NOT EXISTS b2b_leads_redeemed_idx
  ON b2b_leads(redeemed_at)
  WHERE redeemed_at IS NULL;

-- ============================================================
-- Notas operativas
-- ============================================================
--   * GDPR: la tabla contiene PII (nombre, email, organización). Cualquier
--     petición de borrado por email se ejecuta con DELETE FROM b2b_leads
--     WHERE email = $1 — el lead no puede ejercer GDPR vía edit-token porque
--     todavía no tiene card. Documentar en privacidad.html cuando se publique
--     el endpoint de export/delete por email.
--
--   * Idempotencia de redención: register-free.js y stripe-webhook.js solo
--     deben marcar redeemed_at si llega NULL. Un token redimido no se puede
--     reusar (onboarding-prefill devuelve 404). El backend NO regenera tokens
--     automáticamente — si el lead pierde el email, el admin lo reenvía desde
--     /admin-orgs (acción explícita, auditable).
-- ============================================================
