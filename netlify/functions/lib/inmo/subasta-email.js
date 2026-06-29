'use strict';

// Email de aviso de subastas (uso privado): resumen de las fincas
// costeras nuevas detectadas y de las que cierran pronto. Reutiliza la
// maqueta de PerfilaPro (buildEmailLayout) para no reinventar el HTML
// email-defensivo.

const { buildEmailLayout, COLORS } = require('../email-layout');
const { centsToEuros } = require('./subasta-model');

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TIPO_BIEN_LABEL = {
  vivienda: 'Vivienda', garaje: 'Garaje', local: 'Local', nave: 'Nave',
  suelo: 'Suelo', finca_rustica: 'Finca rústica', trastero: 'Trastero', otro: 'Inmueble',
};

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Una fila-tarjeta de subasta dentro del email.
function row(s, siteUrl) {
  const tipo = TIPO_BIEN_LABEL[s.tipo_bien] || 'Inmueble';
  const valor = centsToEuros(s.valor_subasta_cents) || 'sin valor publicado';
  const url = `${siteUrl}/s/${esc(s.slug)}`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;border:1px solid ${COLORS.border};border-radius:10px">
      <tr><td style="padding:16px">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:${COLORS.ink}">${esc(tipo)} en ${esc(s.municipio || s.localidad_raw || 'Tarragona')}</p>
        <p style="margin:0 0 6px;font-size:13px;color:${COLORS.inkSoft}">${esc(s.direccion || s.localidad_raw || '')}</p>
        <p style="margin:0 0 10px;font-size:14px;color:${COLORS.ink}"><strong>Valor de subasta:</strong> ${esc(valor)} &nbsp;·&nbsp; <strong>Cierra:</strong> ${esc(fmtFecha(s.fecha_fin))}</p>
        <a href="${url}" style="display:inline-block;background:${COLORS.accent};color:#fff;font-size:13px;font-weight:700;text-decoration:none;padding:9px 18px;border-radius:100px">Ver ficha →</a>
      </td></tr>
    </table>`;
}

// { subject, html } o null si no hay nada que avisar.
function buildAlertEmail({ nuevas = [], cerrandoPronto = [], siteUrl = process.env.SITE_URL || 'https://perfilapro.es' } = {}) {
  if (!nuevas.length && !cerrandoPronto.length) return null;

  let bodyHtml = `<p style="margin:0 0 20px;font-size:15px;color:${COLORS.ink};line-height:1.6">Rastreo de subastas · costa de Tarragona.</p>`;

  if (nuevas.length) {
    bodyHtml += `<p style="margin:24px 0 12px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${COLORS.inkSoft}">🆕 ${nuevas.length} nueva${nuevas.length !== 1 ? 's' : ''}</p>`;
    bodyHtml += nuevas.map((s) => row(s, siteUrl)).join('');
  }
  if (cerrandoPronto.length) {
    bodyHtml += `<p style="margin:28px 0 12px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${COLORS.inkSoft}">⏳ ${cerrandoPronto.length} cierra${cerrandoPronto.length !== 1 ? 'n' : ''} pronto</p>`;
    bodyHtml += cerrandoPronto.map((s) => row(s, siteUrl)).join('');
  }

  const subjectBits = [];
  if (nuevas.length) subjectBits.push(`${nuevas.length} nueva${nuevas.length !== 1 ? 's' : ''}`);
  if (cerrandoPronto.length) subjectBits.push(`${cerrandoPronto.length} cierra${cerrandoPronto.length !== 1 ? 'n' : ''} pronto`);

  const html = buildEmailLayout({
    preheader: `Subastas costa de Tarragona: ${subjectBits.join(' · ')}.`,
    title: 'Subastas · costa de Tarragona',
    bodyHtml,
    footerNote: 'Aviso automático del rastreo de subastas (uso interno). Frecuencia: diaria.',
    siteUrl,
  });

  return { subject: `Subastas costa Tarragona — ${subjectBits.join(' · ')}`, html };
}

module.exports = { buildAlertEmail, fmtFecha, TIPO_BIEN_LABEL };
