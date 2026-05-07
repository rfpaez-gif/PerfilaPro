-- ============================================================
-- 016_demo_pasteleria_sebastian.sql · Card seed para landing demo
-- Ejecutar manualmente en Supabase SQL Editor.
--
-- Contexto: el landing (index.html, sección Anatomía) muestra un
-- mockup HTML estático de "Pastelería Sebastián". Sin card real
-- detrás, el visitante curioso que quiere ver "como queda de
-- verdad" no tiene destino.
--
-- Esta migracion crea la card en BD para que /c/pasteleria-sebastian
-- renderice un perfil completo, con todas las features de Anual
-- (foto opcional, QR, directorio). El slug se whitelistea ademas
-- en card.js (DEMO_SLUGS) para forzar el tratamiento Anual aunque
-- no haya stripe_session_id.
--
-- Datos: TODOS ficticios pero coherentes con el mockup del landing.
--   - Nombre y servicios = los del mockup (Tartas a medida, Eventos, Sin gluten)
--   - WhatsApp 34900000001 (rango 900-XXX-XXX-XXX usado para
--     numeracion de servicios; no asigna a un movil real)
--   - Email demo@perfilapro.es (dominio propio)
--   - Direccion ficticia en Alicante, local_publico=false (no
--     queremos un mapa apuntando a una direccion real)
--   - is_seed=true (marca como seed para metricas y futuras
--     limpiezas; no contamina dashboards de altas reales)
--
-- Idempotencia: ON CONFLICT (slug) DO NOTHING. Si ya existe, no
-- toca nada — usa UPDATE manual si necesitas modificar.
-- ============================================================

INSERT INTO cards (
  slug,
  nombre,
  tagline,
  zona,
  servicios,
  whatsapp,
  email,
  direccion,
  local_publico,
  descripcion,
  plan,
  status,
  stripe_session_id,
  is_seed,
  expires_at,
  created_at
)
VALUES (
  'pasteleria-sebastian',
  'Pastelería Sebastián',
  'Confitería tradicional',
  'Alicante',
  '["Tartas a medida", "Eventos y celebraciones", "Repostería sin gluten"]'::jsonb,
  '34900000001',
  'demo@perfilapro.es',
  NULL,            -- sin direccion real para evitar mapa apuntando a alguien
  false,           -- local_publico OFF (defensivo)
  'Confitería de barrio. Tartas, dulces tradicionales y opción sin gluten. Encargos para cumpleaños, bodas y eventos.',
  'pro',           -- Plan Anual: foto + QR + directorio + stats
  'active',
  -- Marker reconocible para distinguir esta seed de un cs_test_/cs_live_
  -- de Stripe real. card.js lee stripe_session_id como flag isPaid; sin
  -- esto el qr.js trataria la card como Free y le pondria marca de agua,
  -- incoherente con plan='pro'. El prefijo "cs_demo_" deja claro en BD
  -- que NO es una sesion real de Stripe y nunca colisionara con una.
  'cs_demo_pasteleria_sebastian',
  true,            -- seed: no cuenta como alta real
  -- Expira muy lejos en el futuro para que no caduque automáticamente
  (NOW() + INTERVAL '50 years'),
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verificación: listar la fila creada.
-- ============================================================
SELECT slug, nombre, tagline, zona, plan, status, is_seed, expires_at
FROM cards
WHERE slug = 'pasteleria-sebastian';
