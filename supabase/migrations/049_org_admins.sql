-- ============================================================
-- 049_org_admins.sql · Cuerpo técnico con acceso al Studio del
-- club (fase 1 de la fusión CATORZE → CANTERA).
--
-- Motivación: hasta ahora un club = un email = un admin. El acceso al
-- panel se resolvía con `organizations.email`, y quien tuviera ese email
-- entraba con permisos totales. Suficiente para un despacho B2B; no para
-- un club de cantera, donde la preparadora física, la fisio, la psicóloga
-- y el docente necesitan entrar cada uno a ver lo suyo.
--
-- Esto es la deuda que el CLAUDE.md ya tenía declarada: «Múltiples admins
-- / roles por org → se añade tabla org_admins cuando un cliente lo pida».
--
-- Dos tablas, no una, y a propósito: la PERSONA y la RELACIÓN
-- (persona, rol, equipo) son cosas distintas. Una persona puede tener
-- varios roles (al arrancar, la coordinadora es también nutricionista) y
-- un rol puede tener distinta persona según el equipo (la entrenadora de
-- benjamín no es la de juvenil). Fundirlas perdería el reparto por equipo.
--
-- `organizations.email` NO desaparece: sigue siendo la dueña del club, con
-- permisos totales. org_admins son accesos adicionales y acotados.
--
-- Ejecutar manualmente en Supabase SQL Editor. Idempotente.
-- ============================================================

-- ── La persona ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_admins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  email            text NOT NULL,
  name             text,
  invited_at       timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Sin ON DELETE en la FK a organizations (mismo criterio que el resto del
-- carril Cantera): borrar un club no debe llevarse por delante su cuerpo
-- técnico en silencio; obliga a una limpieza explícita.

-- Un mismo email no puede tener dos accesos VIVOS al mismo club. El índice
-- es parcial sobre los no revocados, así que revocar y volver a invitar a
-- la misma persona funciona sin chocar contra el índice ni perder el
-- rastro de la revocación anterior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_admins_email_active
  ON org_admins (organization_id, email)
  WHERE revoked_at IS NULL;

-- Lookup del magic-link: panel-auth busca por email entre los accesos
-- vivos. Un email puede estar en varios clubes (una fisio que trabaja para
-- dos), por eso no es único a secas.
CREATE INDEX IF NOT EXISTS idx_org_admins_email
  ON org_admins (email)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_admins_org
  ON org_admins (organization_id);

-- ── La relación (persona, rol, equipo) ───────────────────────
CREATE TABLE IF NOT EXISTS org_admin_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_admin_id  uuid NOT NULL REFERENCES org_admins(id) ON DELETE CASCADE,
  role_code     text NOT NULL,
  team_id       uuid REFERENCES club_teams(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- CASCADE aquí sí: estas filas no tienen valor propio fuera de su persona,
-- y si un equipo se borra la asignación a ese equipo deja de significar
-- nada. El rastro de quién tuvo acceso lo guarda org_admins.revoked_at.

-- `team_id NULL` = todos los equipos del club (p.ej. una fisio que cubre
-- toda la cantera). El catálogo de códigos vive en lib/club-staff.js; el
-- CHECK lo replica para que la BD no acepte un rol inventado aunque el
-- backend fallara.
ALTER TABLE org_admin_roles DROP CONSTRAINT IF EXISTS org_admin_roles_role_check;
ALTER TABLE org_admin_roles ADD CONSTRAINT org_admin_roles_role_check
  CHECK (role_code IN (
    'direccion_deportiva',
    'coordinacion',
    'entrenador',
    'preparador',
    'fisio',
    'medico',
    'psicologia',
    'nutricion',
    'aula_academica',
    'analisis',
    'delegado',
    'directiva'
  ));

-- Sin duplicados. Hacen falta DOS índices parciales porque Postgres trata
-- los NULL como distintos entre sí en un UNIQUE normal: sin el segundo,
-- (persona, 'fisio', NULL) podría insertarse dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_admin_roles_team
  ON org_admin_roles (org_admin_id, role_code, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_admin_roles_allteams
  ON org_admin_roles (org_admin_id, role_code)
  WHERE team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_admin_roles_admin
  ON org_admin_roles (org_admin_id);

-- RLS on + REVOKE desde el arranque (patrón Cantera 033-039). El acceso es
-- exclusivamente vía SUPABASE_SERVICE_KEY, que salta RLS; anon y
-- authenticated quedan denegados por defecto. Aquí hay emails de personas
-- identificables, así que el default restrictivo importa.
ALTER TABLE org_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_admins FROM anon, authenticated;

ALTER TABLE org_admin_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_admin_roles FROM anon, authenticated;

-- ── Contramigración (manual) ──────────────────────────────
-- DROP TABLE IF EXISTS org_admin_roles;
-- DROP TABLE IF EXISTS org_admins;
