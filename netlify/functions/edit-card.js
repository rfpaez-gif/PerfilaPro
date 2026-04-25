const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    const { slug, token } = event.queryStringParameters || {};

    if (!slug || !token) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parámetros inválidos' }),
      };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, tagline, zona, servicios, whatsapp, telefono, foto_url, descripcion')
      .eq('slug', slug)
      .eq('edit_token', token)
      .eq('status', 'active')
      .single();

    if (error || !card) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Enlace inválido o expirado' }),
      };
    }

    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
      };
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'JSON inválido' }),
        };
      }

      const { nombre, tagline, zona, servicios, whatsapp, telefono, foto_url, descripcion } = body;

      if (!nombre || !zona || !whatsapp || !Array.isArray(servicios) || servicios.length === 0) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Faltan campos obligatorios' }),
        };
      }

      const { error: updateError } = await db
        .from('cards')
        .update({
          nombre,
          tagline: tagline || null,
          zona,
          servicios,
          whatsapp: whatsapp.replace(/\D/g, ''),
          telefono: telefono ? telefono.replace(/\D/g, '') : null,
          foto_url: foto_url || null,
          descripcion: descripcion ? descripcion.substring(0, 200) : null,
        })
        .eq('slug', slug);

      if (updateError) {
        console.error('Error actualizando perfil:', updateError.message);
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Error actualizando perfil' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
