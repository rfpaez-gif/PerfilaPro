-- ============================================================
-- Migracion 013: checkout_vector por categoria
--
-- El banner de upgrade (pp-showcase en editar.html) muestra hoy
-- una furgoneta a TODOS los free-users. Para fisios, peluqueras,
-- profesoras o empleadas del hogar la furgoneta es ajena y rompe
-- la promesa de personalizacion del componente ("Tu trabajo, asi
-- se va a ver").
--
-- Resolucion: 3 vectores potentes que cubren los modos fisicos
-- del trabajador autonomo espanol:
--   - 'van'     : profesionales moviles con vehiculo de trabajo
--                 (oficios, reforma, transporte, jardineria)
--   - 'local'   : profesionales con sitio fijo de cara al publico
--                 (belleza, comercio, hosteleria, automocion,
--                 fitness, salud)
--   - 'tarjeta' : profesionales sin local definido / servicios a
--                 domicilio del cliente / oficina (cuidados,
--                 educacion, legal, tech, comercial, fotografia,
--                 turismo, eventos, seguridad, otros) - DEFAULT.
--
-- Mapeo grueso por sector + 2 overrides quirurgicos. Cualquier
-- specialty futura hereda el vector de su sector sin tocar este
-- mapping. El DEFAULT 'tarjeta' garantiza que ningun perfil rompe
-- el render aunque caiga en un sector no previsto.
-- ============================================================

ALTER TABLE categories
  ADD COLUMN checkout_vector text NOT NULL DEFAULT 'tarjeta';

UPDATE categories SET checkout_vector = 'van'
  WHERE sector IN ('oficios', 'reforma', 'transporte', 'jardineria');

UPDATE categories SET checkout_vector = 'local'
  WHERE sector IN ('belleza', 'comercio', 'hosteleria', 'automocion', 'fitness', 'salud');

-- Overrides quirurgicos: moviles dentro de sectores 'local' por defecto.
UPDATE categories SET checkout_vector = 'van'
  WHERE (sector, specialty) IN (
    ('salud', 'tecnico-emergencias'),
    ('seguridad', 'instalador-alarmas')
  );
