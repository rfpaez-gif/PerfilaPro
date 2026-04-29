-- ============================================================
-- Migración 003: columnas faltantes en cards + seed completo
-- Ejecutar en Supabase SQL Editor (idempotente)
-- ============================================================

-- 1. Columnas usadas por stripe-webhook y edit-card que no estaban
--    en la migración 001
ALTER TABLE cards ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS direccion   text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS telefono    text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS agent_code  text;

-- 2. Ciudades — todas las capitales de provincia + secundarias relevantes
INSERT INTO cities (name, slug, province, region, population) VALUES
  -- Andalucía
  ('Almería',              'almeria',              'Almería',          'Andalucía',              200000),
  ('Cádiz',                'cadiz',                'Cádiz',            'Andalucía',               116000),
  ('Jerez de la Frontera', 'jerez',                'Cádiz',            'Andalucía',               212000),
  ('Huelva',               'huelva',               'Huelva',           'Andalucía',               144000),
  ('Jaén',                 'jaen',                 'Jaén',             'Andalucía',               113000),
  -- Aragón
  ('Huesca',               'huesca',               'Huesca',           'Aragón',                   53000),
  ('Teruel',               'teruel',               'Teruel',           'Aragón',                   35000),
  -- Asturias
  ('Oviedo',               'oviedo',               'Asturias',         'Asturias',                220000),
  -- Canarias
  ('Santa Cruz de Tenerife','santa-cruz-tenerife',  'Santa Cruz de Tenerife','Canarias',           209000),
  -- Cantabria (ya tiene Santander)
  -- Castilla-La Mancha
  ('Albacete',             'albacete',             'Albacete',         'Castilla-La Mancha',      172000),
  ('Ciudad Real',          'ciudad-real',          'Ciudad Real',      'Castilla-La Mancha',       75000),
  ('Cuenca',               'cuenca',               'Cuenca',           'Castilla-La Mancha',       57000),
  ('Guadalajara',          'guadalajara',          'Guadalajara',      'Castilla-La Mancha',       79000),
  -- Castilla y León
  ('Ávila',                'avila',                'Ávila',            'Castilla y León',           59000),
  ('Burgos',               'burgos',               'Burgos',           'Castilla y León',          179000),
  ('León',                 'leon',                 'León',             'Castilla y León',          122000),
  ('Palencia',             'palencia',             'Palencia',         'Castilla y León',           79000),
  ('Segovia',              'segovia',              'Segovia',          'Castilla y León',           55000),
  ('Soria',                'soria',                'Soria',            'Castilla y León',           40000),
  ('Zamora',               'zamora',               'Zamora',           'Castilla y León',           64000),
  -- Cataluña
  ('Girona',               'girona',               'Girona',           'Cataluña',                102000),
  ('Lleida',               'lleida',               'Lleida',           'Cataluña',                138000),
  ('Tarragona',            'tarragona',            'Tarragona',        'Cataluña',                133000),
  ('Badalona',             'badalona',             'Barcelona',        'Cataluña',                216000),
  ('Hospitalet',           'hospitalet',           'Barcelona',        'Cataluña',                258000),
  ('Sabadell',             'sabadell',             'Barcelona',        'Cataluña',                212000),
  ('Terrassa',             'terrassa',             'Barcelona',        'Cataluña',                218000),
  -- Extremadura
  ('Cáceres',              'caceres',              'Cáceres',          'Extremadura',              100000),
  -- Galicia
  ('Lugo',                 'lugo',                 'Lugo',             'Galicia',                  99000),
  ('Ourense',              'ourense',              'Ourense',          'Galicia',                  104000),
  ('Pontevedra',           'pontevedra',           'Pontevedra',       'Galicia',                   83000),
  -- La Rioja
  ('Logroño',              'logrono',              'La Rioja',         'La Rioja',                 152000),
  -- Madrid (secundarias)
  ('Getafe',               'getafe',               'Madrid',           'Comunidad de Madrid',      182000),
  ('Alcalá de Henares',    'alcala-de-henares',    'Madrid',           'Comunidad de Madrid',      197000),
  ('Leganés',              'leganes',              'Madrid',           'Comunidad de Madrid',      186000),
  ('Fuenlabrada',          'fuenlabrada',          'Madrid',           'Comunidad de Madrid',      194000),
  ('Móstoles',             'mostoles',             'Madrid',           'Comunidad de Madrid',      204000),
  -- Murcia (secundaria)
  ('Cartagena',            'cartagena',            'Murcia',           'Región de Murcia',         213000),
  -- Navarra
  ('Pamplona',             'pamplona',             'Navarra',          'Navarra',                  202000),
  -- País Vasco
  ('San Sebastián',        'san-sebastian',        'Gipuzkoa',         'País Vasco',               188000),
  -- Valencia (secundarias)
  ('Castellón',            'castellon',            'Castellón',        'Comunitat Valenciana',     171000),
  ('Elche',                'elche',                'Alicante',         'Comunitat Valenciana',     228000),
  ('Torrevieja',           'torrevieja',           'Alicante',         'Comunitat Valenciana',     104000),
  -- Ciudades autónomas
  ('Ceuta',                'ceuta',                'Ceuta',            'Ciudad Autónoma',           84000),
  ('Melilla',              'melilla',              'Melilla',          'Ciudad Autónoma',           87000)
