-- ============================================================
-- 050_expediente.sql · Expediente de desarrollo integral:
-- roles declarados por el club, catálogo de módulos y matriz
-- módulo×categoría por club.
--
-- Fase 2 de la fusión CATORZE → CANTERA. La 049 dio acceso al cuerpo
-- técnico; ésta le da al club la capacidad de declarar SU estructura y
-- activar los módulos que use, sin pasar por el founder.
--
-- Reparto de propiedad (decisión del cliente, 20/08):
--   · expediente_modulos → GLOBAL, sin organization_id. Es producto: si
--     cada club inventa módulos se pierde la comparabilidad entre clubes,
--     y en cuanto un módulo tenga contenido, definirlo será construir y no
--     configurar.
--   · expediente_matriz  → POR CLUB. Es metodología: "Aula 14 no aplica a
--     amateur" no es un ajuste técnico, es cómo trabaja ese club.
--
-- Ejecutar manualmente en Supabase SQL Editor. Idempotente.
-- ============================================================

-- ── Roles que el club declara ────────────────────────────────
--
-- El código sale del catálogo cerrado de lib/club-staff.js (mismo que la
-- 049); la etiqueta la pone el club. Así la estructura sigue siendo
-- comparable entre clubes y el lenguaje es el suyo: código
-- `preparador`, etiqueta "Mister físico". Mismo patrón que club_teams
-- (competición del catálogo federativo + label libre).
CREATE TABLE IF NOT EXISTS org_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  role_code        text NOT NULL,
  label            text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

ALTER TABLE org_roles DROP CONSTRAINT IF EXISTS org_roles_role_check;
ALTER TABLE org_roles ADD CONSTRAINT org_roles_role_check
  CHECK (role_code IN (
    'direccion_deportiva','coordinacion','entrenador','preparador',
    'fisio','medico','psicologia','nutricion','aula_academica',
    'analisis','delegado','directiva'
  ));

-- Un club no declara dos veces el mismo rol. Parcial sobre los vivos para
-- que borrar y volver a declarar funcione.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_roles_active
  ON org_roles (organization_id, role_code)
  WHERE deleted_at IS NULL;

-- ── Catálogo global de módulos ───────────────────────────────
--
-- `id` es un slug estable, no un uuid: se referencia desde la matriz y
-- desde el código, y un slug legible hace las queries de soporte
-- comprensibles sin joins.
CREATE TABLE IF NOT EXISTS expediente_modulos (
  id                 text PRIMARY KEY,
  orden              integer NOT NULL,
  nombre_es          text NOT NULL,
  default_role_code  text,
  activo             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Los 10 módulos del expediente. `default_role_code` es sólo la sugerencia
-- que el alta del club ofrece al activar; el rol real lo fija la matriz,
-- porque no todos los clubes tienen los ocho roles cubiertos.
INSERT INTO expediente_modulos (id, orden, nombre_es, default_role_code, activo) VALUES
  ('identidad',           1,  'Identidad',                'entrenador',          true),
  ('perfil_futbolistico', 2,  'Perfil futbolístico',      'entrenador',          true),
  ('perfil_fisico',       3,  'Perfil físico',            'preparador',          true),
  ('lesiones',            4,  'Disponibilidad y lesiones','fisio',               true),
  ('perfil_emocional',    5,  'Perfil emocional',         'psicologia',          true),
  ('perfil_nutricional',  6,  'Perfil nutricional',       'nutricion',           true),
  ('aula_academica',      7,  'Aula académica',           'aula_academica',      true),
  ('videoteca',           8,  'Videoteca',                'analisis',            true),
  ('evolucion_global',    9,  'Evolución global',         'direccion_deportiva', true),
  ('informes',            10, 'Informes',                 'direccion_deportiva', true)
ON CONFLICT (id) DO NOTHING;

-- ── Matriz módulo × categoría, por club ──────────────────────
--
-- Una fila por (club, módulo, categoría). `aplica=false` significa que ese
-- club NO usa ese módulo en esa categoría; se guarda la fila igualmente
-- para conservar la decisión y la periodicidad elegida por si lo reactiva.
CREATE TABLE IF NOT EXISTS expediente_matriz (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  modulo_id        text NOT NULL REFERENCES expediente_modulos(id),
  category_id      uuid NOT NULL REFERENCES sports_categories(id),
  aplica           boolean NOT NULL DEFAULT false,
  periodicidad     text NOT NULL DEFAULT 'inicial-final',
  role_code        text,
  variante_notas   text NOT NULL DEFAULT '',
  activated_at     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expediente_matriz DROP CONSTRAINT IF EXISTS expediente_matriz_periodicidad_check;
ALTER TABLE expediente_matriz ADD CONSTRAINT expediente_matriz_periodicidad_check
  CHECK (periodicidad IN (
    'alta','inicial-final','trimestral','mensual','por-evento','continua'
  ));

ALTER TABLE expediente_matriz DROP CONSTRAINT IF EXISTS expediente_matriz_role_check;
ALTER TABLE expediente_matriz ADD CONSTRAINT expediente_matriz_role_check
  CHECK (role_code IS NULL OR role_code IN (
    'direccion_deportiva','coordinacion','entrenador','preparador',
    'fisio','medico','psicologia','nutricion','aula_academica',
    'analisis','delegado','directiva'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_expediente_matriz_unica
  ON expediente_matriz (organization_id, modulo_id, category_id);

CREATE INDEX IF NOT EXISTS idx_expediente_matriz_club
  ON expediente_matriz (organization_id)
  WHERE aplica = true;

-- `activated_at` implementa la regla "activar genera hacia delante": es el
-- suelo desde el que el motor produce hitos. Si el club enciende un módulo
-- en marzo, los hitos ya vencidos de esa temporada NO se inventan.

-- RLS on + REVOKE (patrón Cantera 033-049). Acceso sólo vía
-- SUPABASE_SERVICE_KEY. `expediente_modulos` es catálogo de lectura, pero
-- se cierra igual: lo sirve el backend, no el navegador.
ALTER TABLE org_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_roles FROM anon, authenticated;

ALTER TABLE expediente_modulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON expediente_modulos FROM anon, authenticated;

ALTER TABLE expediente_matriz ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON expediente_matriz FROM anon, authenticated;

-- ── Contramigración (manual) ──────────────────────────────
-- DROP TABLE IF EXISTS expediente_matriz;
-- DROP TABLE IF EXISTS expediente_modulos;
-- DROP TABLE IF EXISTS org_roles;
