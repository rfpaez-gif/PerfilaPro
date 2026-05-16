// Activación gratuita de una card como demo: marca plan=pro + expires_at +
// kit_email_sent_at, genera la tarjeta A6 y manda email con el PDF adjunto.
// Sin factura, sin QR PNG suelto — los demos no son una transacción, son
// material de marketing.
//
// Lo usan dos sitios:
//   - activate-demo.js → cards seed con slug 'demo-*' (segundo click desde la
//     pantalla de éxito de alta.html).
//   - register-free.js → cuando el usuario entra a /alta con ?via=demo-*
//     procedente de una card demo y DEMO_FUNNEL_FREE_ACTIVE=1 está activo.
//     Ahí la activación es inmediata en la misma respuesta de register-free,
//     sin pantalla intermedia.
//
// El email recortado vive aquí para que ambos carriles manden el mismo
// mensaje. Si en el futuro queremos diferenciar (ej. "demo seed" vs "demo
// funnel"), basta con pasar variantes vía opts.

const { buildPrintableCardPDF } = require('../printable-card-utils');
const { buildEmailLayout, COLORS } = require('./email-layout');
const { capture: phCapture } = require('./posthog-server');

const DEMO_DAYS = 365;

const DEMO_EMAIL_STRINGS = {
  es: {
    subject: (n) => `Tu tarjeta demo está lista, ${n}`,
    preheader: () => 'Adjuntamos tu tarjeta de mano A6, lista para imprimir o compartir.',
    title: (n) => `Hola ${n} 👋`,
    intro1: 'Tu tarjeta demo está activada. Adjunto te mandamos la <strong>tarjeta de mano A6</strong> en PDF — lista para imprimir, repartir o pegar donde quieras.',
    intro2: 'Es un PDF vectorial: imprime tal cual a tamaño A6, o ampliada a A5 / A4 sin perder nitidez.',
    seeProfile: 'Ver mi tarjeta →',
    editProfile: 'Editar mi perfil',
    yourLink: 'Tu URL pública',
    closing: 'Si necesitas algo, responde a este email.',
    footerNote: 'Demo · Sin valor fiscal · PerfilaPro',
  },
  ca: {
    subject: (n) => `La teva targeta demo està llesta, ${n}`,
    preheader: () => 'Adjuntem la teva targeta de mà A6, llesta per imprimir o compartir.',
    title: (n) => `Hola ${n} 👋`,
    intro1: 'La teva targeta demo està activada. Adjunt et fem arribar la <strong>targeta de mà A6</strong> en PDF — llesta per imprimir, repartir o enganxar on vulguis.',
    intro2: 'És un PDF vectorial: imprimeix tal qual a mida A6, o ampliada a A5 / A4 sense perdre nitidesa.',
    seeProfile: 'Veure la meva targeta →',
    editProfile: 'Editar el meu perfil',
    yourLink: 'La teva URL pública',
    closing: 'Si necessites res, respon a aquest email.',
    footerNote: 'Demo · Sense valor fiscal · PerfilaPro',
  },
};

function buildDemoActivationEmail({ nombre, slug, siteUrl, editToken, idioma = 'es' }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = DEMO_EMAIL_STRINGS[lang];
  const cardUrl = `${siteUrl}/c/${slug}`;
  const editUrl = `${siteUrl}/${lang}/editar?slug=${slug}&token=${editToken}`;
  const firstName = (nombre || '').split(' ')[0];

  const bodyHtml = `
            <p style="margin:0 0 12px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro1}
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro2}
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr><td align="center" style="padding-bottom:12px">
                <a href="${cardUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${T.seeProfile}</a>
              </td></tr>
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:14px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:100px;border:2px solid ${COLORS.accent}">${T.editProfile}</a>
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr>
                <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:10px;padding:14px 20px">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${T.yourLink}</p>
                  <a href="${cardUrl}" style="font-size:14px;font-weight:700;color:${COLORS.accent};text-decoration:none;word-break:break-all">${cardUrl}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ${T.closing}
            </p>`;

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

async function sendDemoActivationEmail({ email, nombre, slug, editToken, cardPdfBuffer, emailClient, idioma, siteUrl }) {
  if (!email || !emailClient) return false;
  const { subject, html } = buildDemoActivationEmail({ nombre, slug, siteUrl, editToken, idioma });

  const payload = {
    from: 'PerfilaPro <hola@perfilapro.es>',
    to: email,
    subject: `[Demo] ${subject}`,
    html,
  };
  if (cardPdfBuffer) {
    payload.attachments = [{
      filename: `perfilapro-${slug}.pdf`,
      content: cardPdfBuffer.toString('base64'),
    }];
  }

  try {
    await emailClient.emails.send(payload);
    console.log(`Email demo enviado a: ${email}`);
    return true;
  } catch (err) {
    console.error('Error enviando email demo:', err.message);
    return false;
  }
}

// Activa la card como Pro durante DEMO_DAYS, marca kit_email_sent_at,
// genera la tarjeta A6 (best-effort, no falla la activación) y envía el
// email con el PDF adjunto (best-effort). Devuelve { ok, expires_at,
// email_sent } o { ok: false, error } si el UPDATE en BD falla.
//
// El llamador es responsable de la auth (token + slug) y de los gates
// (slug prefix, env var). Esta función no valida nada — confía en que
// quien llama ya autorizó la operación.
async function activateAndSendDemoKit({ db, emailClient, card, profesion = null, siteUrl }) {
  const expiresAt = new Date(Date.now() + DEMO_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const activatedAt = new Date().toISOString();

  const { error: upErr } = await db
    .from('cards')
    .update({
      plan: 'pro',
      status: 'active',
      expires_at: expiresAt,
      kit_email_sent_at: activatedAt,
    })
    .eq('slug', card.slug);

  if (upErr) {
    return { ok: false, error: upErr };
  }

  const cardUrl = `${siteUrl}/c/${card.slug}`;
  let cardPdfBuffer = null;
  try {
    cardPdfBuffer = await buildPrintableCardPDF({
      nombre:    card.nombre,
      tagline:   card.tagline,
      profesion: profesion || card.categories?.specialty_label || null,
      whatsapp:  card.whatsapp,
      direccion: card.direccion,
      zona:      card.zona,
      slug:      card.slug,
      cardUrl,
    });
  } catch (err) {
    console.error('Error generando tarjeta PDF demo (no fatal):', err.message);
  }

  let emailSent = false;
  if (card.email && emailClient) {
    emailSent = await sendDemoActivationEmail({
      email:       card.email,
      nombre:      card.nombre,
      slug:        card.slug,
      editToken:   card.edit_token,
      cardPdfBuffer,
      emailClient,
      idioma:      card.idioma,
      siteUrl,
    });
  }

  phCapture(card.slug, 'demo_activated', {
    slug:       card.slug,
    idioma:     card.idioma || 'es',
    email_sent: emailSent,
  }).catch(() => {});

  return { ok: true, expires_at: expiresAt, email_sent: emailSent };
}

module.exports = {
  DEMO_DAYS,
  buildDemoActivationEmail,
  sendDemoActivationEmail,
  activateAndSendDemoKit,
};
