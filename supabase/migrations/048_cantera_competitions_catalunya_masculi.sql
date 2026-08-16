-- ============================================================
-- 048_cantera_competitions_catalunya_masculi.sql · Cuadro
-- masculino de la FCF.
-- Ejecutar manualmente en Supabase SQL Editor DESPUÉS de la 047.
--
-- Completa el catálogo `region='catalunya'`: la 047 sembró la rama
-- femenina y ésta añade la masculina, con lo que un club catalán mixto
-- ve sus dos secciones en el mismo desplegable.
--
-- Particularidad catalana frente al cuadro murciano (041): la FCF
-- organiza el fútbol base **por año de nacimiento**, no por etiqueta de
-- categoría. Benjamí, Aleví, Infantil y Cadet tienen DOS competiciones
-- paralelas cada una (S9/S10, S11/S12, S13/S14, S15/S16), así que un club
-- con equipo de cada año los encuadra por separado en vez de tirar del
-- sufijo A/B de `club_teams.label`. Ambas apuntan a la misma categoría de
-- `sports_categories` porque la elegibilidad por edad es la misma.
--
-- Formatos: F-5 en debutant, F-7 de prebenjamí a aleví, F-11 de infantil
-- en adelante. (En Murcia el tramo aleví/benjamí es F-8; en Catalunya, F-7.)
--
-- Alcance: competiciones de LIGA. NO se siembra la Copa Catalunya
-- masculina — es eliminatoria y obligatoria para los clubes que la juegan,
-- pero un equipo no se "encuadra" en ella, se clasifica; meterla en el
-- desplegable llevaría a crear equipos duplicados.
--
-- Fuente: Pla de Competició de Futbol Amateur (CIRCULAR 24, dic. 2025) y
-- Pla de Competició de Futbol Base de la FCF, temporada 2025/26.
--
-- Reversible: DELETE FROM sports_competitions
--               WHERE region='catalunya' AND gender='M';
-- Idempotente: ON CONFLICT DO NOTHING (índice único de la 041).
-- ============================================================

