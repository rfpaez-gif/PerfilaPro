-- ============================================================
-- Fase 1: Audit log de acciones admin
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text        NOT NULL,
  entity_slug text        NOT NULL,
  field       text,
  old_value   text,
  new_value   text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON admin_audit_log (entity_slug);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log (created_at DESC);
