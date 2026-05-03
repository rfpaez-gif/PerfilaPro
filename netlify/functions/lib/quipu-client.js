'use strict';

/**
 * Cliente Quipu para emision de facturas con Verifactu/AEAT.
 *
 * SKELETON · Sprint 1.
 * No hay implementacion real de la API todavia. Las funciones lanzan
 * un error 'not implemented' a proposito para que cualquier llamada
 * accidental falle visiblemente en lugar de silenciosamente.
 *
 * La implementacion entra en Sprint 3 cuando:
 *   - el proveedor de facturacion este firmado (validacion en curso),
 *   - el alta de autonomo del emisor este formalizada,
 *   - Stripe live + Stripe Subscription esten activados.
 *
 * Variables de entorno esperadas en produccion:
 *   QUIPU_CLIENT_ID
 *   QUIPU_CLIENT_SECRET
 *   QUIPU_API_BASE     (default: https://getquipu.com/api/v2)
 *   QUIPU_ENV          (sandbox | production)
 *
 * Patron `makeClient(deps)` para que los tests inyecten un mock sin
 * tocar variables de entorno (consistente con el resto de funciones).
 */

const NOT_IMPLEMENTED = 'quipu-client: not implemented yet (planned for Sprint 3)';

function makeClient({ clientId, clientSecret, apiBase, env } = {}) {
  return {
    /**
     * Emite una factura a un cliente final.
     *
     * @param {Object} params
     * @param {string} params.cardSlug   slug del card en BD
     * @param {string} params.email      email del receptor
     * @param {string} [params.nif]      NIF/CIF del receptor (opcional)
     * @param {number} params.amount     importe sin IVA, en EUR
     * @param {number} [params.ivaRate]  tipo IVA (default 21)
     * @param {string} params.concept    concepto de la factura
     * @param {'monthly'|'yearly'} params.period
     * @returns {Promise<{numero: string, pdfUrl: string, verifactuId: string}>}
     */
    async createInvoice(_params) {
      throw new Error(NOT_IMPLEMENTED);
    },

    /**
     * Anula una factura emitida (genera factura rectificativa).
     *
     * @param {string} invoiceId
     * @param {string} reason   motivo de la rectificacion
     * @returns {Promise<{numero: string, pdfUrl: string}>}
     */
    async voidInvoice(_invoiceId, _reason) {
      throw new Error(NOT_IMPLEMENTED);
    },

    /**
     * Recupera metadata de una factura previamente emitida.
     *
     * @param {string} invoiceId
     * @returns {Promise<{numero: string, pdfUrl: string, status: string, verifactuId: string}>}
     */
    async getInvoice(_invoiceId) {
      throw new Error(NOT_IMPLEMENTED);
    },

    // Expuesto para que los tests verifiquen que la config llega
    _config: { clientId, clientSecret, apiBase, env },
  };
}

module.exports = { makeClient };