ON CONFLICT (slug) DO NOTHING;

-- 3. Categorías — cobertura completa de los 20 sectores del directorio
INSERT INTO categories (sector, sector_label, specialty, specialty_label, meta_title, meta_desc, sort_order) VALUES

  -- OFICIOS
  ('oficios', 'Oficios', 'calefaccion',       'Técnicos de calefacción', 'Técnicos de calefacción en España',  'Instalación y reparación de calefacción cerca de ti.', 5),
  ('oficios', 'Oficios', 'aire-acondicionado','Técnicos de A/A',         'Técnicos de aire acondicionado',      'Instalación y mantenimiento de A/A cerca de ti.', 6),
  ('oficios', 'Oficios', 'lampista',          'Lampistas',               'Lampistas en España',                 'Encuentra lampistas y fontaneros cerca de ti.', 7),

  -- REFORMA
  ('reforma', 'Reforma', 'pintor',            'Pintores',                'Pintores en España',                  'Encuentra pintores de interiores y exteriores cerca de ti.', 3),
  ('reforma', 'Reforma', 'solador',           'Soladores',               'Soladores en España',                 'Encuentra soladores y alicatadores cerca de ti.', 4),
  ('reforma', 'Reforma', 'instalador',        'Instaladores',            'Instaladores en España',              'Instalaciones de todo tipo cerca de ti.', 5),
  ('reforma', 'Reforma', 'escayolista',       'Escayolistas',            'Escayolistas en España',              'Encuentra escayolistas y falsos techos cerca de ti.', 6),

  -- SALUD
  ('salud', 'Salud', 'medico',               'Médicos',                 'Médicos en España',                   'Encuentra médicos y consultas cerca de ti.', 3),
  ('salud', 'Salud', 'nutricionista',        'Nutricionistas',          'Nutricionistas en España',             'Encuentra nutricionistas y dietistas cerca de ti.', 4),
  ('salud', 'Salud', 'podologo',             'Podólogos',               'Podólogos en España',                 'Encuentra podólogos cerca de ti.', 5),
  ('salud', 'Salud', 'odontologo',           'Odontólogos',             'Odontólogos en España',               'Encuentra dentistas y clínicas dentales cerca de ti.', 6),
  ('salud', 'Salud', 'osteopata',            'Osteópatas',              'Osteópatas en España',                'Encuentra osteópatas y terapeutas manuales cerca de ti.', 7),
  ('salud', 'Salud', 'masajista',            'Masajistas',              'Masajistas en España',                'Encuentra masajistas profesionales cerca de ti.', 8),

  -- LEGAL
  ('legal', 'Legal', 'gestor',               'Gestores administrativos','Gestores administrativos en España',   'Encuentra gestores y asesorías cerca de ti.', 3),
  ('legal', 'Legal', 'notario',              'Notarías',                'Notarías en España',                  'Encuentra notarías cerca de ti.', 4),
  ('legal', 'Legal', 'mediador',             'Mediadores',              'Mediadores en España',                'Encuentra mediadores y árbitros cerca de ti.', 5),

  -- EDUCACIÓN
  ('educacion', 'Educación', 'profesor-ingles',     'Profesores de inglés',   'Profesores de inglés en España',   'Encuentra profesores de inglés cerca de ti.', 2),
  ('educacion', 'Educación', 'profesor-matematicas','Profesores de matemáticas','Profesores de matemáticas en España','Encuentra profesores de matemáticas cerca de ti.', 3),
  ('educacion', 'Educación', 'academia',            'Academias',              'Academias en España',               'Encuentra academias y centros de formación cerca de ti.', 4),
  ('educacion', 'Educación', 'logopeda',            'Logopedas',              'Logopedas en España',               'Encuentra logopedas y especialistas del lenguaje cerca de ti.', 5),

  -- TECNOLOGÍA
  ('tech', 'Tecnología', 'seo',                'Especialistas SEO',      'Especialistas SEO en España',          'Encuentra expertos en SEO y marketing digital cerca de ti.', 3),
  ('tech', 'Tecnología', 'soporte-informatico','Soporte informático',    'Soporte informático en España',        'Encuentra técnicos informáticos cerca de ti.', 4),
  ('tech', 'Tecnología', 'community-manager',  'Community managers',     'Community managers en España',         'Encuentra gestores de redes sociales cerca de ti.', 5),

  -- BELLEZA
  ('belleza', 'Belleza', 'barbero',           'Barberos',               'Barberos en España',                   'Encuentra barberos y barberías cerca de ti.', 3),
  ('belleza', 'Belleza', 'maquillador',       'Maquilladores',          'Maquilladores en España',              'Encuentra maquilladores profesionales cerca de ti.', 4),
  ('belleza', 'Belleza', 'tatuador',          'Tatuadores',             'Tatuadores en España',                 'Encuentra estudios de tatuaje cerca de ti.', 5),
  ('belleza', 'Belleza', 'estetica-avanzada', 'Estética avanzada',      'Estética avanzada en España',          'Encuentra centros de estética avanzada cerca de ti.', 6),

  -- FITNESS
  ('fitness', 'Fitness', 'yoga',              'Instructores de yoga',   'Clases de yoga en España',             'Encuentra profesores de yoga cerca de ti.', 2),
  ('fitness', 'Fitness', 'pilates',           'Instructores de pilates','Clases de pilates en España',          'Encuentra profesores de pilates cerca de ti.', 3),
  ('fitness', 'Fitness', 'crossfit',          'Coaches de CrossFit',    'CrossFit en España',                   'Encuentra coaches de CrossFit y funcional cerca de ti.', 4),
  ('fitness', 'Fitness', 'nutricion-deportiva','Nutrición deportiva',   'Nutrición deportiva en España',        'Encuentra especialistas en nutrición deportiva cerca de ti.', 5),

  -- HOSTELERÍA
  ('hosteleria', 'Hostelería', 'cocinero',    'Cocineros',              'Cocineros en España',                  'Encuentra cocineros y chefs cerca de ti.', 1),
  ('hosteleria', 'Hostelería', 'camarero',    'Camareros',              'Camareros en España',                  'Encuentra camareros profesionales cerca de ti.', 2),
  ('hosteleria', 'Hostelería', 'chef',        'Chefs',                  'Chefs en España',                      'Encuentra chefs y cocineros privados cerca de ti.', 3),
  ('hosteleria', 'Hostelería', 'catering',    'Catering',               'Catering en España',                   'Encuentra empresas de catering cerca de ti.', 4),

  -- FOTOGRAFÍA
  ('fotografia', 'Fotografía', 'fotografo-bodas',  'Fotógrafos de bodas',   'Fotógrafos de bodas en España',   'Encuentra fotógrafos de bodas cerca de ti.', 2),
  ('fotografia', 'Fotografía', 'videogrfo',        'Videógrafos',           'Videógrafos en España',            'Encuentra videógrafos profesionales cerca de ti.', 3),
  ('fotografia', 'Fotografía', 'fotografo-retrato','Fotógrafos de retrato', 'Fotografía de retrato en España',  'Encuentra fotógrafos de retrato cerca de ti.', 4),

  -- EVENTOS
  ('eventos', 'Eventos', 'animador',           'Animadores',            'Animadores de eventos en España',      'Encuentra animadores para tus fiestas y eventos.', 2),
  ('eventos', 'Eventos', 'organizador-eventos','Organizadores de eventos','Organización de eventos en España',  'Encuentra organizadores de eventos cerca de ti.', 3),
  ('eventos', 'Eventos', 'decorador-eventos',  'Decoradores de eventos','Decoración de eventos en España',     'Encuentra decoradores para tus celebraciones.', 4),

  -- AUTOMOCIÓN
  ('automocion', 'Automoción', 'chapista',          'Chapistas',           'Talleres de chapa y pintura en España','Encuentra talleres de chapa y pintura cerca de ti.', 2),
  ('automocion', 'Automoción', 'electricista-auto', 'Electricistas de vehículos','Electricistas de vehículos en España','Encuentra electricistas de coches cerca de ti.', 3),
  ('automocion', 'Automoción', 'neumaticos',        'Talleres de neumáticos','Talleres de neumáticos en España', 'Encuentra talleres de neumáticos cerca de ti.', 4),

  -- JARDINERÍA
  ('jardineria', 'Jardinería', 'jardinero',     'Jardineros',             'Jardineros en España',               'Encuentra jardineros profesionales cerca de ti.', 1),
  ('jardineria', 'Jardinería', 'paisajista',    'Paisajistas',            'Paisajistas en España',              'Encuentra paisajistas y diseñadores de jardines cerca de ti.', 2),

  -- TRANSPORTE
  ('transporte', 'Transporte', 'mudanzas',      'Empresas de mudanzas',   'Empresas de mudanzas en España',     'Encuentra empresas de mudanzas cerca de ti.', 1),
  ('transporte', 'Transporte', 'mensajeria',    'Mensajería',             'Mensajería y paquetería en España',  'Encuentra servicios de mensajería cerca de ti.', 2),
  ('transporte', 'Transporte', 'taxi',          'Taxi y VTC',             'Taxi y VTC en España',               'Encuentra servicios de taxi y VTC cerca de ti.', 3),

  -- CUIDADOS
  ('cuidados', 'Cuidados', 'cuidador',          'Cuidadores',             'Cuidadores en España',               'Encuentra cuidadores de personas mayores cerca de ti.', 1),
  ('cuidados', 'Cuidados', 'limpieza',          'Servicios de limpieza',  'Limpieza del hogar en España',       'Encuentra servicios de limpieza del hogar cerca de ti.', 2),
  ('cuidados', 'Cuidados', 'canguro',           'Canguros y niñeras',     'Canguros en España',                 'Encuentra canguros y niñeras cerca de ti.', 3),
  ('cuidados', 'Cuidados', 'asistente-hogar',   'Asistentes de hogar',    'Asistentes del hogar en España',     'Encuentra asistentes del hogar cerca de ti.', 4),

  -- SEGURIDAD
  ('seguridad', 'Seguridad', 'vigilante',        'Vigilantes de seguridad','Vigilantes de seguridad en España', 'Encuentra vigilantes de seguridad cerca de ti.', 1),
  ('seguridad', 'Seguridad', 'instalador-alarmas','Instaladores de alarmas','Instaladores de alarmas en España','Encuentra instaladores de alarmas cerca de ti.', 2),

  -- COMERCIAL
  ('comercial', 'Comercial', 'comercial',        'Agentes comerciales',   'Agentes comerciales en España',      'Encuentra comerciales y agentes de ventas cerca de ti.', 1),
  ('comercial', 'Comercial', 'marketing',        'Marketing y publicidad','Marketing y publicidad en España',   'Encuentra especialistas en marketing cerca de ti.', 2),
  ('comercial', 'Comercial', 'telemarketing',    'Telemarketing',         'Telemarketing en España',             'Encuentra especialistas en telemarketing cerca de ti.', 3),

  -- TURISMO
  ('turismo', 'Turismo', 'guia-turistico',      'Guías turísticos',       'Guías turísticos en España',         'Encuentra guías turísticos locales cerca de ti.', 1),
  ('turismo', 'Turismo', 'agencia-viajes',      'Agencias de viajes',     'Agencias de viajes en España',       'Encuentra agencias de viajes cerca de ti.', 2),
  ('turismo', 'Turismo', 'transfer',            'Transfer y traslados',   'Transfer al aeropuerto en España',   'Encuentra servicios de transfer cerca de ti.', 3),

  -- COMERCIO
  ('comercio', 'Comercio', 'tienda',             'Tiendas',               'Tiendas locales en España',          'Encuentra tiendas y comercios cerca de ti.', 1),
  ('comercio', 'Comercio', 'distribuidor',       'Distribuidores',        'Distribuidores en España',           'Encuentra distribuidores mayoristas cerca de ti.', 2),

  -- OTRO
  ('otro', 'Otros', 'otro',                    'Otros profesionales',    'Otros profesionales en España',       'Encuentra todo tipo de profesionales cerca de ti.', 1)

ON CONFLICT (sector, specialty) DO NOTHING;
