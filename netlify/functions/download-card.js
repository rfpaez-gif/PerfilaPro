// Re-descarga del PDF imprimible de la tarjeta. Auth por token (mismo
// edit_token que edit-card / send-edit-link), TTL 7 días. Sirve para que el
// usuario pueda re-descargar la tarjeta desde el editor si pierde el email
// post-pago original.
//
// El asset original se genera y se adjunta automáticamente en stripe-webhook;
// este endpoint solo regenera bajo demanda con la última identidad guardada.

const { createClient } = require('@supabase/supabase-js');
const { buildPrintableCardPDF, buildBusinessCardPDF, fetchLogoAsPngBuffer } = require('./printable-card-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'download-card', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    const { slug, token } = event.queryStringParameters || {};
    if (!slug || !token) {
      return { statusCode: 400, body: 'Missing slug or token' };
    }

    const { data: card, error } = await db
      .from('cards')
      .select('slug, nombre, tagline, whatsapp, email, direccion, zona, edit_token_expires_at, organization_id, plan, categories(specialty_label)')
      .eq('slug', slug)
      .eq('edit_token', token)
      .in('status', ['active', 'free'])
      .is('deleted_at', null)
      .single();

    if (error || !card) {
      return { statusCode: 401, body: 'Enlace inválido o expirado' };
    }

    if (card.edit_token_expires_at && new Date(card.edit_token_expires_at) < new Date()) {
      return { statusCode: 401, body: 'El enlace ha expirado. Solicita uno nuevo desde el editor.' };
    }

    const proto   = (event.headers && event.headers['x-forwarded-proto']) || 'https';
    const host    = (event.headers && event.headers.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;
    const cardUrl = `${siteUrl}/c/${card.slug}`;

    // Carril B2B: si la card pertenece a una organización, devolvemos la
    // tarjeta de visita 85×55mm branded (la que adjunta el welcome kit en
    // team-kit.js y la invitación en admin-orgs.js → invite_team). Si no,
    // cae al A6 vertical del autónomo. Sin esta rama, el botón "Descargar
    // tarjeta ↓" del welcome kit B2B devolvía la A6 del autónomo aunque
    // el adjunto del propio email sí fuera la 85×55mm.
    let pdfBuffer;
    try {
      if (card.organization_id) {
        const { data: org } = await db
          .from('organizations')
          .select('slug, name, logo_url, color_primary, tagline, address, phone')
          .eq('id', card.organization_id)
          .is('deleted_at', null)
          .maybeSingle();
        const logoBuffer = org && org.logo_url
          ? await fetchLogoAsPngBuffer(org.logo_url).catch(() => null)
          : null;
        pdfBuffer = await buildBusinessCardPDF({ card, org: org || null, logoBuffer, siteUrl });
      } else {
        pdfBuffer = await buildPrintableCardPDF({
          nombre:    card.nombre,
          tagline:   card.tagline,
          profesion: card.categories?.specialty_label || null,
          whatsapp:  card.whatsapp,
          direccion: card.direccion,
          zona:      card.zona,
          slug:      card.slug,
          cardUrl,
        });
      }
    } catch (err) {
      console.error('Error generando PDF tarjeta:', err.message);
      return { statusCode: 500, body: 'Error generando PDF' };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="perfilapro-${card.slug}.pdf"`,
        'Cache-Control':       'private, no-store',
      },
      body:            pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
