-- ============================================================
-- 041_cantera_sports_competitions.sql · Catálogo de competiciones
-- del fútbol base (Murcia) + el equipo del club pasa a definirse
-- por la competición en la que está encuadrado.
--
-- Motivación: un "equipo" del club es, en realidad, el club
-- encuadrado en una competición concreta (p.ej. "Primera Cadete"),
-- y esa competición YA define la categoría de edad. En vez de teclear
-- un nombre libre + elegir una categoría suelta, el coordinador elige
-- la competición de un desplegable agrupado y de ahí se deduce todo:
-- categoría (elegibilidad de jugadores), formato (F-8/F-11…) y nombre.
--
-- `sports_competitions` es un catálogo de lectura (como sports_categories),
-- sembrado con el cuadro de competiciones de la Federación de Murcia
-- (masculino + femenino). Multi-región por diseño (`region`); de momento
-- solo Murcia.
--
-- `club_teams` gana `competition_id` (la competición elegida) + `label`
-- (sufijo A/B opcional para dos equipos en la MISMA competición), y su
-- `category_id` pasa a poder ser NULL (competiciones femeninas que cruzan
-- edades / sin categoría de edad única).
--
-- Ejecutar manualmente en Supabase SQL Editor DESPUÉS de la 040. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS sports_competitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport           text NOT NULL DEFAULT 'futbol',
  region          text NOT NULL DEFAULT 'murcia',
  gender          text NOT NULL DEFAULT 'M',
  category_group  text NOT NULL,                              -- cabecera: 'Cadetes','Femenino'…
  category_id     uuid REFERENCES sports_categories(id),      -- elegibilidad (NULL si cruza edades)
  name            text NOT NULL,                              -- 'Primera Cadete'
  format          text,                                       -- 'F-11','F-8','F-9','F-5'
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sports_competitions DROP CONSTRAINT IF EXISTS sports_competitions_gender_check;
ALTER TABLE sports_competitions ADD CONSTRAINT sports_competitions_gender_check
  CHECK (gender IN ('M','F','X'));

-- Una competición es única por (deporte, región, género, nombre).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sports_competitions_unique
  ON sports_competitions (sport, region, gender, name);

CREATE INDEX IF NOT EXISTS idx_sports_competitions_list
  ON sports_competitions (sport, region, sort_order);

-- Catálogo de lectura pública (mismo patrón que sports_categories).
ALTER TABLE sports_competitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sports_competitions_read ON sports_competitions;
CREATE POLICY sports_competitions_read ON sports_competitions FOR SELECT USING (true);
GRANT SELECT ON sports_competitions TO anon, authenticated;

-- ── club_teams: el equipo se define por su competición ──────
ALTER TABLE club_teams ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES sports_competitions(id);
ALTER TABLE club_teams ADD COLUMN IF NOT EXISTS label text;
-- La categoría pasa a derivarse de la competición y puede ser NULL.
ALTER TABLE club_teams ALTER COLUMN category_id DROP NOT NULL;

