-- ============================================================
-- 028_org_panel_last_login.sql
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Sprint Bloque 2 #1 — Panel cliente B2B self-serve.
--
-- Añade un timestamp puramente informativo para que el founder
-- pueda ver desde admin-orgs cuándo entró por última vez el cliente
-- a su panel `/panel.html`. NO se usa como signal de auth, NO bloquea
-- nada. Es nullable: orgs que nunca usaron el panel quedan en NULL.
--
-- El panel autentica vía magic-link (organizations.email) + JWT 7d
-- firmado por servidor. No hay tabla nueva — el `email` ya existente
-- en organizations es el lookup key.
--
-- Reversibilidad:
--   ALTER TABLE organizations DROP COLUMN IF EXISTS panel_last_login_at;
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS panel_last_login_at timestamptz;

-- Índice parcial sobre email para que el lookup del magic-link
-- (panel-auth.js → SELECT … WHERE email = $1 AND deleted_at IS NULL)
-- escale sin full scan cuando haya cientos de orgs.
CREATE INDEX IF NOT EXISTS organizations_email_active_idx
  ON organizations (email)
  WHERE email IS NOT NULL AND deleted_at IS NULL;
