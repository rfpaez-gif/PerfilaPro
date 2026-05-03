const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function makeHandler(db) {
  return async (event) => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

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
      .select('*')
      .eq('slug', slug)
      .eq('edit_token', token)
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
        body: JSON.stringify({ error: 'El enlace ha expirado. Solicita uno nuevo.' }),
      };
    }

    const cardExport = { ...card };
    delete cardExport.edit_token;
    delete cardExport.edit_token_expires_at;

    const { data: visits } = await db
      .from('visits')
      .select('visited_at')
      .eq('slug', slug);

    const { data: facturas } = await db
      .from('facturas')
      .select('numero, created_at')
      .eq('slug', slug);

    const payload = {
      exported_at: new Date().toISOString(),
      card:        cardExport,
      visits:      visits || [],
      facturas:    facturas || [],
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="perfilapro-export-${slug}.json"`,
      },
      body: JSON.stringify(payload, null, 2),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
