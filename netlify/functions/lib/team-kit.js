'use strict';

// Welcome kit B2B post-completación.
//
// Cuándo se dispara: la PRIMERA vez que un miembro del equipo guarda
// su perfil en /editar con WhatsApp rellenado (carril B2B locked en
// edit-card.js). En ese momento la tarjeta-de-visita PDF ya puede
// contener los datos reales del miembro (foto, WhatsApp), cosa que
// el email de invitación inicial no podía.
//
// Diferencias con el kit autónomo post-pago (stripe-webhook):
//   • Sin factura adjunta (paga la org, no el miembro).
//   • Sin QR PNG suelto (el QR ya va embebido en la tarjeta 85×55mm).
//   • Email branded con logo + color_primary de la org.
//   • Sin "plan / expires_at" — el miembro no tiene plan propio.
//
// Reuso vs duplicación: la pieza de banner branded está duplicada
// vs buildInviteEmail (admin-orgs.js) y buildLeadEmail (lead-b2b.js).
// Aceptamos la duplicación porque cada email tiene tono y compartimentos
// propios; consolidar en un componente shared se valora si aparece un
// cuarto email branded.

const { buildBusinessCardPDF, fetchLogoAsPngBuffer } = require('../printable-card-utils');
const { buildEmailLayout, COLORS } = require('./email-layout');

