'use strict';

/**
 * Layout compartido para emails transaccionales.
 *
 * Los clientes de email no soportan CSS variables ni hojas de
 * estilo externas, así que los hex codes están hardcodeados.
 * Mantener este mapa SINCRONIZADO con public/styles/tokens.css
 * cada vez que cambie la paleta del producto.
 */

const COLORS = {
  primary:      '#01696f',  // --pp-c-primary
  primarySoft:  '#d9e8e7',  // --pp-c-primary-soft
  bg:           '#f5f2ec',  // --pp-c-bg
  bgCard:       '#ffffff',  // --pp-c-bg-card
  bgSoft:       '#faf7f1',  // --pp-c-bg-soft
  ink:          '#1e1b14',  // --pp-c-ink
  inkMuted:     '#6b6458',  // --pp-c-gray-700
  inkSubtle:    '#a89f90',  // --pp-c-ink-40 aprox
  line:         '#e5ddd0',  // --pp-c-line
};

const SITE_URL_FALLBACK = 'https://perfilapro.es';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCta(cta) {
  if (!cta || !cta.text || !cta.url) return '';
  return `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center">
                <a href="${esc(cta.url)}" style="display:inline-block;background:${COLORS.primary};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${esc(cta.text)}</a>
              </td></tr>
            </table>`;
}

function renderFooterNote(footerNote) {
  if (!footerNote) return '';
  return `
            <p style="margin:0;font-size:12px;color:${COLORS.inkSubtle};line-height:1.6">${footerNote}</p>`;
}

/**
 * Construye un email transaccional con estructura coherente.
 *
 * @param {Object} opts
 * @param {string} opts.preheader   Texto de preview (oculto visualmente,
 *                                  pero leído por Gmail/Apple Mail).
 * @param {string} opts.title       Título destacado del cuerpo.
 * @param {string} opts.bodyHtml    HTML del cuerpo principal (ya formateado).
 * @param {Object} [opts.cta]       CTA opcional. { text, url }.
 * @param {string} [opts.footerNote] Nota opcional bajo el CTA (HTML aceptado).
 * @param {string} [opts.siteUrl]   Override del SITE_URL para enlaces legales.
 * @returns {string} HTML completo del email.
 */
function buildEmailLayout(opts) {
  const {
    preheader = '',
    title     = '',
    bodyHtml  = '',
    cta       = null,
    footerNote = '',
    siteUrl   = process.env.SITE_URL || SITE_URL_FALLBACK,
  } = opts || {};

  const safePreheader = esc(preheader);
  const safeTitle     = esc(title);
  const safeSiteUrl   = esc(siteUrl);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PerfilaPro</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:'Helvetica Neue',Arial,sans-serif;color:${COLORS.ink}">
  <!-- Preheader (oculto visualmente, visible en preview de bandeja) -->
  <div style="display:none;font-size:1px;color:${COLORS.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${safePreheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:${COLORS.bgCard};border-radius:12px;border:1px solid rgba(30,27,20,.10);overflow:hidden">

        <!-- Header -->
        <tr>
          <td style="background:${COLORS.primary};padding:32px 40px;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">PerfilaPro</p>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,.75)">Tu perfil profesional siempre a mano</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px">
            ${title ? `<p style="margin:0 0 20px;font-size:24px;font-weight:700;color:${COLORS.ink}">${safeTitle}</p>` : ''}
            ${bodyHtml}
${renderCta(cta)}
${renderFooterNote(footerNote)}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid rgba(30,27,20,.08);text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:${COLORS.inkSubtle}">PerfilaPro · Tu perfil profesional siempre a mano</p>
            <p style="margin:0;font-size:11px;color:#c4bdb2">
              <a href="${safeSiteUrl}/terminos.html" style="color:${COLORS.inkSubtle};text-decoration:none">Términos</a> ·
              <a href="${safeSiteUrl}/privacidad.html" style="color:${COLORS.inkSubtle};text-decoration:none">Privacidad</a> ·
              <a href="${safeSiteUrl}/legal.html" style="color:${COLORS.inkSubtle};text-decoration:none">Aviso legal</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildEmailLayout, COLORS };
