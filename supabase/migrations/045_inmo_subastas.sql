-- ============================================================
-- 045_inmo_subastas.sql · Vertical INMO (rastreo de subastas)
--
-- Rastreo automático de subastas de inmuebles del Portal de Subastas
-- del BOE en la franja costera de la provincia de Tarragona (Costa
-- Daurada + costa de les Terres de l'Ebre).
--
-- Entidad PROPIA — NO se sobrecarga `cards` (que modela personas:
-- autónomos, jugadores, staff). Una finca subastada tiene datos
-- (valor, depósito, fechas, juzgado, identificador SUB-…) que no caben
-- en una tarjeta de persona. Reusa de la maquinaria de PerfilaPro el
-- patrón (Supabase + scheduled function + Resend) y el render público
-- server-side, pero con tablas propias.
--
-- Todo el carril está gateado en runtime por INMO_VERTICAL_ACTIVE
-- (mismo patrón que CANTERA_VERTICAL_ACTIVE). Estas tablas quedan
-- dormidas hasta que se encienda — cero impacto en autónomos / B2B /
-- Cantera.
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- ============================================================

-- ── subastas ──────────────────────────────────────────────
-- Una fila por BIEN inmueble costero (no por anuncio): una subasta
-- (SUB-…) puede tener varios lotes en distintos municipios, y el
-- filtro costero es por bien. La PK combina id de subasta + lote.
CREATE TABLE IF NOT EXISTS subastas (
  id                       text PRIMARY KEY,          -- `${id_subasta}` o `${id_subasta}-L{lote}`
  id_subasta               text NOT NULL,             -- identificador BOE: SUB-JA-2024-123456
  lote                     integer,                   -- nº de lote dentro de la subasta (NULL si única)
  slug                     text NOT NULL UNIQUE,      -- URL pública /s/:slug

  estado                   text,                      -- proxima | abierta | cerrada | desierta | suspendida
  tipo_subasta             text,                      -- judicial | aeat | seg_social | concursal | notarial
  tipo_bien                text,                      -- vivienda | local | garaje | suelo | nave | finca_rustica | otro

  municipio                text,                      -- municipio costero canónico (resuelto por el geofiltro)
  localidad_raw            text,                      -- localidad tal cual la publica el BOE
  direccion                text,
  provincia                text DEFAULT 'Tarragona',
  ref_catastral            text,
  lat                      double precision,
  lng                      double precision,

  valor_subasta_cents      bigint,                    -- importes en céntimos (convención del repo)
  tasacion_cents           bigint,
  deposito_cents           bigint,
  puja_minima_cents        bigint,
  cantidad_reclamada_cents bigint,

  fecha_inicio             timestamptz,
  fecha_fin                timestamptz,

  autoridad                text,                      -- juzgado / organismo convocante
  boe_anuncio              text,                      -- BOE-B-AAAA-NNNNN
  boe_url                  text,
  detalle_url              text,                      -- subastas.boe.es/detalleSubasta.php?idSub=…

  fotos                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw                      jsonb,                     -- volcado crudo de lo extraído (auditoría / reproceso)

  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz,

  notified_new             boolean NOT NULL DEFAULT false,
  notified_closing         boolean NOT NULL DEFAULT false,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subastas_estado      ON subastas (estado);
CREATE INDEX IF NOT EXISTS idx_subastas_fecha_fin   ON subastas (fecha_fin);
CREATE INDEX IF NOT EXISTS idx_subastas_municipio   ON subastas (municipio);
CREATE INDEX IF NOT EXISTS idx_subastas_last_seen   ON subastas (last_seen_at);
-- Cola de avisos pendientes (subastas nuevas aún sin notificar).
CREATE INDEX IF NOT EXISTS idx_subastas_pend_new    ON subastas (notified_new) WHERE notified_new = false;

-- ── subasta_visits ────────────────────────────────────────
-- Log de visitas de la página pública (no bloqueante), espejo del
-- patrón `visits` de cards pero en tabla propia para no mezclar la
-- analítica de tarjetas de persona con la de fincas.
CREATE TABLE IF NOT EXISTS subasta_visits (
  id            bigserial PRIMARY KEY,
  subasta_slug  text NOT NULL,
  visited_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subasta_visits_slug ON subasta_visits (subasta_slug, visited_at);

-- ── RLS ───────────────────────────────────────────────────
-- Acceso exclusivo vía service_role (las funciones Netlify usan
-- SUPABASE_SERVICE_KEY, que salta RLS). Sin políticas para anon: la
-- página pública la sirve la función server-side, no el cliente.
ALTER TABLE subastas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subasta_visits ENABLE ROW LEVEL SECURITY;

-- ── Contramigración (manual) ──────────────────────────────
-- DROP TABLE IF EXISTS subasta_visits;
-- DROP TABLE IF EXISTS subastas;
