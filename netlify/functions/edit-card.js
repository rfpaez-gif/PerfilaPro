const { createClient } = require('@supabase/supabase-js');
const { normalizeSpanishPhone } = require('./lib/phone-utils');
const { isValidCp, lookupCp, normalizeCp } = require('./lib/cp-utils');

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
      .select('slug, nombre, tagline, cp, zona, servicios, whatsapp, telefono, foto_url, descripcion, direccion, local_publico, email, edit_token_expires_at, category_id, specialty_custom, city_slug, directory_visible, plan, status, stripe_session_id, kit_email_sent_at, organization_id')
      .eq('slug', slug)
      .eq('edit_token', token)
      .in('status', ['active', 'free'])
      .is('deleted_at', null)
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
      // Flag de la promo de lanzamiento — el editor lo lee para mostrar
      // el banner "100% bonificado" y cambiar el CTA del freeBanner.
      // Si LAUNCH_PROMO_ACTIVE no está, el frontend mantiene el flujo
      // de Stripe normal sin tocar nada.
      const launch_promo_active = process.env.LAUNCH_PROMO_ACTIVE === '1';

      // Organization branding — si la card está asignada a una org
      // (carril B2B), devolvemos los campos visibles para que /editar
      // pinte un banner "Formas parte de [Org]" arriba del formulario.
      // Lookup defensivo: si la org está soft-deleted o no existe,
      // simplemente no devolvemos branding y el banner queda oculto.
      let organization = null;
      if (card.organization_id) {
        const { data: org } = await db
          .from('organizations')
          .select('slug, name, logo_url, color_primary')
          .eq('id', card.organization_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (org) organization = org;
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...card, category_sector, category_specialty, launch_promo_active, organization }),
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

      const { nombre, tagline, cp, servicios, whatsapp, telefono, foto_url, descripcion, direccion, local_publico,
              sector, specialty, specialty_custom } = body;

      const ALLOWED_FOTO_HOSTS = [
        'supabase.co/storage',
        'supabase.in/storage',
      ];
      const fotoUrlClean = foto_url && ALLOWED_FOTO_HOSTS.some(h => foto_url.includes(h)) ? foto_url : null;

      if (!nombre || !cp || !whatsapp || !Array.isArray(servicios)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Faltan campos obligatorios' }),
        };
      }

      const cpNormalized = normalizeCp(cp);
      if (!isValidCp(cpNormalized)) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Código postal inválido' }),
        };
      }

      const waNorm = normalizeSpanishPhone(whatsapp);
      if (!waNorm.ok) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'WhatsApp inválido (9 dígitos, móvil 6/7 o fijo 8/9)' }),
        };
      }
      let telefonoClean = null;
      if (telefono) {
        const tNorm = normalizeSpanishPhone(telefono);
        if (!tNorm.ok) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Teléfono inválido (9 dígitos, móvil 6/7 o fijo 8/9)' }),
          };
        }
        telefonoClean = tNorm.local;
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

      // specialty_custom solo se persiste cuando specialty es 'otro-oficio'.
      // Para cualquier otra specialty se limpia a null para que el PDF no
      // muestre un texto libre obsoleto sobre la specialty_label canonica.
      const specialtyCustomClean = (specialty === 'otro-oficio' && specialty_custom)
        ? stripTags(specialty_custom).substring(0, 60)
        : null;

      // Re-resolver zona + city_slug desde CP. directory_visible se reactiva
      // automáticamente si hay categoría + city_slug; si el usuario edita su CP
      // a uno de provincia distinta, su perfil migra de directorio sin tocar
      // nada manual.
      const cpRow = await lookupCp(db, cpNormalized);
      const zonaResolved = cpRow?.municipality_name || '';
      const citySlugResolved = cpRow?.province_slug || null;
      const dirVisibleResolved = !!(category_id && citySlugResolved);

      const { error: updateError } = await db
        .from('cards')
        .update({
          nombre:             stripTags(nombre).substring(0, 100),
          tagline:            tagline ? stripTags(tagline).substring(0, 100) : null,
          cp:                 cpNormalized,
          zona:               zonaResolved.substring(0, 100),
          servicios:          servicios.map(s => stripTags(s).substring(0, 100)),
          whatsapp:           waNorm.e164,
          telefono:           telefonoClean,
          foto_url:           fotoUrlClean,
          descripcion:        descripcion ? stripTags(descripcion).substring(0, 200) : null,
          direccion:          direccion ? stripTags(direccion).substring(0, 200) : null,
          // local_publico solo cuenta si hay dirección efectiva — el toggle ON
          // sin dirección no expone nada en la tarjeta y nos evita renderizar
          // un link a Google Maps con string vacío.
          local_publico:      local_publico === true && !!(direccion && stripTags(direccion).trim()),
          category_id:        category_id,
          specialty_custom:   specialtyCustomClean,
          city_slug:          citySlugResolved,
          directory_visible:  dirVisibleResolved,
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
