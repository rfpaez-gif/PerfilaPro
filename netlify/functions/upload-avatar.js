const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'JSON inválido' };
  }

  const { base64, contentType, slug } = body;

  if (!base64 || !contentType || !slug) {
    return { statusCode: 400, body: 'Faltan campos' };
  }
  if (!contentType.startsWith('image/')) {
    return { statusCode: 400, body: 'Solo se permiten imágenes' };
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    return { statusCode: 400, body: 'Imagen demasiado grande (máx 2 MB)' };
  }

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const fileName = `${slug}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(fileName, buffer, { contentType, upsert: false });

  if (error) {
    console.error('upload-avatar error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: publicUrl }),
  };
};
