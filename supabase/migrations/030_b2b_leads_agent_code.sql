-- ============================================================
-- 030_b2b_leads_agent_code.sql · Bloque D · atribución comercial en leads
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Captura el agent_code que viene en ?via=agent-XXX al landing
-- /es/empresas y /ca/empresas. Se persiste al INSERT del lead en
-- lead-b2b.js para que el admin vea en el Studio quién refirió antes
-- de crear la org y asignar agent_code a organizations.
--
-- Cadena de atribución resultante:
--   /es/empresas?via=AGENT01
--     → b2b_leads.agent_code = 'AGENT01' (este sprint)
--     → founder ve en Studio quién refirió
--     → founder crea organizations con agent_code='AGENT01' a mano
--       (carry-over automatizado queda para Phase 2 de D)
--     → invoice.paid → org_invoices.agent_code (snapshot, Bloque C)
--     → agent-data agrega la comisión recurrente al agente
--
-- Reversible: ALTER TABLE b2b_leads DROP COLUMN agent_code.
-- Idempotente: IF NOT EXISTS.
-- ============================================================

ALTER TABLE b2b_leads ADD COLUMN IF NOT EXISTS agent_code text;

-- Índice parcial para que el Studio filtre rápido "leads de este agente"
-- (uso típico cuando un agente pregunta por el estado de su pipeline).
-- Excluye redimidos para mantener el índice pequeño — un lead redimido ya
-- no necesita acción comercial.
CREATE INDEX IF NOT EXISTS b2b_leads_agent_code_pending_idx
  ON b2b_leads (agent_code)
  WHERE agent_code IS NOT NULL AND redeemed_at IS NULL;