-- ── Seed: cuadro de competiciones de Murcia (masc + fem) ────
-- category_id se resuelve por (sport, code) de sports_categories (033).
-- NULL donde la competición cruza edades o no va por edad de cantera.
INSERT INTO sports_competitions (gender, category_group, category_id, name, format, sort_order) VALUES
  -- Juveniles (F-11)
  ('M','Juveniles', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),    'División de Honor Juvenil','F-11',110),
  ('M','Juveniles', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),    'Liga Nacional Juvenil','F-11',120),
  ('M','Juveniles', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),    'Liga Autonómica Juvenil','F-11',130),
  ('M','Juveniles', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),    'Primera Juvenil','F-11',140),
  ('M','Juveniles', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='juvenil'),    'Segunda Juvenil','F-11',150),
  -- Cadetes (F-11)
  ('M','Cadetes',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),     'Superliga Cadete','F-11',210),
  ('M','Cadetes',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),     'Liga Autonómica Cadete','F-11',220),
  ('M','Cadetes',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),     'Primera Cadete','F-11',230),
  ('M','Cadetes',   (SELECT id FROM sports_categories WHERE sport='futbol' AND code='cadete'),     'Segunda Cadete','F-11',240),
  -- Infantiles (F-11, salvo Tercera F-8)
  ('M','Infantiles',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),   'Superliga Infantil','F-11',310),
  ('M','Infantiles',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),   'Liga Autonómica Infantil','F-11',320),
  ('M','Infantiles',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),   'Primera Infantil','F-11',330),
  ('M','Infantiles',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),   'Segunda Infantil','F-11',340),
  ('M','Infantiles',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'),   'Tercera Infantil Fútbol-8','F-8',350),
  -- Alevines (F-8)
  ('M','Alevines',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),     'Superliga Alevín Fútbol-8','F-8',410),
  ('M','Alevines',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),     'Liga Autonómica Alevín Fútbol-8','F-8',420),
  ('M','Alevines',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),     'Primera Alevín Fútbol-8','F-8',430),
  ('M','Alevines',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),     'Segunda Alevín Fútbol-8','F-8',440),
  ('M','Alevines',  (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),     'Tercera Alevín Fútbol-8','F-8',450),
  -- Benjamines (F-8)
  ('M','Benjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),   'Superliga Benjamín Fútbol-8','F-8',510),
  ('M','Benjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),   'Liga Autonómica Benjamín Fútbol-8','F-8',520),
  ('M','Benjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),   'Primera Benjamín Fútbol-8','F-8',530),
  ('M','Benjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),   'Segunda Benjamín Fútbol-8','F-8',540),
  ('M','Benjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='benjamin'),   'Tercera Benjamín Fútbol-8','F-8',550),
  -- Prebenjamines
  ('M','Prebenjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='prebenjamin'),'Primera Prebenjamín Fútbol-9','F-9',610),
  ('M','Prebenjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='prebenjamin'),'Segunda Prebenjamín Fútbol-9','F-9',620),
  ('M','Prebenjamines',(SELECT id FROM sports_categories WHERE sport='futbol' AND code='prebenjamin'),'Prebenjamín Fútbol-5','F-5',630),
  -- Debutantes (sin categoría de cantera sembrada → NULL, elegibilidad laxa)
  ('M','Debutantes', NULL, 'Liga Autonómica Debutantes','F-5',710),
  -- Femenino
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Primera División de Fútbol Femenino','F-11',910),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Primera Federación Futfem','F-11',920),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Segunda Federación Futfem','F-11',930),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Tercera Federación Futfem','F-11',940),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Preferente Autonómica Femenina','F-11',950),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Primera Autonómica Femenina','F-11',960),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='senior'),   'Segunda Autonómica Femenina','F-11',970),
  ('F','Femenino', NULL, 'Liga Femenina Infantil/Cadete F-11','F-11',980),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='infantil'), 'Liga Femenina Infantil F-11','F-11',985),
  ('F','Femenino', (SELECT id FROM sports_categories WHERE sport='futbol' AND code='alevin'),   'Liga Femenina Alevín F-8','F-8',990),
  ('F','Femenino', NULL, 'Liga Femenina Juvenil/Cadete','F-11',992),
  ('F','Femenino', NULL, 'Liga Femenina Cadete/Infantil F8','F-8',994),
  ('F','Femenino', NULL, 'Liga Femenina Infantil/Alevín F8','F-8',996),
  ('F','Femenino', NULL, 'Liga Femenina Benjamín/Prebenjamín F5','F-5',998)
ON CONFLICT (sport, region, gender, name) DO NOTHING;

-- ── Contramigración (manual) ──────────────────────────────
-- ALTER TABLE club_teams DROP COLUMN IF EXISTS competition_id;
-- ALTER TABLE club_teams DROP COLUMN IF EXISTS label;
-- DROP TABLE IF EXISTS sports_competitions;
