-- ============================================================
-- 017 · Idioma del autónomo (es / ca)
-- ============================================================
-- Soporte para el catalán como segundo idioma. La tarjeta pública
-- /c/:slug, los emails post-pago y los emails recordatorio se renderizan
-- en este idioma — independientemente del idioma del visitante.
--
-- Default 'es': los autónomos pre-017 conservan el comportamiento actual.
-- A partir de 017, alta.html en /es/ pasa idioma='es' y alta.html en /ca/
-- pasa 'ca' al backend (create-checkout y register-free).
--
-- CHECK constraint para evitar idiomas no soportados llegando por error
-- desde el cliente. Cualquier ampliación futura (gallego, euskera, valencià
-- normativo) requerirá relajar este constraint y traducir los assets.
-- ============================================================

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS idioma text NOT NULL DEFAULT 'es'
  CHECK (idioma IN ('es', 'ca'));
