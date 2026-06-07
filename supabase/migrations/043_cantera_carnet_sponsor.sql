-- ============================================================
-- 043_cantera_carnet_sponsor.sql · Cantera
--
-- Cara B del carnet del jugador = espacio publicitario del club. El club
-- sube UNA imagen de patrocinador (la vende y gestiona él; PerfilaPro solo
-- la imprime en la cara B del carnet PVC). Esta columna guarda la URL del
-- patrocinador, whitelisteada a Supabase storage en el backend (mismo
-- criterio que organizations.logo_url / cards.foto_url).
--
-- El render del carnet (printable-card-utils.js · renderPlayerCardBack) ya
-- la consume vía club.carnet_sponsor_url. NULL = sin patrocinador → cara B
-- cae al fallback sobrio (escudo del club + franja de validez).
--
-- El área de patrocinador es además el hueco reservado para el patrocinador
-- de RED de PerfilaPro (CaixaBank u otro, Fase 2): cuando se monte el carril
-- de patrocinio agregado, podrá poblar/override esta columna a nivel red.
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS carnet_sponsor_url text;

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE organizations DROP COLUMN IF EXISTS carnet_sponsor_url;
