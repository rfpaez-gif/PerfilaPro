-- ============================================================
-- 031_org_hide_branding.sql
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- White-label flag para clientes B2B Enterprise.
--
-- Cuando hide_branding = true, el render público de /c/:slug
-- de cualquier card asignada a esa org oculta:
--   - El bloque "Powered by PerfilaPro" del pie de la tarjeta.
--   - La URL perfilapro.es/c/<slug> impresa en el PNG descargable.
--
-- Default false: cero impacto en orgs existentes ni en el carril
-- autónomo. Lo flipea el founder desde admin-orgs cuando un cliente
-- de pago lo pide en la negociación.
--
-- Reversibilidad:
--   ALTER TABLE organizations DROP COLUMN IF EXISTS hide_branding;
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hide_branding boolean NOT NULL DEFAULT false;
