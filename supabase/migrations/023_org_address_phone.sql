-- ============================================================
-- 023_org_address_phone.sql · Datos de contacto físicos de la org
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Permite que la tarjeta de visita B2B (tarjeta-empresa.pdf) caiga
-- a los datos de la organización cuando el miembro del equipo no
-- tiene `direccion` propia. Caso de uso: despacho con sede única
-- que reparte tarjetas a 20 empleados — todos comparten la misma
-- dirección física aunque cada uno tenga su email y teléfono.
--
-- Reversible: ambos campos son nullable, sin default. Si se retira
-- la pieza de tarjeta de visita B2B basta con dejarlos vacíos.
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone   text;

-- ============================================================
-- Notas:
--   * Sin CHECK constraint sobre el formato — el backend sanitiza
--     (stripTagsInline + límite de longitud). Mismo criterio que
--     `tagline` en la migración 019.
--   * `phone` admite el formato libre del admin (con/sin prefijo
--     +34, espacios, etc.). El formateo bonito ocurre en
--     printable-card-utils.formatSpanishPhone() en el render PDF.
--   * El email institucional ya vive en organizations.email desde
--     la migración 007 — no hace falta añadirlo aquí.
-- ============================================================
