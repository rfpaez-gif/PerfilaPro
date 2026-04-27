const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

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
      .select('slug, nombre, tagline, zona, servicios, whatsapp, telefono, foto_url, descripcion, direccion, edit_token_expires_at, category_id, city_slug, directory_visible')
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

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El enlace de edición ha expirado. Solicita uno nuevo.' }),
      };
    }

    if (event.httpMethod === 'GET') {
      let category_sector = null;
      let category_specialty = null;
      if (card.category_id) {
        const { data: cat } = await db
          .from('categories')
          .select('sector, specialty')
          .eq('id', card.category_id)
          .maybeSingle();
        if (cat) { category_sector = cat.sector; category_specialty = cat.specialty; }
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...card, category_sector, category_specialty }),
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

      const { nombre, tagline, zona, servicios, whatsapp, telefono, foto_url, descripcion, direccion,
              sector, specialty, city_slug, directory_visible } = body;

      const ALLOWED_FOTO_HOSTS = [
        'supabase.co/storage',
        'supabase.in/storage',
      ];
      const fotoUrlClean = foto_url && ALLOWED_FOTO_HOSTS.some(h => foto_url.includes(h)) ? foto_url : null;

      if (!nombre || !zona || !whatsapp || !Array.isArray(servicios) || servicios.length === 0) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Faltan campos obligatorios' }),
        };
      }

      // Resolve category_id from sector + specialty slugs
      let category_id = null;
      if (sector && specialty) {
        const { data: cat } = await db
          .from('categories')
          .select('id')
          .eq('sector', sector)
          .eq('specialty', specialty)
          .maybeSingle();
        category_id = cat?.id || null;
      }

      const dirVisible = category_id && city_slug ? !!directory_visible : false;

      const { error: updateError } = await db
        .from('cards')
        .update({
          nombre:             stripTags(nombre).substring(0, 100),
          tagline:            tagline ? stripTags(tagline).substring(0, 100) : null,
          zona:               stripTags(zona).substring(0, 100),
          servicios:          servicios.map(s => stripTags(s).substring(0, 100)),
          whatsapp:           whatsapp.replace(/\D/g, ''),
          telefono:           telefono ? telefono.replace(/\D/g, '') : null,
          foto_url:           fotoUrlClean,
          descripcion:        descripcion ? stripTags(descripcion).substring(0, 200) : null,
          direccion:          direccion ? stripTags(direccion).substring(0, 200) : null,
          category_id:        category_id,
          city_slug:          city_slug ? stripTags(city_slug).substring(0, 80) : null,
          directory_visible:  dirVisible,
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
