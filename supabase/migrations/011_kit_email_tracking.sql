-- ============================================================
-- Migracion 011: timestamp de envio del email post-pago (kit fisico)
--
-- Anade auditoria minima para soporte: cuando se mando por ultima vez
-- el welcome email con la tarjeta imprimible + QR + factura adjuntos.
-- Setea stripe-webhook en el envio inicial; lo refresca resend-kit
-- cuando un admin reenvia el kit desde el panel.
--
-- No bloquea ningun flujo: si la columna no existiera, los endpoints
-- siguen funcionando (los UPDATE de timestamp son fire-and-forget).
-- ============================================================

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS kit_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN cards.kit_email_sent_at IS
  'Ultimo envio del email post-pago con kit (tarjeta + QR + factura). '
  'Lo setea stripe-webhook en el envio inicial; lo refresca resend-kit.';
