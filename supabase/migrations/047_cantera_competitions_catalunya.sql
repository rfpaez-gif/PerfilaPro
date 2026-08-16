-- ============================================================
-- 047_cantera_competitions_catalunya.sql · Cuadro de la FCF
-- + región federativa por club.
-- Ejecutar manualmente en Supabase SQL Editor DESPUÉS de la 041.
--
-- Hasta ahora `sports_competitions` sólo tenía el cuadro de la Federación
-- de Murcia (041, region='murcia') y `loadCompetitions` no filtraba por
-- región: sembrar una segunda federación sin más habría hecho que TODOS
-- los clubes vieran las dos mezcladas en el desplegable de alta de equipo.
-- Por eso esta migración hace las dos cosas a la vez:
--
--   1. `organizations.region` — a qué federación pertenece el club.
--      NULL = 'murcia' (lo resuelve lib/club-teams.competitionRegion), así
--      que los clubes existentes no notan el cambio.
--   2. El cuadro femenino + base de la Federació Catalana de Futbol con
--      region='catalunya'.
--
-- Alcance del seed: competiciones de LIGA, que son las que encuadran a un
-- equipo y de las que se deriva su categoría. NO se siembran la Copa
-- Catalunya ni las fases finales del Campionat de Catalunya: un equipo no
-- se "encuadra" en ellas, se clasifica, y meterlas en el desplegable haría
-- que un club creara un equipo duplicado por competición.
--
-- Fuente: Pla de Competició de Futbol Femení de la FCF, temporada 2025/26
-- (files.fcf.cat/documentos/2526/PLACOMPETICIOFUTBOLFEMENI.pdf) y el
-- calendario 2026/27 de Primera Divisió Femení Aleví. La FCF ha anunciado
-- una Divisió d'Honor femenina para 2027/28: NO se siembra hasta que exista.
--
-- Reversible: DELETE FROM sports_competitions WHERE region='catalunya';
--             ALTER TABLE organizations DROP COLUMN region;
-- Idempotente: IF NOT EXISTS + ON CONFLICT DO NOTHING (índice único por
--              (sport, region, gender, name) de la 041).
-- ============================================================

-- ── 1. Región federativa del club ───────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS region text;

COMMENT ON COLUMN organizations.region IS
  'Región federativa para el catálogo de competiciones (sports_competitions.region). NULL = murcia (default histórico).';

-- Índice parcial: la consulta útil es "clubes de esta federación".
CREATE INDEX IF NOT EXISTS organizations_region_idx
  ON organizations (region)
  WHERE region IS NOT NULL AND deleted_at IS NULL;

-- ── 2. Cuadro de la Federació Catalana de Futbol ────────────
-- category_id se resuelve por (sport, code) de sports_categories (033).
-- NULL donde la competición no cuelga de una única categoría de edad.
--
-- Nota de formato: en Catalunya el fútbol base femenino se juega en F-7
-- (benjamí, aleví, infantil F-7, cadet F-7) y F-11 (cadet, juvenil e
-- infantil F-11), a diferencia del F-8 murciano.

INSERT INTO sports_competitions (sport, region, gender, category_group, category_id, name, format, sort_order) VALUES
  -- Estatal (RFEF). No las organiza la FCF, pero un club catalán puede
  -- estar encuadrado en ellas y necesita poder elegirlas.
  ('futbol','catalunya','F','Femení · Estatal',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Liga F','F-11',1010),
  ('futbol','catalunya','F','Femení · Estatal',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Primera Federación Femenina','F-11',1020),
  ('futbol','catalunya','F','Femení · Estatal',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Segunda Federación Femenina','F-11',1030),
  ('futbol','catalunya','F','Femení · Estatal',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Tercera Federación Femenina','F-11',1040),

  -- Territorial sènior (FCF). Preferent es el escalón que conecta con
  -- Tercera Federación.
  ('futbol','catalunya','F','Femení · Sènior',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Preferent Femení','F-11',1110),
  ('futbol','catalunya','F','Femení · Sènior',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Primera Divisió Femenina','F-11',1120),
  ('futbol','catalunya','F','Femení · Sènior',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Segona Divisió Femenina','F-11',1130),
  ('futbol','catalunya','F','Femení · Sènior',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),  'Femení Amateur F-7','F-7',1140),

  -- Juvenil (F-11)
  ('futbol','catalunya','F','Femení · Juvenil',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'), 'Preferent Femení Juvenil','F-11',1210),
  ('futbol','catalunya','F','Femení · Juvenil',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'), 'Primera Divisió Femení Juvenil','F-11',1220),
  ('futbol','catalunya','F','Femení · Juvenil',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'), 'Segona Divisió Femení Juvenil','F-11',1230),

  -- Cadet (F-11 con dos niveles + F-7 de categoría única)
  ('futbol','catalunya','F','Femení · Cadet',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),  'Primera Divisió Femení Cadet','F-11',1310),
  ('futbol','catalunya','F','Femení · Cadet',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),  'Segona Divisió Femení Cadet','F-11',1320),
  ('futbol','catalunya','F','Femení · Cadet',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),  'Femení Cadet F-7','F-7',1330),

  -- Infantil (F-7 con tres niveles + F-11 de categoría única)
  ('futbol','catalunya','F','Femení · Infantil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Preferent Femení Infantil F-7','F-7',1410),
  ('futbol','catalunya','F','Femení · Infantil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Primera Divisió Femení Infantil F-7','F-7',1420),
  ('futbol','catalunya','F','Femení · Infantil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Segona Divisió Femení Infantil F-7','F-7',1430),
  ('futbol','catalunya','F','Femení · Infantil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Femení Infantil F-11','F-11',1440),

  -- Aleví (F-7)
  ('futbol','catalunya','F','Femení · Aleví',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),  'Preferent Femení Aleví','F-7',1510),
  ('futbol','catalunya','F','Femení · Aleví',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),  'Primera Divisió Femení Aleví','F-7',1520),
  ('futbol','catalunya','F','Femení · Aleví',     (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),  'Segona Divisió Femení Aleví','F-7',1530),

  -- Benjamí (F-7, categoría única sin ascensos ni descensos)
  ('futbol','catalunya','F','Femení · Benjamí',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Femení Benjamí','F-7',1610)
ON CONFLICT (sport, region, gender, name) DO NOTHING;

-- ============================================================
-- Notas operativas
-- ============================================================
--   * Marcar un club como catalán:
--       UPDATE organizations SET region='catalunya' WHERE slug='<slug>';
--     o desde el Studio (admin-orgs → crear/editar org, campo Región).
--
--   * El cuadro MASCULINO de la FCF no está sembrado todavía. Un club
--     catalán con sección masculina verá hoy sólo el grupo femenino en el
--     desplegable. Se añade en cuanto tengamos el Pla de Competició
--     masculino verificado, con el mismo patrón de INSERT.
--
--   * La FCF reordena el cuadro por temporada (para 2026/27 la amateur
--     pasa a Primera Divisió con dos grupos; para 2027/28 se anuncia una
--     Divisió d'Honor). Los cambios se aplican con una migración nueva,
--     no editando ésta: los equipos ya creados apuntan a estos ids.
-- ============================================================
