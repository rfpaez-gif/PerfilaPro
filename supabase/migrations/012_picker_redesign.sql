-- ============================================================
-- Migracion 012: rediseno del picker de alta a 17 tarjetas diana
--
-- Acompana el rediseno de archetypes.json (14 -> 17 diana). Anade:
--
-- 1. Nueva specialty 'instalador-clima' bajo el sector 'oficios'.
--    Cubre instaladores de aire acondicionado, calefaccion y bombas
--    de calor, que son uno de los autonomos mas demandados en Espana
--    pero no tenian destino canonico en categories.
--
-- 2. Nuevo sector 'otros' con la specialty 'otro-oficio' como destino
--    de fallback para el flujo "No me veo aqui" del picker. Permite
--    que un usuario describa su oficio en texto libre y persista la
--    tarjeta con una category_id valida (no NULL), para que aparezca
--    en el directorio si elige hacerse visible y para que el PDF
--    imprimible tenga un fallback razonable.
--
-- 3. Nueva columna cards.specialty_custom: texto libre que solo se usa
--    cuando category.specialty = 'otro-oficio'. Lo prefiere el PDF
--    imprimible y el chip de la pagina publica sobre el specialty_label
--    canonico ('Otros oficios') para que la tarjeta lea "Limpiacristales"
--    en vez de "Otros oficios".
--
-- 4. Limpieza no estructural: ningun archetype sale del JSON, solo
--    pierden 'diana:true' los que se solapan con cards combinadas
--    nuevas (ninera y manicurista). El SQL no toca esa parte.
-- ============================================================

INSERT INTO categories (sector, sector_label, specialty, specialty_label, meta_title, meta_desc, sort_order) VALUES
  -- ── oficios (specialty nueva) ──────────────────────────────
  ('oficios', 'Oficios', 'instalador-clima', 'Instaladores de clima', 'Instaladores de clima en Espana', 'Encuentra instaladores de aire acondicionado, calefaccion y bombas de calor cerca de ti.', 5),

  -- ── otros (sector NUEVO, fallback "No me veo aqui") ────────
  ('otros',   'Otros',   'otro-oficio',      'Otros oficios',         'Otros oficios y servicios en Espana','Encuentra profesionales de otros oficios y servicios cerca de ti.',                          99)

ON CONFLICT (sector, specialty) DO NOTHING;

-- specialty_custom: solo se rellena cuando specialty = 'otro-oficio'.
-- Si la columna no existiera, register-free / edit-card siguen funcionando
-- (el insert/update lo ignoraria como columna desconocida).
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS specialty_custom text;

COMMENT ON COLUMN cards.specialty_custom IS
  'Texto libre del oficio cuando el usuario eligio "No me veo aqui" en el alta '
  '(category.specialty = otro-oficio). El PDF imprimible y el chip publico lo '
  'prefieren sobre specialty_label para mostrar el oficio real ("Limpiacristales") '
  'en vez del label generico ("Otros oficios").';
