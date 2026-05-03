-- ============================================================
-- 005_cleanup_phones.sql · Limpieza de telefonos historicos
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Contexto: PR #32 introdujo lib/phone-utils.js que normaliza
-- entradas con doble prefijo (ej. "+3434630983180"). El fix solo
-- afecta a inserciones nuevas; este script limpia filas ya
-- existentes en la tabla `cards`.
--
-- La logica replica netlify/functions/lib/phone-utils.js:
--   1. Quitar todo lo que no sea digito.
--   2. Si len=13 y empieza por 0034 -> quitar primeros 4.
--   3. Si len=11 y empieza por 34   -> quitar primeros 2.
--   4. Validar 9 digitos comenzando por 6-9 (movil/fijo ES).
--   5. `whatsapp` se guarda como 34XXXXXXXXX (e164 sin +).
--      `telefono` se guarda como XXXXXXXXX (local).
--
-- El UPDATE solo toca filas cuyo valor normalizado difiere del
-- actual y produce un resultado valido (idempotente, seguro
-- de re-ejecutar).
-- ============================================================

-- 1. Deteccion: filas con whatsapp/telefono problematicos.
-- Ejecutar primero para inspeccionar antes de aplicar el UPDATE.
SELECT
  slug,
  whatsapp,
  telefono,
  CASE
    WHEN whatsapp IS NULL OR whatsapp = '' THEN NULL
    ELSE (
      WITH d AS (SELECT regexp_replace(whatsapp, '\D', '', 'g') AS s),
      stripped AS (
        SELECT
          CASE
            WHEN length(s) = 13 AND s LIKE '0034%' THEN substring(s FROM 5)
            WHEN length(s) = 11 AND s LIKE '34%'   THEN substring(s FROM 3)
            WHEN length(s) =  9                    THEN s
            ELSE s
          END AS local
        FROM d
      )
      SELECT CASE
        WHEN local ~ '^[6-9][0-9]{8}$' THEN '34' || local
        ELSE NULL
      END
      FROM stripped
    )
  END AS whatsapp_fixed,
  CASE
    WHEN telefono IS NULL OR telefono = '' THEN NULL
    ELSE (
      WITH d AS (SELECT regexp_replace(telefono, '\D', '', 'g') AS s),
      stripped AS (
        SELECT
          CASE
            WHEN length(s) = 13 AND s LIKE '0034%' THEN substring(s FROM 5)
            WHEN length(s) = 11 AND s LIKE '34%'   THEN substring(s FROM 3)
            WHEN length(s) =  9                    THEN s
            ELSE s
          END AS local
        FROM d
      )
      SELECT CASE
        WHEN local ~ '^[6-9][0-9]{8}$' THEN local
        ELSE NULL
      END
      FROM stripped
    )
  END AS telefono_fixed
FROM cards
WHERE
  (whatsapp IS NOT NULL AND whatsapp <> '' AND whatsapp !~ '^34[6-9][0-9]{8}$')
  OR
  (telefono IS NOT NULL AND telefono <> '' AND telefono !~ '^[6-9][0-9]{8}$');

-- ============================================================
-- 2. Normalizar whatsapp (formato 34XXXXXXXXX).
-- Solo actualiza filas cuyo valor normalizado es valido y
-- distinto del actual.
-- ============================================================
WITH cleaned AS (
  SELECT
    slug,
    regexp_replace(whatsapp, '\D', '', 'g') AS digits
  FROM cards
  WHERE whatsapp IS NOT NULL AND whatsapp <> ''
),
stripped AS (
  SELECT
    slug,
    CASE
      WHEN length(digits) = 13 AND digits LIKE '0034%' THEN substring(digits FROM 5)
      WHEN length(digits) = 11 AND digits LIKE '34%'   THEN substring(digits FROM 3)
      WHEN length(digits) =  9                         THEN digits
      ELSE digits
    END AS local
  FROM cleaned
),
valid AS (
  SELECT slug, '34' || local AS e164
  FROM stripped
  WHERE local ~ '^[6-9][0-9]{8}$'
)
UPDATE cards c
SET whatsapp = v.e164
FROM valid v
WHERE c.slug = v.slug
  AND c.whatsapp IS DISTINCT FROM v.e164;

-- ============================================================
-- 3. Normalizar telefono (formato XXXXXXXXX local).
-- ============================================================
WITH cleaned AS (
  SELECT
    slug,
    regexp_replace(telefono, '\D', '', 'g') AS digits
  FROM cards
  WHERE telefono IS NOT NULL AND telefono <> ''
),
stripped AS (
  SELECT
    slug,
    CASE
      WHEN length(digits) = 13 AND digits LIKE '0034%' THEN substring(digits FROM 5)
      WHEN length(digits) = 11 AND digits LIKE '34%'   THEN substring(digits FROM 3)
      WHEN length(digits) =  9                         THEN digits
      ELSE digits
    END AS local
  FROM cleaned
),
valid AS (
  SELECT slug, local
  FROM stripped
  WHERE local ~ '^[6-9][0-9]{8}$'
)
UPDATE cards c
SET telefono = v.local
FROM valid v
WHERE c.slug = v.slug
  AND c.telefono IS DISTINCT FROM v.local;

-- ============================================================
-- 4. Verificacion post-UPDATE: deberia devolver 0 filas.
-- Las que aparezcan tienen valores no recuperables (no son 9
-- digitos validos ni tras quitar prefijos) y requieren revision
-- manual.
-- ============================================================
SELECT slug, whatsapp, telefono
FROM cards
WHERE
  (whatsapp IS NOT NULL AND whatsapp <> '' AND whatsapp !~ '^34[6-9][0-9]{8}$')
  OR
  (telefono IS NOT NULL AND telefono <> '' AND telefono !~ '^[6-9][0-9]{8}$');
