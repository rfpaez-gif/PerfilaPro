-- ============================================================
-- Migracion 010: ampliacion de categories para cubrir 77 archetypes
--
-- El seed original (001_directory.sql) cubre 11 sectores y 20 specialties.
-- Tras el rediseno de alta con galeria de 14 archetypes diana sobre 77
-- arquetipos totales, el directorio se queda corto: 8 sectores enteros
-- y la mayoria de roles profesionales no tienen entrada canonica.
--
-- Esta migracion anade los sectores y specialties que faltan para que
-- el autofill del editor (editar.html) pueda mapear cada archetype a
-- una entrada de categories sin caer al dropdown manual.
--
-- Convencion de naming (heredada del seed original):
--   - sector / specialty: slugs sin acentos, en minuscula, kebab-case
--   - labels: sin acentos (compatibilidad con datos previos)
--   - specialty es masculino singular ("peluquero"), aunque el archetype
--     se muestre con genero/numero/modificadores naturales ("Peluquera",
--     "Mecanico de taller"). El mapeo lo gestiona archetypes.json.
-- ============================================================

INSERT INTO categories (sector, sector_label, specialty, specialty_label, meta_title, meta_desc, sort_order) VALUES
  -- ── cuidados (sector NUEVO) ────────────────────────────────
  ('cuidados',   'Cuidados',    'empleado-hogar',     'Empleadas de hogar',   'Empleadas de hogar en Espana',     'Encuentra empleadas de hogar de confianza cerca de ti.',         1),
  ('cuidados',   'Cuidados',    'ninera',             'Nineras',              'Nineras en Espana',                'Encuentra nineras y cuidadoras infantiles cerca de ti.',         2),
  ('cuidados',   'Cuidados',    'cuidador-mayores',   'Cuidadores de mayores','Cuidadores de mayores en Espana',  'Encuentra cuidadores de personas mayores cerca de ti.',          3),
  ('cuidados',   'Cuidados',    'limpieza-oficinas',  'Limpieza de oficinas', 'Limpieza de oficinas en Espana',   'Encuentra servicios de limpieza de oficinas cerca de ti.',       4),

  -- ── salud (sector existente, specialties nuevas) ───────────
  ('salud',      'Salud',       'medico-familia',     'Medicos de familia',   'Medicos de familia en Espana',     'Encuentra medicos de familia y consulta general cerca de ti.',   4),
  ('salud',      'Salud',       'enfermero',          'Enfermeros',           'Enfermeros a domicilio en Espana', 'Encuentra enfermeros a domicilio cerca de ti.',                  5),
  ('salud',      'Salud',       'auxiliar-clinica',   'Auxiliares de clinica','Auxiliares de clinica en Espana',  'Encuentra auxiliares de clinica y enfermeria cerca de ti.',      6),
  ('salud',      'Salud',       'nutricionista',      'Nutricionistas',       'Nutricionistas en Espana',         'Encuentra nutricionistas y dieteticos cerca de ti.',             7),
  ('salud',      'Salud',       'tecnico-emergencias','Tecnicos de emergencias','Tecnicos de emergencias en Espana','Encuentra tecnicos en emergencias sanitarias cerca de ti.',    8),

  -- ── educacion (sector existente, specialties nuevas) ───────
  ('educacion',  'Educacion',   'maestro-primaria',   'Maestros de primaria', 'Maestros de primaria en Espana',   'Encuentra maestros de primaria y refuerzo escolar cerca de ti.', 2),
  ('educacion',  'Educacion',   'profesor-secundaria','Profesores de secundaria','Profesores de secundaria en Espana','Encuentra profesores de secundaria y bachillerato cerca de ti.',3),
  ('educacion',  'Educacion',   'educador-infantil',  'Educadores infantiles','Educadores infantiles en Espana',  'Encuentra educadores infantiles cerca de ti.',                   4),
  ('educacion',  'Educacion',   'formador-empresas',  'Formadores para empresas','Formadores para empresas en Espana','Encuentra formadores para empresas cerca de ti.',             5),

  -- ── hosteleria (sector NUEVO) ──────────────────────────────
  ('hosteleria', 'Hosteleria',  'camarero',           'Camareros',            'Camareros en Espana',              'Encuentra camareros para restaurantes y eventos cerca de ti.',   1),
  ('hosteleria', 'Hosteleria',  'cocinero',           'Cocineros',            'Cocineros en Espana',              'Encuentra cocineros profesionales cerca de ti.',                 2),
  ('hosteleria', 'Hosteleria',  'recepcionista-hotel','Recepcionistas de hotel','Recepcionistas de hotel en Espana','Encuentra recepcionistas de hotel cerca de ti.',               3),
  ('hosteleria', 'Hosteleria',  'camarero-pisos',     'Camareras de pisos',   'Camareras de pisos en Espana',     'Encuentra camareras de pisos para hoteles cerca de ti.',         4),

  -- ── turismo (sector NUEVO) ─────────────────────────────────
  ('turismo',    'Turismo',     'guia-turistico',     'Guias turisticos',     'Guias turisticos en Espana',       'Encuentra guias turisticos profesionales cerca de ti.',          1),

  -- ── comercio (sector NUEVO) ────────────────────────────────
  ('comercio',   'Comercio',    'dependiente',        'Dependientes',         'Dependientes en Espana',           'Encuentra dependientes y personal de tienda cerca de ti.',       1),
  ('comercio',   'Comercio',    'cajero',             'Cajeros',              'Cajeros de supermercado en Espana','Encuentra cajeros de supermercado cerca de ti.',                 2),
  ('comercio',   'Comercio',    'reponedor',          'Reponedores',          'Reponedores en Espana',            'Encuentra reponedores de almacen cerca de ti.',                  3),

  -- ── comercial (sector NUEVO) ───────────────────────────────
  ('comercial',  'Comercial',   'comercial-b2b',      'Comerciales B2B',      'Comerciales B2B en Espana',        'Encuentra comerciales B2B y representantes cerca de ti.',        1),
  ('comercial',  'Comercial',   'teleoperador',       'Teleoperadores',       'Teleoperadores en Espana',         'Encuentra teleoperadores y atencion al cliente cerca de ti.',    2),
  ('comercial',  'Comercial',   'administrativo',     'Administrativos',      'Administrativos en Espana',        'Encuentra administrativos para oficina cerca de ti.',            3),
  ('comercial',  'Comercial',   'recepcionista-oficina','Recepcionistas de oficina','Recepcionistas de oficina en Espana','Encuentra recepcionistas de oficina cerca de ti.',         4),

  -- ── transporte (sector NUEVO) ──────────────────────────────
  ('transporte', 'Transporte',  'conductor-reparto',  'Conductores de reparto','Conductores de reparto en Espana','Encuentra conductores de reparto y mensajeria cerca de ti.',    1),
  ('transporte', 'Transporte',  'conductor-trailer',  'Conductores de trailer','Conductores de trailer en Espana','Encuentra conductores de trailer y camion cerca de ti.',        2),
  ('transporte', 'Transporte',  'mozo-almacen',       'Mozos de almacen',     'Mozos de almacen en Espana',       'Encuentra mozos de almacen cerca de ti.',                        3),
  ('transporte', 'Transporte',  'carretillero',       'Carretilleros',        'Carretilleros en Espana',          'Encuentra carretilleros con carnet cerca de ti.',                4),
  ('transporte', 'Transporte',  'mensajero',          'Mensajeros',           'Mensajeros en moto en Espana',     'Encuentra mensajeros en moto cerca de ti.',                      5),

  -- ── automocion (sector existente, specialties nuevas) ──────
  ('automocion', 'Automocion',  'tecnico-neumaticos', 'Tecnicos de neumaticos','Tecnicos de neumaticos en Espana','Encuentra tecnicos de neumaticos cerca de ti.',                  2),
  ('automocion', 'Automocion',  'chapista',           'Chapistas',            'Chapistas en Espana',              'Encuentra chapistas y carroceros cerca de ti.',                  3),
  ('automocion', 'Automocion',  'lavacoches',         'Lavacoches',           'Lavacoches en Espana',             'Encuentra servicios de lavacoches cerca de ti.',                 4),
  ('automocion', 'Automocion',  'asesor-posventa',    'Asesores de posventa', 'Asesores de posventa en Espana',   'Encuentra asesores de servicio posventa cerca de ti.',           5),

  -- ── tech (sector existente, specialties nuevas) ────────────
  ('tech',       'Tecnologia',  'admin-sistemas',     'Administradores de sistemas','Administradores de sistemas en Espana','Encuentra administradores de sistemas cerca de ti.',       3),
  ('tech',       'Tecnologia',  'soporte-it',         'Tecnicos de soporte IT','Tecnicos de soporte IT en Espana','Encuentra tecnicos de soporte informatico cerca de ti.',         4),
  ('tech',       'Tecnologia',  'ciberseguridad',     'Especialistas en ciberseguridad','Especialistas en ciberseguridad en Espana','Encuentra especialistas en ciberseguridad cerca de ti.',5),
  ('tech',       'Tecnologia',  'marketing-digital',  'Tecnicos de marketing digital','Tecnicos de marketing digital en Espana','Encuentra especialistas en marketing digital cerca de ti.',6),
  ('tech',       'Tecnologia',  'community-manager',  'Community managers',   'Community managers en Espana',     'Encuentra gestores de redes sociales cerca de ti.',              7),

  -- ── legal (sector existente, specialties nuevas) ───────────
  ('legal',      'Legal',       'asesor-laboral',     'Asesores laborales',   'Asesores laborales en Espana',     'Encuentra asesores laborales cerca de ti.',                      3),
  ('legal',      'Legal',       'gestor-administrativo','Gestores administrativos','Gestores administrativos en Espana','Encuentra gestores administrativos cerca de ti.',           4),
  ('legal',      'Legal',       'graduado-social',    'Graduados sociales',   'Graduados sociales en Espana',     'Encuentra graduados sociales cerca de ti.',                      5),

  -- ── belleza (sector existente, specialties nuevas) ─────────
  ('belleza',    'Belleza',     'barbero',            'Barberos',             'Barberos en Espana',               'Encuentra barberos y barberias cerca de ti.',                    3),
  ('belleza',    'Belleza',     'manicurista',        'Manicuristas',         'Manicuristas en Espana',           'Encuentra manicuristas y unas cerca de ti.',                     4),
  ('belleza',    'Belleza',     'masajista',          'Masajistas',           'Masajistas en Espana',             'Encuentra masajistas y centros de bienestar cerca de ti.',       5),

  -- ── fitness (sector existente, specialties nuevas) ─────────
  ('fitness',    'Fitness',     'monitor-fitness',    'Monitores de fitness', 'Monitores de fitness en Espana',   'Encuentra monitores de sala de fitness cerca de ti.',            2),
  ('fitness',    'Fitness',     'instructor-yoga',    'Instructores de yoga', 'Instructores de yoga en Espana',   'Encuentra instructores de yoga cerca de ti.',                    3),
  ('fitness',    'Fitness',     'entrenador-deportivo','Entrenadores deportivos','Entrenadores deportivos en Espana','Encuentra entrenadores de equipos deportivos cerca de ti.',    4),

  -- ── jardineria (sector NUEVO) ──────────────────────────────
  ('jardineria', 'Jardineria',  'agricultor',         'Agricultores',         'Agricultores en Espana',           'Encuentra agricultores y productores cerca de ti.',              1),
  ('jardineria', 'Jardineria',  'tractorista',        'Tractoristas',         'Tractoristas en Espana',           'Encuentra tractoristas con experiencia cerca de ti.',            2),
  ('jardineria', 'Jardineria',  'podador',            'Podadores',            'Podadores de arboles en Espana',   'Encuentra podadores de arboles cerca de ti.',                    3),
  ('jardineria', 'Jardineria',  'jardinero',          'Jardineros',           'Jardineros y paisajistas en Espana','Encuentra jardineros y paisajistas cerca de ti.',               4),
  ('jardineria', 'Jardineria',  'operario-invernadero','Operarios de invernadero','Operarios de invernadero en Espana','Encuentra operarios de invernadero cerca de ti.',           5),

  -- ── seguridad (sector NUEVO) ───────────────────────────────
  ('seguridad',  'Seguridad',   'vigilante',          'Vigilantes de seguridad','Vigilantes de seguridad en Espana','Encuentra vigilantes de seguridad cerca de ti.',                1),
  ('seguridad',  'Seguridad',   'control-accesos',    'Controladores de accesos','Controladores de accesos en Espana','Encuentra controladores de accesos cerca de ti.',             2),
  ('seguridad',  'Seguridad',   'instalador-alarmas', 'Instaladores de alarmas','Instaladores de alarmas en Espana','Encuentra instaladores de alarmas y sistemas cerca de ti.',     3),
  ('seguridad',  'Seguridad',   'policia-local',      'Policia local',        'Policia local en Espana',          'Encuentra agentes de policia local en formacion cerca de ti.',   4),
  ('seguridad',  'Seguridad',   'prl',                'Tecnicos en PRL',      'Tecnicos en prevencion de riesgos en Espana','Encuentra tecnicos en prevencion de riesgos laborales cerca de ti.',5),

  -- ── eventos (sector existente, specialties nuevas) ─────────
  ('eventos',    'Eventos',     'organizador-eventos','Organizadores de eventos','Organizadores de eventos en Espana','Encuentra organizadores de eventos cerca de ti.',              2),
  ('eventos',    'Eventos',     'animador-infantil',  'Animadores infantiles','Animadores infantiles en Espana',  'Encuentra animadores para fiestas infantiles cerca de ti.',      3),

  -- ── fotografia (sector existente, specialties nuevas) ──────
  ('fotografia', 'Fotografia',  'videografo',         'Videografos',          'Videografos en Espana',            'Encuentra videografos para eventos cerca de ti.',                2)

ON CONFLICT (sector, specialty) DO NOTHING;
