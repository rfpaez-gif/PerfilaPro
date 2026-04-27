-- ============================================================
-- Fase 0: Directorio profesional - schema
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla de categorias
CREATE TABLE IF NOT EXISTS categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector           text NOT NULL,
  sector_label     text NOT NULL,
  specialty        text NOT NULL,
  specialty_label  text NOT NULL,
  meta_title       text,
  meta_desc        text,
  sort_order       integer DEFAULT 0,
  UNIQUE (sector, specialty)
);

CREATE INDEX IF NOT EXISTS idx_categories_sector ON categories (sector);

-- 2. Tabla de ciudades
CREATE TABLE IF NOT EXISTS cities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  province   text NOT NULL,
  region     text NOT NULL,
  population integer,
  active     boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_cities_slug ON cities (slug);

-- 3. Nuevas columnas en cards (una por sentencia para maxima compatibilidad)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS directory_visible  boolean DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS category_id        uuid REFERENCES categories(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS city_id            uuid REFERENCES cities(id);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS city_slug          text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS profession_label   text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS profile_views      integer DEFAULT 0;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS directory_featured boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cards_directory ON cards (directory_visible, status);
CREATE INDEX IF NOT EXISTS idx_cards_category  ON cards (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_city_slug ON cards (city_slug)   WHERE city_slug IS NOT NULL;

-- 4. Vista publica del directorio
CREATE OR REPLACE VIEW directory_public AS
SELECT
  c.slug,
  c.nombre,
  c.tagline,
  c.foto_url,
  c.whatsapp,
  c.plan,
  c.stripe_session_id,
  c.profile_views,
  c.directory_featured,
  c.city_slug,
  cat.sector,
  cat.sector_label,
  cat.specialty,
  cat.specialty_label,
  ci.name     AS city_name,
  ci.province
FROM cards c
JOIN  categories cat ON c.category_id = cat.id
LEFT JOIN cities ci  ON ci.slug = c.city_slug
WHERE c.directory_visible = true
  AND c.status = 'active';

-- 5. Ciudades principales de Espana
INSERT INTO cities (name, slug, province, region, population) VALUES
  ('Madrid',     'madrid',     'Madrid',        'Comunidad de Madrid',   3305408),
  ('Barcelona',  'barcelona',  'Barcelona',     'Cataluna',              1620343),
  ('Valencia',   'valencia',   'Valencia',      'Com. Valenciana',        794288),
  ('Sevilla',    'sevilla',    'Sevilla',        'Andalucia',              684234),
  ('Zaragoza',   'zaragoza',   'Zaragoza',       'Aragon',                 674317),
  ('Malaga',     'malaga',     'Malaga',         'Andalucia',              574654),
  ('Murcia',     'murcia',     'Murcia',         'Region de Murcia',       459319),
  ('Palma',      'palma',      'Illes Balears',  'Islas Baleares',         416065),
  ('Las Palmas', 'las-palmas', 'Las Palmas',     'Canarias',               381223),
  ('Bilbao',     'bilbao',     'Bizkaia',        'Pais Vasco',             345141),
  ('Alicante',   'alicante',   'Alicante',       'Com. Valenciana',        334757),
  ('Cordoba',    'cordoba',    'Cordoba',        'Andalucia',              325701),
  ('Valladolid', 'valladolid', 'Valladolid',     'Castilla y Leon',        295735),
  ('Vigo',       'vigo',       'Pontevedra',     'Galicia',                294997),
  ('Gijon',      'gijon',      'Asturias',       'Asturias',               270186),
  ('Granada',    'granada',    'Granada',        'Andalucia',              228341),
  ('Vitoria',    'vitoria',    'Alava',          'Pais Vasco',             256491),
  ('A Coruna',   'a-coruna',   'A Coruna',       'Galicia',                245564),
  ('Badajoz',    'badajoz',    'Badajoz',        'Extremadura',            149683),
  ('Salamanca',  'salamanca',  'Salamanca',      'Castilla y Leon',        143978),
  ('Santander',  'santander',  'Cantabria',      'Cantabria',              169000),
  ('Toledo',     'toledo',     'Toledo',         'Castilla-La Mancha',      85000)
ON CONFLICT (slug) DO NOTHING;

-- 6. Categorias de ejemplo
INSERT INTO categories (sector, sector_label, specialty, specialty_label, meta_title, meta_desc, sort_order) VALUES
  ('oficios',    'Oficios',     'fontanero',          'Fontaneros',          'Fontaneros en Espana',          'Encuentra fontaneros profesionales cerca de ti.', 1),
  ('oficios',    'Oficios',     'electricista',       'Electricistas',       'Electricistas en Espana',       'Encuentra electricistas profesionales cerca de ti.', 2),
  ('oficios',    'Oficios',     'cerrajero',          'Cerrajeros',          'Cerrajeros en Espana',          'Servicio de cerrajeria 24h cerca de ti.', 3),
  ('oficios',    'Oficios',     'pintor',             'Pintores',            'Pintores en Espana',            'Encuentra pintores profesionales cerca de ti.', 4),
  ('reforma',    'Reforma',     'albanil',            'Albaniles',           'Albaniles en Espana',           'Encuentra albaniles y constructores cerca de ti.', 1),
  ('reforma',    'Reforma',     'carpintero',         'Carpinteros',         'Carpinteros en Espana',         'Encuentra carpinteros profesionales cerca de ti.', 2),
  ('salud',      'Salud',       'fisioterapeuta',     'Fisioterapeutas',     'Fisioterapeutas en Espana',     'Encuentra fisioterapeutas cerca de ti.', 1),
  ('salud',      'Salud',       'psicologo',          'Psicologos',          'Psicologos en Espana',          'Encuentra psicologos y terapeutas cerca de ti.', 2),
  ('salud',      'Salud',       'dentista',           'Dentistas',           'Dentistas en Espana',           'Encuentra clinicas dentales cerca de ti.', 3),
  ('legal',      'Legal',       'abogado',            'Abogados',            'Abogados en Espana',            'Encuentra abogados y asesores juridicos cerca de ti.', 1),
  ('legal',      'Legal',       'asesor-fiscal',      'Asesores fiscales',   'Asesores fiscales en Espana',   'Encuentra asesores fiscales y contables cerca de ti.', 2),
  ('tech',       'Tecnologia',  'desarrollador',      'Desarrolladores',     'Desarrolladores web en Espana', 'Encuentra desarrolladores web y app cerca de ti.', 1),
  ('tech',       'Tecnologia',  'disenador',          'Disenadores',         'Disenadores graficos en Espana','Encuentra disenadores graficos y UX cerca de ti.', 2),
  ('belleza',    'Belleza',     'peluquero',          'Peluqueros',          'Peluqueros en Espana',          'Encuentra peluqueros a domicilio cerca de ti.', 1),
  ('belleza',    'Belleza',     'esteticista',        'Esteticistas',        'Esteticistas en Espana',        'Encuentra esteticistas y centros de belleza cerca de ti.', 2),
  ('fitness',    'Fitness',     'entrenador-personal','Entrenadores personales','Entrenadores personales en Espana','Encuentra entrenadores personales cerca de ti.', 1),
  ('educacion',  'Educacion',   'profesor-particular','Profesores particulares','Profesores particulares en Espana','Encuentra clases particulares cerca de ti.', 1),
  ('fotografia', 'Fotografia',  'fotografo',          'Fotografos',          'Fotografos en Espana',          'Encuentra fotografos profesionales cerca de ti.', 1),
  ('eventos',    'Eventos',     'dj',                 'DJ y musica',         'DJ profesionales en Espana',    'Encuentra DJ para tus eventos cerca de ti.', 1),
  ('automocion', 'Automocion',  'mecanico',           'Mecanicos',           'Talleres mecanicos en Espana',  'Encuentra talleres mecanicos cerca de ti.', 1)
ON CONFLICT (sector, specialty) DO NOTHING;
