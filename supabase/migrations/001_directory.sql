-- ============================================================
-- Fase 0: Directorio profesional — schema
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla de categorías (taxonomía cerrada)
CREATE TABLE IF NOT EXISTS categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector           text NOT NULL,
  sector_label     text NOT NULL,
  specialty        text NOT NULL,
  specialty_label  text NOT NULL,
  meta_title       text,
  meta_desc        text,
  sort_order       integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_categories_sector ON categories (sector);
CREATE INDEX IF NOT EXISTS idx_categories_sector_specialty ON categories (sector, specialty);

-- 2. Tabla de ciudades (lista cerrada)
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

-- 3. Nuevas columnas en tabla 'cards' (todas nullable, sin romper flujo existente)
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS directory_visible  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS category_id        uuid REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS city_id            uuid REFERENCES cities(id),
  ADD COLUMN IF NOT EXISTS city_slug          text,
  ADD COLUMN IF NOT EXISTS profession_label   text,
  ADD COLUMN IF NOT EXISTS profile_views      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS directory_featured boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cards_directory ON cards (directory_visible, status);
CREATE INDEX IF NOT EXISTS idx_cards_category  ON cards (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_city_slug ON cards (city_slug)   WHERE city_slug IS NOT NULL;

-- 4. Vista pública del directorio (lectura sin auth)
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
  ci.slug     AS city_slug_norm,
  ci.province
FROM cards c
JOIN  categories cat ON c.category_id = cat.id
LEFT JOIN cities ci  ON ci.slug = c.city_slug
WHERE c.directory_visible = true
  AND c.status = 'active';

-- 5. Datos de ejemplo: ciudades principales de España
INSERT INTO cities (name, slug, province, region, population) VALUES
  ('Madrid',    'madrid',    'Madrid',    'Comunidad de Madrid', 3305408),
  ('Barcelona', 'barcelona', 'Barcelona', 'Cataluña',            1620343),
  ('Valencia',  'valencia',  'Valencia',  'Comunidad Valenciana', 794288),
  ('Sevilla',   'sevilla',   'Sevilla',   'Andalucía',            684234),
  ('Zaragoza',  'zaragoza',  'Zaragoza',  'Aragón',               674317),
  ('Málaga',    'malaga',    'Málaga',    'Andalucía',            574654),
  ('Murcia',    'murcia',    'Murcia',    'Región de Murcia',     459319),
  ('Palma',     'palma',     'Illes Balears', 'Islas Baleares',   416065),
  ('Las Palmas','las-palmas','Las Palmas', 'Canarias',            381223),
  ('Bilbao',    'bilbao',    'Bizkaia',   'País Vasco',           345141),
  ('Alicante',  'alicante',  'Alicante',  'Comunidad Valenciana', 334757),
  ('Córdoba',   'cordoba',   'Córdoba',   'Andalucía',            325701),
  ('Valladolid','valladolid','Valladolid', 'Castilla y León',     295735),
  ('Vigo',      'vigo',      'Pontevedra','Galicia',              294997),
  ('Gijón',     'gijon',     'Asturias',  'Asturias',             270186),
  ('Granada',   'granada',   'Granada',   'Andalucía',            228341),
  ('Vitoria',   'vitoria',   'Álava',     'País Vasco',           256491),
  ('A Coruña',  'a-coruna',  'A Coruña',  'Galicia',              245564),
  ('Badajoz',   'badajoz',   'Badajoz',   'Extremadura',          149683),
  ('Salamanca', 'salamanca', 'Salamanca', 'Castilla y León',      143978),
  ('Santander', 'santander', 'Cantabria', 'Cantabria',            169000),
  ('Toledo',    'toledo',    'Toledo',    'Castilla-La Mancha',   85000)
ON CONFLICT (slug) DO NOTHING;

-- 6. Datos de ejemplo: categorías (sector oficios)
INSERT INTO categories (sector, sector_label, specialty, specialty_label, meta_title, meta_desc, sort_order) VALUES
  ('oficios', 'Oficios', 'fontanero',   'Fontaneros',   'Fontaneros profesionales en España', 'Encuentra fontaneros y plomeros profesionales cerca de ti.', 1),
  ('oficios', 'Oficios', 'electricista','Electricistas', 'Electricistas en España', 'Encuentra electricistas profesionales cerca de ti.', 2),
  ('oficios', 'Oficios', 'cerrajero',   'Cerrajeros',   'Cerrajeros en España', 'Servicio de cerrajería 24h cerca de ti.', 3),
  ('oficios', 'Oficios', 'pintor',      'Pintores',     'Pintores y decoradores en España', 'Encuentra pintores profesionales cerca de ti.', 4),
  ('reforma', 'Reforma', 'albanil',     'Albañiles',    'Albañiles y constructores en España', 'Encuentra albañiles y constructores cerca de ti.', 1),
  ('reforma', 'Reforma', 'carpintero',  'Carpinteros',  'Carpinteros en España', 'Encuentra carpinteros profesionales cerca de ti.', 2),
  ('salud',   'Salud',   'fisioterapeuta', 'Fisioterapeutas', 'Fisioterapeutas en España', 'Encuentra fisioterapeutas profesionales cerca de ti.', 1),
  ('salud',   'Salud',   'psicologo',   'Psicólogos',   'Psicólogos en España', 'Encuentra psicólogos y terapeutas cerca de ti.', 2),
  ('salud',   'Salud',   'dentista',    'Dentistas',    'Dentistas en España', 'Encuentra clínicas dentales cerca de ti.', 3),
  ('legal',   'Legal',   'abogado',     'Abogados',     'Abogados en España', 'Encuentra abogados y asesores jurídicos cerca de ti.', 1),
  ('legal',   'Legal',   'asesor-fiscal','Asesores fiscales','Asesores fiscales en España','Encuentra asesores fiscales y contables cerca de ti.', 2),
  ('tech',    'Tecnología', 'desarrollador', 'Desarrolladores', 'Desarrolladores web en España', 'Encuentra desarrolladores web y app cerca de ti.', 1),
  ('tech',    'Tecnología', 'disenador', 'Diseñadores',  'Diseñadores gráficos en España', 'Encuentra diseñadores gráficos y UX cerca de ti.', 2),
  ('belleza', 'Belleza', 'peluquero',   'Peluqueros',   'Peluqueros a domicilio en España', 'Encuentra peluqueros a domicilio cerca de ti.', 1),
  ('belleza', 'Belleza', 'esteticista', 'Esteticistas', 'Esteticistas en España', 'Encuentra esteticistas y centros de belleza cerca de ti.', 2),
  ('fitness', 'Fitness', 'entrenador-personal', 'Entrenadores personales', 'Entrenadores personales en España', 'Encuentra entrenadores personales cerca de ti.', 1),
  ('educacion','Educación','profesor-particular','Profesores particulares','Profesores particulares en España','Encuentra clases particulares cerca de ti.', 1),
  ('fotografia','Fotografía','fotografo','Fotógrafos','Fotógrafos en España','Encuentra fotógrafos profesionales cerca de ti.',1),
  ('eventos','Eventos','dj','DJ y música','DJ profesionales en España','Encuentra DJ para tus eventos cerca de ti.',1),
  ('automocion','Automoción','mecanico','Mecánicos','Talleres mecánicos en España','Encuentra talleres mecánicos cerca de ti.',1)
ON CONFLICT DO NOTHING;
