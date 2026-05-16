const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { normalizeSpanishPhone } = require('./lib/phone-utils');
const { capture: captureEvent } = require('./lib/posthog-server');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');
const { isValidCp, lookupCp, normalizeCp } = require('./lib/cp-utils');
const { pickSectorLabel } = require('./lib/sector-labels');
const { activateAndSendDemoKit } = require('./lib/demo-activation');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function toSlug(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
}

const WELCOME_EMAIL_STRINGS = {
  es: {
    intro1: 'Tu perfil profesional está creado. Puedes editarlo y completarlo cuando quieras desde el enlace de abajo.',
    intro2: 'Cuando estés listo para activarlo y que aparezca en el directorio, activa tu plan por solo 9€.',
    seeProfile: 'Ver mi perfil →',
    completeProfile: 'Completar mi perfil',
    planActive: 'Plan activo · Gratuito',
    planNote: 'Sin límite de tiempo · Activa el directorio cuando quieras',
    yourLink: 'Tu enlace',
    preheader: (n) => `${n}, tu perfil PerfilaPro ya está creado.`,
    title: (n) => `¡Tu perfil ya existe, ${n}! 🚀`,
    footerNote: '🔒 El botón "Completar mi perfil" es personal — no compartas este email con nadie.',
    subject: (n) => `${n}, tu perfil está listo 🎉`,
  },
  ca: {
    intro1: 'El teu perfil professional ja està creat. El pots editar i completar quan vulguis des de l’enllaç de baix.',
    intro2: 'Quan estiguis a punt per activar-lo i que aparegui al directori, activa el teu pla per només 9€.',
    seeProfile: 'Veure el meu perfil →',
    completeProfile: 'Completar el meu perfil',
    planActive: 'Pla actiu · Gratuït',
    planNote: 'Sense límit de temps · Activa el directori quan vulguis',
    yourLink: 'El teu enllaç',
    preheader: (n) => `${n}, el teu perfil PerfilaPro ja està creat.`,
    title: (n) => `El teu perfil ja existeix, ${n}! 🚀`,
    footerNote: '🔒 El botó "Completar el meu perfil" és personal — no comparteixis aquest email amb ningú.',
    subject: (n) => `${n}, el teu perfil està a punt 🎉`,
  },
};

