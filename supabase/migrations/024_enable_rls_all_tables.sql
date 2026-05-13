-- ============================================================
-- 024_enable_rls_all_tables.sql · RLS defensiva en todas las tablas
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Motivación:
--   El Security Advisor de Supabase marca CRITICAL cualquier tabla
--   del esquema `public` con RLS desactivado, asumiendo el peor caso
--   (que la `anon` key acabe expuesta y un atacante pueda leer/
--   escribir/borrar via PostgREST).
--
--   PerfilaPro accede a Supabase exclusivamente desde Netlify
--   Functions con `SUPABASE_SERVICE_KEY`, y `SUPABASE_ANON_KEY` no se
--   usa en ningún sitio del repo (verificado por grep). Aun así,
--   activar RLS sin policies cuesta cero y aporta defense-in-depth:
--
--     - `service_role` SALTA RLS por diseño  → todas las funciones
--       Netlify siguen funcionando sin cambios.
--     - `anon` y `authenticated` SIN policies → denegado por
--       defecto. Si la anon key se filtra (o si en el futuro alguien
--       expone una ruta directa desde el frontend), las tablas no
--       quedan abiertas.
--
--   Mismo patrón que `admin_audit_log` desde la migración 002.
--
-- Idempotente: `ENABLE ROW LEVEL SECURITY` solo flipea un flag en
-- pg_class. Re-ejecutar no rompe nada.
--
-- Reversible: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` por
-- tabla (solo necesario si en el futuro se introduce acceso anon
-- directo y se prefiere escribir policies en lugar de mantener la
-- postura defensiva).
--
-- Tras ejecutar este SQL hay que actualizar `supabase/RLS.md` para
-- reflejar el nuevo estado (ya se hizo en el mismo commit).
-- ============================================================

-- Tablas con datos de negocio sensibles (PII, billing, auth)
ALTER TABLE cards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_liquidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_leads          ENABLE ROW LEVEL SECURITY;

-- Catálogos de referencia (no contienen PII, pero los blindamos
-- igualmente para silenciar el advisor y mantener postura uniforme).
ALTER TABLE categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE postal_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocupaciones  ENABLE ROW LEVEL SECURITY;

-- admin_audit_log ya tiene RLS activada desde 002_audit_log.sql.
-- Lo re-aplicamos por idempotencia (no-op si ya estaba on).
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Notas operativas
-- ============================================================
--   * NINGUNA tabla recibe policies en esta migración. Eso es
--     intencional: sin policies, anon y authenticated quedan
--     completamente denegados (postura "deny by default"), que es
--     exactamente lo que queremos mientras el único cliente sea
--     el service_role.
--
--   * Si alguna vez se introduce acceso directo desde el frontend
--     (suscripciones realtime, Supabase Auth, Storage signed URLs
--     emitidas por anon), HAY que escribir las policies necesarias
--     en la misma migración que habilita ese acceso. NUNCA dejar
--     una policy permisiva (`USING (true)`) por comodidad.
--
--   * Para verificar tras ejecutar:
--       SELECT relname, relrowsecurity
--         FROM pg_class
--        WHERE relnamespace = 'public'::regnamespace
--          AND relkind = 'r'
--        ORDER BY relname;
--     Todas las filas deben mostrar `relrowsecurity = true`.
-- ============================================================
