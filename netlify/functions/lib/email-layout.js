'use strict';

/**
 * Layout compartido para emails transaccionales.
 *
 * Los clientes de email no soportan CSS variables ni hojas de
 * estilo externas, así que los hex codes están hardcodeados.
 * Mantener este mapa SINCRONIZADO con public/styles/tokens.css
 * cada vez que cambie la paleta del producto.
 *
 * Los emails usan SIEMPRE el registro cálido (Piedra Cálida +
 * verde petróleo). Outlook clásico no renderiza rgba() de forma
 * fiable, por eso inkSoft/border son hex sólidos pre-calculados
 * sobre fondo #FAF3E6 y NO deben sustituirse por rgba().
 */

const COLORS = {
  bg:         '#FAF3E6',  // Piedra Cálida   · --pp-color-warm-bg
  surface:    '#FFFFFF',  // tarjetas        · --pp-color-warm-surface
  ink:        '#1E1B14',  // texto principal · --pp-color-warm-ink
  inkSoft:    '#5C5246',  // texto secundario (≈ rgba ink 0.7 sobre warm-bg)
  accent:     '#01696F',  // verde petróleo  · --pp-color-warm-accent
  accentDeep: '#014E52',  // hover/visited   · --pp-color-warm-accent-deep
  accentSoft: '#E8EFEF',  // bloques destacados (≈ accent 0.08 sobre warm-bg)
  border:     '#D9D2C4',  // separadores (≈ warm-border sólido)

  // Estados (mismos hex que tokens.css)
  success:    '#00A866',
  warning:    '#B8860B',
  danger:     '#B23A48',
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
                <a href="${esc(cta.url)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">${esc(cta.text)}</a>
              </td></tr>
            </table>`;
}

function renderFooterNote(footerNote) {
  if (!footerNote) return '';
  return `
            <p style="margin:0;font-size:12px;color:${COLORS.inkSoft};line-height:1.6">${footerNote}</p>`;
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
      <table role="presentation" width="100%" style="max-width:560px;background:${COLORS.surface};border-radius:12px;border:1px solid ${COLORS.border};overflow:hidden">

        <!-- Header -->
        <tr>
          <td style="background:${COLORS.accent};padding:32px 40px;text-align:center">
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
          <td style="padding:20px 40px;border-top:1px solid ${COLORS.border};text-align:center">
            <p style="margin:0 0 6px;font-size:12px;color:${COLORS.inkSoft}">PerfilaPro · Tu perfil profesional siempre a mano</p>
            <p style="margin:0;font-size:11px;color:#c4bdb2">
              <a href="${safeSiteUrl}/terminos.html" style="color:${COLORS.inkSoft};text-decoration:none">Términos</a> ·
              <a href="${safeSiteUrl}/privacidad.html" style="color:${COLORS.inkSoft};text-decoration:none">Privacidad</a> ·
              <a href="${safeSiteUrl}/legal.html" style="color:${COLORS.inkSoft};text-decoration:none">Aviso legal</a>
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