function buildWelcomeEmail({ nombre, slug, siteUrl, editToken, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = WELCOME_EMAIL_STRINGS[lang];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = `${siteUrl}/${lang}/editar?slug=${slug}&token=${editToken}`;
  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro1}
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro2}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.seeProfile}</a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">${T.completeProfile}</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
              <tr>
                <td style="background:${COLORS.accentSoft};border-radius:10px 10px 0 0;padding:12px 20px;border-left:3px solid ${COLORS.accent}">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">${T.planActive}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:${COLORS.ink};font-weight:600">${T.planNote}</p>
                </td>
              </tr>
              <tr>
                <td style="background:${COLORS.bg};border-radius:0 0 10px 10px;padding:12px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${T.yourLink}</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:${COLORS.accent};text-decoration:none">${cardUrl}</a>
                </td>
              </tr>
            </table>`;

  const html = buildEmailLayout({
    preheader: T.preheader(firstName),
    title: T.title(firstName),
    bodyHtml,
    footerNote: T.footerNote,
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName),
    html,
  };
}

function makeHandler(db, emailClient = resend) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'register-free', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const { nombre, whatsapp, sector, cp, email, desc, direccion, local_publico, servicios: rawServicios, category_sector, category_specialty, specialty_custom, ocupacion_code, idioma: rawIdioma, via } = body;
    const idioma = rawIdioma === 'ca' ? 'ca' : 'es';

    if (!nombre || !whatsapp || !cp || !email) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan campos obligatorios: nombre, whatsapp, cp, email' }) };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Email inválido' }) };
    }

    const cpNormalized = normalizeCp(cp);
    if (!isValidCp(cpNormalized)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Código postal inválido. Introduce 5 dígitos de un CP español (01000-52999).' }) };
    }

    const cleanNombre = stripTags(nombre).substring(0, 100);
    let slug = toSlug(cleanNombre);
    if (!slug) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Nombre inválido' }) };
    }

    const phone = normalizeSpanishPhone(whatsapp);
    if (!phone.ok) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'WhatsApp inválido. Introduce un móvil español de 9 dígitos.' }) };
    }
    const waNumber = phone.e164;

    // Ensure slug uniqueness — incluye soft-deleted (la PK sigue ocupada
    // hasta que el job de purga limpie la fila a los 30 días).
    const { data: existing } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (existing) {
      slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}`;
    }

    const editToken = crypto.randomBytes(32).toString('hex');
    const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sectorLabel = pickSectorLabel(sector, idioma);
    const cleanDesc   = desc ? stripTags(desc).substring(0, 300) : '';
    const tagline     = cleanDesc || sectorLabel;
    const serviciosParsed = Array.isArray(rawServicios)
      ? rawServicios.map(s => stripTags(s).substring(0, 100)).filter(Boolean)
      : [];

    // Resolve category_id from archetype slugs so the printable PDF, directory
    // search and admin filters work from day one (sin pasar por /editar).
    let category_id = null;
    if (category_sector && category_specialty) {
      const { data: cat } = await db
        .from('categories')
        .select('id')
        .eq('sector', category_sector)
        .eq('specialty', category_specialty)
        .maybeSingle();
      category_id = cat?.id || null;
    }

    // ocupacion_code (catálogo SEPE/SISPE 2011, migración 014). Se valida
    // contra la tabla ocupaciones; si no existe o el formato no encaja,
    // queda null sin bloquear el alta. El nombre canónico SEPE se persiste
    // en specialty_custom para que la tarjeta y la página pública muestren
    // el oficio real escogido por el usuario.
    let ocupacionCodeClean = null;
    let ocupacionName = null;
    if (ocupacion_code && /^\d{8}$/.test(String(ocupacion_code))) {
      // Selecciona name_ca solo si el alta es catalana, para que la tarjeta
      // pública muestre el oficio en el idioma del autónomo. Si la fila no
      // tiene name_ca (long-tail aún sin traducir), cae al name castellano.
      const cols = idioma === 'ca' ? 'code, name, name_ca' : 'code, name';
      const { data: ocup } = await db
        .from('ocupaciones')
        .select(cols)
        .eq('code', String(ocupacion_code))
        .maybeSingle();
      if (ocup) {
        ocupacionCodeClean = ocup.code;
        ocupacionName = (idioma === 'ca' && ocup.name_ca) ? ocup.name_ca : ocup.name;
      }
    }

    // specialty_custom: orden de prioridad
    //   1) ocupación SEPE elegida (lenguaje natural, ej. "Albañiles")
    //   2) free text del flujo "otro-oficio" (legacy del picker actual)
    //   3) null (cae al specialty_label de la categoría)
    const specialtyCustomClean = ocupacionName
      ? ocupacionName.substring(0, 60)
      : (category_specialty === 'otro-oficio' && specialty_custom)
        ? stripTags(specialty_custom).substring(0, 60)
        : null;

    // CP → municipio + city_slug. zona pasa a guardarse como nombre humano del
    // municipio resuelto (ej. "Coslada"), city_slug como slug de la capital de
    // provincia (ej. "madrid") para que SEO de directorio agrupe correctamente.
    const cpRow = await lookupCp(db, cpNormalized);
    const zonaResolved = cpRow?.municipality_name || '';
    const citySlugResolved = cpRow?.province_slug || null;

    // direccion se persiste siempre que llegue (texto libre, una línea); el
    // toggle local_publico decide si /c/:slug la renderiza públicamente.
    // Por defecto local_publico=false para no exponer la casa de un autónomo
    // a domicilio que rellenó su dirección sin pensarlo.
    const direccionClean = direccion ? stripTags(direccion).substring(0, 200) : null;
    const localPublicoBool = local_publico === true && !!direccionClean;

    const row = {
      slug,
      nombre:           cleanNombre,
      tagline,
      whatsapp:         waNumber,
      cp:               cpNormalized,
      zona:             zonaResolved.substring(0, 100),
      city_slug:        citySlugResolved,
      servicios:        serviciosParsed,
      email,
      plan:             'base',
      status:           'active',
      category_id,
      specialty_custom: specialtyCustomClean,
      ocupacion_code:   ocupacionCodeClean,
      direccion:        direccionClean,
      local_publico:    localPublicoBool,
      edit_token:       editToken,
      edit_token_expires_at: editTokenExpiresAt,
      idioma,
    };

    const { error } = await db.from('cards').insert(row);

    if (error) {
      console.error('Supabase insert error:', error.message, error.code);
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al crear el perfil: ' + error.message }) };
    }

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';

    // Demo funnel: usuario que entra a /alta procedente de una card demo
    // (link con ?via=demo-wa | demo-pill | demo-*) y el admin tiene el
    // grifo abierto vía DEMO_FUNNEL_FREE_ACTIVE=1. La card se activa
    // como Pro inmediatamente (mismo trato que activate-demo da a las
    // seed cards), sin pasar por Stripe y sin segundo click. El welcome
    // email de free se sustituye por el email demo con la tarjeta A6
    // adjunta — no duplicamos correos.
    //
    // Apagado: borrar la env var. El backend cae al welcome free normal
    // y el editor vuelve a mostrar el banner de upgrade Stripe.
    const isDemoFunnel =
      typeof via === 'string' &&
      via.startsWith('demo-') &&
      process.env.DEMO_FUNNEL_FREE_ACTIVE === '1';

    if (isDemoFunnel) {
      const cardForActivation = {
        slug,
        nombre:     cleanNombre,
        tagline,
        whatsapp:   waNumber,
        direccion:  direccionClean,
        zona:       zonaResolved,
        email,
        edit_token: editToken,
        idioma,
      };
      const result = await activateAndSendDemoKit({
        db,
        emailClient,
        card:      cardForActivation,
        profesion: specialtyCustomClean,
        siteUrl,
      });

      if (result.ok) {
        captureEvent(slug, 'signup_completed_demo_funnel', { sector: sector || null, via, idioma })
          .catch(() => {});

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            card_url:       `${siteUrl}/c/${slug}`,
            edit_url:       `${siteUrl}/${idioma}/editar?slug=${slug}&token=${editToken}`,
            demo_activated: true,
            plan:           'pro',
            expires_at:     result.expires_at,
            email_sent:     result.email_sent,
          }),
        };
      }

      // Activación falló (BD). La card free ya existe — caemos al carril
      // free normal para que el usuario al menos tenga su perfil aunque el
      // upgrade no se haya aplicado. Mejor degradar que perder al usuario.
      console.error('Demo funnel activation failed, falling back to free:', result.error?.message);
    }

    if (email && emailClient) {
      const { subject, html } = buildWelcomeEmail({ nombre: cleanNombre, slug, siteUrl, editToken, idioma });
      emailClient.emails.send({
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: email,
        subject,
        html,
      }).catch(err => console.error('Email error:', err.message));
    }

    captureEvent(slug, 'signup_completed_free', { sector: sector || null, plan: 'free', idioma })
      .catch(() => {});

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        card_url:  `${siteUrl}/c/${slug}`,
        edit_url:  `${siteUrl}/${idioma}/editar?slug=${slug}&token=${editToken}`,
      }),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.buildWelcomeEmail = buildWelcomeEmail;
