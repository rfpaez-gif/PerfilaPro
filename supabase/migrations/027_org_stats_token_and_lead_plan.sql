-- ============================================================
-- 027_org_stats_token_and_lead_plan.sql
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- DOS cambios sin relación lógica entre sí, agrupados por proximidad
-- de sprint (B2B #4 stats agregadas + #5 pricing público en landing).
-- Idempotente y reversible: ambas columnas son nullable, sin valor
-- por defecto destructivo.
--
-- A) organizations.stats_token + stats_token_expires_at
--    Token público que permite al responsable de una org B2B acceder
--    a un panel de estadísticas agregadas en `/e/:slug/stats?token=...`
--    sin login. Análogo a cards.edit_token (32-byte hex, 64 chars) pero
--    aplicado a la organización en lugar del miembro individual.
--    Lo genera el founder desde admin-orgs (acción org_get_stats_link)
--    y lo comparte con el cliente B2B. TTL típica 90 días, refresco
--    explícito por el admin.
--
-- B) b2b_leads.plan_interes
--    El form de /es/empresas y /ca/empresas ahora muestra pricing en
--    3 tiers (equipo, organizacion, enterprise). El visitante puede
--    pulsar el CTA de cualquier tier y eso pre-rellena el campo
--    "plan de interés" para que el founder sepa por qué tier llega
--    el lead sin tener que preguntárselo.
-- ============================================================

-- A) Stats token para organizaciones ----------------------------------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stats_token            text,
  ADD COLUMN IF NOT EXISTS stats_token_expires_at timestamptz;

-- Unicidad parcial: dos orgs no pueden compartir token activo. Solo
-- aplica cuando el token está set; orgs sin token (la inmensa mayoría
-- hasta que el founder genera el primero) no entran en el índice.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stats_token_idx
  ON organizations (stats_token)
  WHERE stats_token IS NOT NULL;

-- B) Plan de interés en leads B2B -------------------------------------

ALTER TABLE b2b_leads
  ADD COLUMN IF NOT EXISTS plan_interes text;

-- CHECK ligero: enum cerrado de tiers + 'no_se' (default cuando el
-- lead llega por el form sin pulsar CTA de pricing). NULL permitido
-- para retrocompatibilidad con leads anteriores a esta migración.
ALTER TABLE b2b_leads
  DROP CONSTRAINT IF EXISTS b2b_leads_plan_interes_check;
ALTER TABLE b2b_leads
  ADD CONSTRAINT b2b_leads_plan_interes_check
  CHECK (plan_interes IS NULL OR plan_interes IN ('equipo','organizacion','enterprise','no_se'));

-- ============================================================
-- Reversibilidad:
--   ALTER TABLE organizations
--     DROP COLUMN IF EXISTS stats_token,
--     DROP COLUMN IF EXISTS stats_token_expires_at;
--   DROP INDEX IF EXISTS organizations_stats_token_idx;
--   ALTER TABLE b2b_leads DROP COLUMN IF EXISTS plan_interes;
-- ============================================================