const TEAM_KIT_EMAIL_STRINGS = {
  es: {
    locale: 'es-ES',
    brandedLabel: 'Equipo de',
    intro: (orgName) => `Tu perfil profesional dentro de <strong>${orgName}</strong> ya está completo y en el aire. Cuando alguien te pida tu tarjeta, en vez de deletrear tu número, le mandas tu enlace y listo.`,
    yourLink: 'Tu enlace',
    seeProfile: 'Ver mi perfil →',
    kitTitle: '📦 Tu tarjeta de visita',
    kitIntro: 'Adjunta en este email como PDF — lista para mandar a imprenta o compartir. Con el branding de tu equipo, tus datos y el QR que apunta a tu perfil.',
    cardTitle: '🪪 Tarjeta de visita (85×55mm)',
    cardDesc: 'Formato ISO 7810 — entra en cualquier cartera o tarjetero.',
    cardCta: 'Descargar tarjeta ↓',
    teamTitle: 'Eres parte del equipo',
    teamLabel: 'Equipo',
    editProfile: 'Editar mi perfil',
    whereTitle: '💡 Dónde ponerlo',
    where1: '▸ Tu bio de Instagram, TikTok o LinkedIn',
    where2: '▸ Conversaciones y grupos de WhatsApp',
    where3: '▸ Firma de email o tu WhatsApp Business',
    replyFoot: '¿Algo no te cuadra o quieres cambiar algo? Responde este email directamente — somos personas reales y te contestamos.',
    closeFoot: (n) => `¡A por ello, ${n}! 🙌`,
    preheader: (orgName) => `Tu perfil dentro de ${orgName} ya está en el aire. Tarjeta de visita adjunta.`,
    title: (n) => `Tu perfil ya está vivo, ${n} 💪`,
    footerNote: '🔒 El enlace de edición es personal — no compartas este email con nadie.',
    subject: (n) => `${n}, tu perfil en el equipo ya está en el aire 🚀`,
  },
  ca: {
    locale: 'ca-ES',
    brandedLabel: 'Equip de',
    intro: (orgName) => `El teu perfil professional dins de <strong>${orgName}</strong> ja està complet i en línia. Quan algú et demani la targeta, en lloc de lletrejar el número, li envies el teu enllaç i llestos.`,
    yourLink: 'El teu enllaç',
    seeProfile: 'Veure el meu perfil →',
    kitTitle: '📦 La teva targeta de visita',
    kitIntro: 'Adjunta en aquest email com a PDF — a punt per portar a la impremta o compartir. Amb el branding del teu equip, les teves dades i el QR que apunta al teu perfil.',
    cardTitle: '🪪 Targeta de visita (85×55mm)',
    cardDesc: 'Format ISO 7810 — entra a qualsevol cartera o targeter.',
    cardCta: 'Descarregar targeta ↓',
    teamTitle: 'Ets part de l’equip',
    teamLabel: 'Equip',
    editProfile: 'Editar el meu perfil',
    whereTitle: '💡 On posar-lo',
    where1: '▸ La teva bio d’Instagram, TikTok o LinkedIn',
    where2: '▸ Converses i grups de WhatsApp',
    where3: '▸ Signatura d’email o el teu WhatsApp Business',
    replyFoot: 'Hi ha alguna cosa que no et quadra o vols canviar res? Respon aquest email directament — som persones reals i et contestem.',
    closeFoot: (n) => `Endavant, ${n}! 🙌`,
    preheader: (orgName) => `El teu perfil dins de ${orgName} ja és en línia. Targeta de visita adjunta.`,
    title: (n) => `El teu perfil ja és viu, ${n} 💪`,
    footerNote: '🔒 L’enllaç d’edició és personal — no comparteixis aquest email amb ningú.',
    subject: (n) => `${n}, el teu perfil a l’equip ja és al món 🚀`,
  },
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildTeamKitEmail({ card, org, siteUrl, editToken, idioma }) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const T = TEAM_KIT_EMAIL_STRINGS[lang];

  const cardUrl   = `${siteUrl}/c/${card.slug}`;
  const editUrl   = editToken ? `${siteUrl}/${lang}/editar?slug=${card.slug}&token=${editToken}` : null;
  const dlCardUrl = editToken ? `${siteUrl}/api/download-card?slug=${card.slug}&token=${editToken}` : null;
  const firstName = (card.nombre || '').split(' ')[0] || card.nombre || '';

  const orgName = org && org.name ? esc(org.name) : '';
  const headerColor = org && org.color_primary && /^#[0-9a-fA-F]{6}$/.test(org.color_primary)
    ? org.color_primary
    : null;
  const logoCell = org && org.logo_url
    ? `<img src="${esc(org.logo_url)}" alt="${orgName}" style="max-height:40px;max-width:140px;display:block;margin:0 auto 8px">`
    : '';
  const orgBanner = (headerColor && orgName) ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td style="background:${headerColor};border-radius:12px;padding:24px 20px;text-align:center">
                  ${logoCell}
                  <p style="margin:0;font-size:13px;font-weight:600;color:#ffffff;letter-spacing:.04em;text-transform:uppercase;opacity:.92">${esc(T.brandedLabel)}</p>
                  <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff">${orgName}</p>
                </td>
              </tr>
            </table>` : '';

  const bodyHtml = `${orgBanner}
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              ${T.intro(orgName || 'PerfilaPro')}
            </p>

            <!-- HERO · URL como objeto físico -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px">
              <tr>
                <td style="background:${COLORS.bg};border:1px solid ${COLORS.border};border-radius:12px;padding:18px 20px;text-align:center">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${esc(T.yourLink)}</p>
                  <a href="${esc(cardUrl)}" style="font-size:16px;font-weight:700;color:${COLORS.accent};text-decoration:none;word-break:break-all">${esc(cardUrl)}</a>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center">
                <a href="${esc(cardUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${esc(T.seeProfile)}</a>
              </td></tr>
            </table>

            <!-- KIT FÍSICO · solo tarjeta (sin QR PNG suelto) -->
            ${dlCardUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:24px 22px">
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">${esc(T.kitTitle)}</p>
                  <p style="margin:0 0 18px;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">${esc(T.kitIntro)}</p>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:12px 14px;background:${COLORS.bg};border-radius:8px;border-left:3px solid ${COLORS.accent}">
                        <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:${COLORS.ink}">${esc(T.cardTitle)}</p>
                        <p style="margin:0 0 10px;font-size:12px;color:${COLORS.inkSoft};line-height:1.5">${esc(T.cardDesc)}</p>
                        <a href="${esc(dlCardUrl)}" style="display:inline-block;font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;padding:6px 14px;border:1.5px solid ${COLORS.accent};border-radius:100px">${esc(T.cardCta)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>` : ''}

            <!-- ERES PARTE DEL EQUIPO (sin plan/expires) -->
            ${orgName ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td style="background:${COLORS.accentSoft};border-radius:10px 10px 0 0;padding:14px 20px;border-left:3px solid ${COLORS.accent}">
                  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.accent}">${esc(T.teamTitle)}</p>
                </td>
              </tr>
              <tr>
                <td style="background:${COLORS.bg};border-radius:0 0 10px 10px;padding:16px 20px">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.inkSoft};width:90px">${esc(T.teamLabel)}</td>
                      <td style="padding:6px 0;font-size:13px;color:${COLORS.ink};font-weight:600">${orgName}</td>
                    </tr>
                  </table>
                  ${editUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
                    <tr><td>
                      <a href="${esc(editUrl)}" style="display:inline-block;background:${COLORS.surface};color:${COLORS.accent};font-size:13px;font-weight:700;text-decoration:none;padding:8px 18px;border-radius:100px;border:1.5px solid ${COLORS.accent}">${esc(T.editProfile)}</a>
                    </td></tr>
                  </table>` : ''}
                </td>
              </tr>
            </table>` : ''}

            <!-- DÓNDE PONERLO -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
              <tr>
                <td>
                  <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${COLORS.inkSoft}">${esc(T.whereTitle)}</p>
                  <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">${esc(T.where1)}</p>
                  <p style="margin:0 0 8px;font-size:14px;color:${COLORS.ink};line-height:1.6">${esc(T.where2)}</p>
                  <p style="margin:0;font-size:14px;color:${COLORS.ink};line-height:1.6">${esc(T.where3)}</p>
                </td>
              </tr>
            </table>

            <!-- PIE -->
            <p style="margin:0 0 8px;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ${esc(T.replyFoot)}
            </p>
            <p style="margin:0;font-size:14px;color:${COLORS.inkSoft};line-height:1.6">
              ${esc(T.closeFoot(firstName))}
            </p>`;

  const html = buildEmailLayout({
    preheader: T.preheader(orgName || 'PerfilaPro'),
    title: T.title(firstName),
    bodyHtml,
    cta: null,
    footerNote: editUrl ? T.footerNote : '',
    siteUrl,
    idioma: lang,
  });

  return {
    subject: T.subject(firstName),
    html,
  };
}

/**
 * Dispara el welcome kit B2B: genera tarjeta-de-visita PDF + envía
 * email branded + marca cards.kit_email_sent_at en éxito.
 *
 * Es awaited (no fire-and-forget) porque Netlify Functions teardown
 * el container al return; un Promise pendiente se cancelaría.
 *
 * `buildPdf` y `fetchLogo` se inyectan opcionalmente — patrón DI del
 * codebase para mantener tests rápidos sin tocar PDFKit + sin tocar
 * red. Si no se pasan, usa las implementaciones reales.
 *
 * @returns {Promise<boolean>} true si email enviado y kit_email_sent_at
 *   marcado; false si algo falló (caller no relanza — el admin puede
 *   reenviar desde el panel).
 */
async function sendTeamKit({
  db, emailClient, card, org, siteUrl, editToken,
  buildPdf = buildBusinessCardPDF,
  fetchLogo = fetchLogoAsPngBuffer,
}) {
  if (!emailClient) {
    console.warn('team-kit: emailClient no configurado, skip');
    return false;
  }
  if (!card || !card.email || !card.slug) {
    console.warn('team-kit: card incompleta, skip');
    return false;
  }

  // Tarjeta-de-visita PDF (con branding via org). El logo se fetcha
  // a Buffer una sola vez. Si el fetch falla → el PDF se genera sin
  // logo (no fatal). Si el PDF entero falla → el email se manda sin
  // adjunto (no fatal).
  let cardPdfBuffer = null;
  try {
    const logoBuffer = org && org.logo_url
      ? await fetchLogo(org.logo_url).catch(() => null)
      : null;
    cardPdfBuffer = await buildPdf({ card, org, logoBuffer, siteUrl });
  } catch (err) {
    console.error('team-kit: error generando tarjeta PDF (no fatal):', err.message);
  }

  const { subject, html } = buildTeamKitEmail({
    card, org, siteUrl, editToken, idioma: card.idioma,
  });

  const payload = {
    from: 'PerfilaPro <hola@perfilapro.es>',
    to: card.email,
    subject,
    html,
  };

  if (cardPdfBuffer) {
    payload.attachments = [{
      filename: `tarjeta-${card.slug}.pdf`,
      content: cardPdfBuffer.toString('base64'),
    }];
  }

  try {
    await emailClient.emails.send(payload);
  } catch (err) {
    console.error('team-kit: error enviando email:', err.message);
    return false;
  }

  // Marca kit_email_sent_at solo DESPUÉS del email exitoso, así que un
  // fallo de Resend no impide reintentar. Si el UPDATE falla, logueamos
  // pero devolvemos true (el email salió; el flag es housekeeping).
  try {
    const { error: tsErr } = await db
      .from('cards')
      .update({ kit_email_sent_at: new Date().toISOString() })
      .eq('slug', card.slug);
    if (tsErr) console.warn('team-kit: kit_email_sent_at no marcado (no fatal):', tsErr.message);
  } catch (err) {
    console.warn('team-kit: kit_email_sent_at no marcado (no fatal):', err.message);
  }

  console.log(`Team kit enviado: ${card.slug} → ${card.email}`);
  return true;
}

module.exports = {
  TEAM_KIT_EMAIL_STRINGS,
  buildTeamKitEmail,
  sendTeamKit,
};
