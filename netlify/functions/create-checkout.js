const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  base: process.env.STRIPE_PRICE_BASE,
  pro:  process.env.STRIPE_PRICE_PRO,
};

const SECTOR_LABELS = {
  oficios:    'Oficios y servicios del hogar',
  salud:      'Salud y bienestar',
  educacion:  'Educación y formación',
  comercial:  'Comercial y ventas',
  belleza:    'Belleza y estética',
  reforma:    'Reforma y construcción',
  hosteleria: 'Hostelería y restauración',
  tech:       'Tecnología y digital',
  legal:      'Legal y asesoría',
  jardineria: 'Jardinería y paisajismo',
  transporte: 'Transporte y mudanzas',
  fotografia: 'Fotografía y vídeo',
  eventos:    'Eventos y celebraciones',
  automocion: 'Automoción y mecánica',
  seguridad:  'Seguridad y vigilancia',
  otro:       'Otro',
};

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

  const { nombre, sector, zona, whatsapp, servicios, desc, direccion, plan, foto, telefono, agent_code } = body;

  if (!nombre || !zona || !whatsapp || !servicios?.length || !plan) {
    return { statusCode: 400, body: 'Faltan campos obligatorios' };
  }

  const priceId = PRICES[plan];
  if (!priceId) {
    return { statusCode: 400, body: 'Plan no válido' };
  }

  const slug = nombre.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);

  const tagline  = SECTOR_LABELS[sector] || sector || '';
  const waNumber = '34' + whatsapp.replace(/\D/g, '');
  const siteUrl  = process.env.SITE_URL || 'https://perfilapro.netlify.app';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      phone_number_collection: { enabled: true },
      metadata: {
        slug,
        nombre,
        tagline,
        whatsapp: waNumber,
        zona,
        servicios: JSON.stringify(servicios),
        desc: (desc || '').substring(0, 200),
        direccion: (direccion || '').substring(0, 200),
        foto: foto || '',
        plan,
        agent_code: agent_code || '',
      },
      success_url: `${siteUrl}/success.html?slug=${slug}`,
      cancel_url:  `${siteUrl}/#crear`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