INSERT INTO sports_competitions (sport, region, gender, category_group, category_id, name, format, sort_order) VALUES
  -- ── Sènior estatal (RFEF) ─────────────────────────────────
  -- Las organiza la RFEF, no la FCF, pero el club catalán que esté en
  -- ellas necesita poder elegirlas.
  ('futbol','catalunya','M','Masculí · Estatal',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Primera División','F-11',110),
  ('futbol','catalunya','M','Masculí · Estatal',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Segunda División','F-11',120),
  ('futbol','catalunya','M','Masculí · Estatal',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Primera Federación','F-11',130),
  ('futbol','catalunya','M','Masculí · Estatal',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Segunda Federación','F-11',140),
  ('futbol','catalunya','M','Masculí · Estatal',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Tercera Federación','F-11',150),

  -- ── Sènior territorial (FCF) ──────────────────────────────
  -- Lliga Elit es el techo estrictamente catalán y conecta con Tercera
  -- Federación; Quarta Catalana es el escalón de entrada de un club nuevo.
  ('futbol','catalunya','M','Masculí · Sènior',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Lliga Elit','F-11',210),
  ('futbol','catalunya','M','Masculí · Sènior',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Primera Catalana','F-11',220),
  ('futbol','catalunya','M','Masculí · Sènior',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Segona Catalana','F-11',230),
  ('futbol','catalunya','M','Masculí · Sènior',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Tercera Catalana','F-11',240),
  ('futbol','catalunya','M','Masculí · Sènior',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),'Quarta Catalana','F-11',250),

  -- ── Juvenil (F-11) ────────────────────────────────────────
  -- Divisió d'Honor y Lliga Nacional son de ámbito estatal/interterritorial.
  ('futbol','catalunya','M','Masculí · Juvenil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),'Divisió d''Honor Juvenil','F-11',310),
  ('futbol','catalunya','M','Masculí · Juvenil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),'Lliga Nacional Juvenil','F-11',320),
  ('futbol','catalunya','M','Masculí · Juvenil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),'Juvenil Preferent','F-11',330),
  ('futbol','catalunya','M','Masculí · Juvenil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),'Juvenil Primera Divisió','F-11',340),
  ('futbol','catalunya','M','Masculí · Juvenil',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),'Juvenil Segona Divisió','F-11',350),

  -- ── Cadet S16 / S15 (F-11) ────────────────────────────────
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Divisió d''Honor Cadet S16','F-11',410),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Preferent Cadet S16','F-11',420),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Primera Divisió Cadet S16','F-11',430),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Segona Divisió Cadet S16','F-11',440),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Divisió d''Honor Cadet S15','F-11',450),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Preferent Cadet S15','F-11',460),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Primera Divisió Cadet S15','F-11',470),
  ('futbol','catalunya','M','Masculí · Cadet',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),'Segona Divisió Cadet S15','F-11',480),

  -- ── Infantil S14 / S13 (F-11) ─────────────────────────────
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Divisió d''Honor Infantil S14','F-11',510),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Preferent Infantil S14','F-11',520),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Primera Divisió Infantil S14','F-11',530),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Segona Divisió Infantil S14','F-11',540),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Divisió d''Honor Infantil S13','F-11',550),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Preferent Infantil S13','F-11',560),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Primera Divisió Infantil S13','F-11',570),
  ('futbol','catalunya','M','Masculí · Infantil', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),'Segona Divisió Infantil S13','F-11',580),

  -- ── Aleví S12 / S11 (F-7) ─────────────────────────────────
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Preferent Aleví S12','F-7',610),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Primera Divisió Aleví S12','F-7',620),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Segona Divisió Aleví S12','F-7',630),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Tercera Divisió Aleví S12','F-7',640),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Preferent Aleví S11','F-7',650),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Primera Divisió Aleví S11','F-7',660),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Segona Divisió Aleví S11','F-7',670),
  ('futbol','catalunya','M','Masculí · Aleví',    (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),'Tercera Divisió Aleví S11','F-7',680),

  -- ── Benjamí S10 / S9 (F-7) ────────────────────────────────
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Preferent Benjamí S10','F-7',710),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Primera Divisió Benjamí S10','F-7',720),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Segona Divisió Benjamí S10','F-7',730),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Tercera Divisió Benjamí S10','F-7',740),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Preferent Benjamí S9','F-7',750),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Primera Divisió Benjamí S9','F-7',760),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Segona Divisió Benjamí S9','F-7',770),
  ('futbol','catalunya','M','Masculí · Benjamí',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),'Tercera Divisió Benjamí S9','F-7',780),

  -- ── Prebenjamí S8 / S7 (F-7, categoría única) ─────────────
  ('futbol','catalunya','M','Masculí · Prebenjamí',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='prebenjamin'),'Prebenjamí S8','F-7',810),
  ('futbol','catalunya','M','Masculí · Prebenjamí',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='prebenjamin'),'Prebenjamí S7','F-7',820),

  -- ── Debutant S6 / S5 (F-5, categoría única) ───────────────
  -- category_id NULL: sports_categories (033) arranca en prebenjamín y no
  -- tiene tramo para 5-6 años. Mismo criterio que 'Liga Autonómica
  -- Debutantes' en el seed de Murcia: elegibilidad laxa.
  ('futbol','catalunya','M','Masculí · Debutant', NULL,'Debutant S6','F-5',830),
  ('futbol','catalunya','M','Masculí · Debutant', NULL,'Debutant S5','F-5',840)
ON CONFLICT (sport, region, gender, name) DO NOTHING;

-- ============================================================
-- Notas operativas
-- ============================================================
--   * sort_order: el masculino ocupa 110-840 y el femenino (047) 1010-1610,
--     así que en el desplegable sale primero el masculino — mismo orden que
--     el seed de Murcia (041). No es una jerarquía: es que el bloque grande
--     va primero para reducir scroll en el club medio.
--
--   * Los grupos territoriales (10 de Tercera Catalana en Barcelona, 22 de
--     Quarta…) NO se modelan: la competición es "Tercera Catalana", y el
--     grupo concreto cambia cada temporada por sorteo. Si algún día hace
--     falta, va como campo aparte de `club_teams`, no duplicando filas aquí.
--
--   * La FCF revisa el cuadro cada temporada. Los cambios entran con una
--     migración nueva, nunca editando ésta: los `club_teams` ya creados
--     apuntan a estos ids.
-- ============================================================
