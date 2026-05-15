-- ============================================================
-- 026_org_description_website.sql · Texto descriptivo y web de la org
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Añade el bloque "Acerca de" en /e/:slug: un párrafo descriptivo
-- (~500 chars) y la URL corporativa. Complementa el tagline corto
-- (140 chars · migración 019) y los datos de contacto físicos
-- (address/phone · migración 023).
--
-- Reversible: ambos campos son nullable, sin default. Si se vacían,
-- el bloque "Acerca de" desaparece y /e/:slug queda como antes.
--
-- Idempotente: re-ejecutar no rompe nada.
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website     text;

-- ============================================================
-- Notas:
--   * Sin CHECK constraint sobre formato. El backend sanitiza
--     (stripTagsInline + límite de longitud) y valida la URL
--     con `new URL()` en isSafeWebsite.
--   * description: máx 500 chars (1-2 párrafos cortos legibles).
--     Para descripciones largas pasa el contenido al perfil de
--     cada miembro o a una landing externa enlazada vía website.
--   * website: http:// o https://, máx 200 chars. Se renderiza
--     como link con rel="noopener noreferrer" target="_blank".
--   * email: ya existe en organizations.email desde migración 007.
--     A partir de esta migración se expone también en /e/:slug y
--     en el form del Studio (antes solo se podía setear por SQL).
-- ============================================================
