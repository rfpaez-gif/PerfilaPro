const stripeLib = require('stripe');
const { normalizeSpanishPhone } = require('./lib/phone-utils');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isValidCp, normalizeCp } = require('./lib/cp-utils');

const defaultStripe = stripeLib(process.env.STRIPE_SECRET_KEY);

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
  cuidados:   'Cuidados y asistencia',
  fitness:    'Fitness y deporte',
  turismo:    'Turismo y viajes',
  comercio:   'Comercio y tiendas',
  otro:       'Otro',
};

function makeHandler(stripe) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'create-checkout', limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: 'JSON inválido' };
    }

    const { nombre, sector, cp, whatsapp, servicios, desc, direccion, local_publico, plan, foto, telefono, email, agent_code, ocupacion_code, slug: slugOverride, cancel_url: cancelUrl, idioma: rawIdioma } = body;

    if (!nombre || !cp || !whatsapp || !plan) {
      return { statusCode: 400, body: 'Faltan campos obligatorios' };
    }

    const idioma = rawIdioma === 'ca' ? 'ca' : 'es';

    const cpNormalized = normalizeCp(cp);
    if (!isValidCp(cpNormalized)) {
      return { statusCode: 400, body: 'Código postal inválido' };
    }

    const priceId = PRICES[plan];
    if (!priceId) {
      return { statusCode: 400, body: 'Plan no válido' };
    }

    const slug = slugOverride || nombre.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      .substring(0, 40);

    const tagline  = SECTOR_LABELS[sector] || sector || '';
    const phone = normalizeSpanishPhone(whatsapp);
    if (!phone.ok) {
      return { statusCode: 400, body: 'WhatsApp inválido (9 dígitos, móvil 6/7 o fijo 8/9)' };
    }
    const waNumber = phone.e164;
    const siteUrl  = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    try {
      const sessionParams = {
        mode: 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: {
          slug,
          nombre,
          tagline,
          whatsapp: waNumber,
          cp: cpNormalized,
          servicios: JSON.stringify(servicios),
          desc: (desc || '').substring(0, 200),
          direccion: (direccion || '').substring(0, 200),
          // Stripe metadata son siempre strings: el toggle viaja como '1' / ''
          // y stripe-webhook lo re-interpreta como boolean al persistir.
          local_publico: local_publico === true ? '1' : '',
          foto: foto || '',
          plan,
          agent_code: agent_code || '',
          // Código SEPE/SISPE (8 dígitos) si el alta usó el catálogo. La
          // resolución a name + sector_slug ocurre en stripe-webhook tras
          // pago confirmado para evitar lookups innecesarios aquí.
          ocupacion_code: (ocupacion_code && /^\d{8}$/.test(String(ocupacion_code))) ? String(ocupacion_code) : '',
          idioma,
        },
        success_url: `${siteUrl}/${idioma}/success?slug=${slug}`,
        cancel_url:  cancelUrl || `${siteUrl}/${idioma}/#crear`,
      };

      // Si tenemos el email del usuario (viene del alta o del card guardado),
      // se lo pasamos a Stripe como customer_email para que NO se lo vuelva a
      // pedir en el checkout. Stripe lo bloquea como readonly cuando llega así.
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sessionParams.customer_email = email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

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
}

exports.handler = makeHandler(defaultStripe);
exports.makeHandler = makeHandler;
