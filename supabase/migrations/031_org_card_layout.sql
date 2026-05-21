-- ============================================================
-- 031_org_card_layout.sql · Enterprise · layout compacto de tarjeta
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Añade `card_layout` a `organizations` para activar un render
-- alternativo de /c/:slug pensado para clientes Enterprise con red
-- comercial uniforme (ej. Allianz, banca, despachos grandes). En modo
-- 'compact', la card pública del miembro renderiza:
--   - Hero corporativo prominente con logo + tagline de la org
--   - Foto pequeña (no protagonista, ~96px)
--   - Datos de contacto del individuo en filas compactas
--   - Botones de acción (WhatsApp · Llamar · vCard · Compartir)
--   - SIN lista de 3 servicios, SIN descripción libre del individuo
--
-- La marca de la org es la protagonista visual; el individuo es la
-- pieza intercambiable. Coherente con el modelo Enterprise.
--
-- Reversible: ALTER TABLE organizations DROP COLUMN card_layout.
-- Idempotente: IF NOT EXISTS + CHECK con DROP/ADD.
-- Default 'standard': cero cards existentes cambian de render.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS card_layout text NOT NULL DEFAULT 'standard';

-- CHECK constraint con drop/add para idempotencia (re-ejecutable sin error).
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_card_layout_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_card_layout_check
  CHECK (card_layout IN ('standard', 'compact'));
