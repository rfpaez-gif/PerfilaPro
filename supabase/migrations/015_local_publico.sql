-- ============================================================
-- 015 · Visibilidad de dirección física para comercios
-- ============================================================
-- Antes de esta migración, el campo cards.direccion (existente desde
-- migración 003) se renderizaba SIEMPRE en la tarjeta pública si tenía
-- valor — un autónomo a domicilio que rellenara su dirección por error
-- exponía su casa.
--
-- A partir de aquí la dirección solo se muestra públicamente si el usuario
-- activa explícitamente cards.local_publico = true. El flujo es:
--   - Default false  → autónomo a domicilio, dirección oculta aunque exista.
--   - true           → comercio físico, dirección visible + link Google Maps.
--
-- Las altas y ediciones existentes (pre-015) quedan automáticamente con
-- local_publico=false. Los pocos perfiles que tenían dirección renderizada
-- públicamente desde el bloque QR pasan a tenerla oculta — recuperan
-- visibilidad cuando el usuario marca el toggle desde /editar.html.
-- ============================================================

ALTER TABLE cards ADD COLUMN IF NOT EXISTS local_publico boolean NOT NULL DEFAULT false;
