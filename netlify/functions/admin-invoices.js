const { createClient } = require('@supabase/supabase-js');
const { buildPDF } = require('./invoice-utils');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = checkAdminAuth(event);
  if (!auth.authorized) return unauthorizedResponse(auth.blocked);

  const { numero, from, to } = event.queryStringParameters || {};

  // Descarga de factura individual en PDF
  if (numero) {
    const { data, error } = await supabase
      .from('facturas')
      .select('*')
      .eq('numero_factura', numero)
      .single();

    if (error || !data) {
      return { statusCode: 404, body: 'Factura no encontrada' };
    }

    try {
      const pdfBuffer = await buildPDF({
        numero: data.numero_factura,
        fecha: data.fecha,
        emailCliente: data.email_cliente,
        nombreCliente: data.nombre_cliente,
        plan: data.plan,
        base: data.base_imponible,
        iva: data.iva,
        total: data.total,
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="factura-${numero}.pdf"`,
        },
        body: pdfBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // Listado de facturas con filtro opcional por fecha
  let query = supabase
    .from('facturas')
    .select('*')
    .order('fecha', { ascending: false });

  if (from) query = query.gte('fecha', from);
  if (to)   query = query.lte('fecha', `${to}T23:59:59Z`);

  const { data, error } = await query;

  if (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ facturas: data || [] }),
  };
};
