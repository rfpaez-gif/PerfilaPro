const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const slug = event.queryStringParameters?.slug;
  if (!slug) return { statusCode: 400, body: 'Missing slug' };

  const { data } = await supabase
    .from('cards')
    .select('slug, nombre, plan')
    .eq('slug', slug)
    .eq('status', 'active')
    .is('deleted_at', null)
    .single();

  return {
    statusCode: data ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ? { exists: true, nombre: data.nombre, plan: data.plan } : { exists: false }),
  };
};
