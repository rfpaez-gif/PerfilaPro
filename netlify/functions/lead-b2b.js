'use strict';

const { Resend } = require('resend');

const TEAM_SIZES = new Set(['5-20', '20-100', '100-500', '500+']);
const SECTORS    = new Set(['seguros', 'despacho', 'comercial', 'otro']);

const SECTOR_LABEL = {
  seguros:   'Seguros y agentes',
  despacho:  'Despachos y asesorías',
  comercial: 'Redes comerciales y franquicias',
  otro:      'Otro',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEmailHtml({ name, company, email, team_size, sector, message }) {
  const safeMessage = esc(message || '(sin mensaje adicional)').replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;color:#0A1F44;line-height:1.6">
<h2 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;letter-spacing:-0.01em">Nuevo lead B2B</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
  <tr><td style="color:#6B7280">Nombre</td><td><strong>${esc(name)}</strong></td></tr>
  <tr><td style="color:#6B7280">Empresa</td><td><strong>${esc(company)}</strong></td></tr>
  <tr><td style="color:#6B7280">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  <tr><td style="color:#6B7280">Equipo</td><td>${esc(team_size)}</td></tr>
  <tr><td style="color:#6B7280">Sector</td><td>${esc(SECTOR_LABEL[sector] || sector)}</td></tr>
</table>
<h3 style="font-family:'Source Serif 4',Georgia,serif;font-weight:400;color:#0A1F44;margin-top:1.5rem">Mensaje</h3>
<p style="background:#FAF7F0;padding:1rem;border-radius:8px">${safeMessage}</p>
<p style="font-size:12px;color:#6B7280;margin-top:2rem">Lead recibido en /es/empresas · PerfilaPro</p>
</body></html>`;
}

function makeHandler(emailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido' });
    }

    // Honeypot: si el campo "website" viene relleno, es bot. Devolvemos
    // 200 sin enviar email para no darle al bot información de que el
    // honeypot fue detectado.
    if (body.website) {
      return jsonResponse(200, { ok: true });
    }

    const name      = (body.name      || '').toString().trim().slice(0, 100);
    const company   = (body.company   || '').toString().trim().slice(0, 120);
    const email     = (body.email     || '').toString().trim().slice(0, 200).toLowerCase();
    const team_size = (body.team_size || '').toString().trim();
    const sector    = (body.sector    || '').toString().trim().toLowerCase();
    const message   = (body.message   || '').toString().trim().slice(0, 2000);

    if (!name || !company || !email) {
      return jsonResponse(400, { error: 'Faltan campos: nombre, empresa, email' });
    }
    if (!EMAIL_RE.test(email)) {
      return jsonResponse(400, { error: 'Email inválido' });
    }
    if (!TEAM_SIZES.has(team_size)) {
      return jsonResponse(400, { error: 'Tamaño de equipo no válido' });
    }
    if (!SECTORS.has(sector)) {
      return jsonResponse(400, { error: 'Sector no válido' });
    }

    const inbox = process.env.B2B_LEAD_INBOX;
    if (!inbox) {
      console.error('lead-b2b: B2B_LEAD_INBOX no configurada');
      return jsonResponse(500, { error: 'Endpoint mal configurado' });
    }

    const subject = `[Lead B2B · ${SECTOR_LABEL[sector]}] ${company} · ${name}`;
    const html    = buildEmailHtml({ name, company, email, team_size, sector, message });

    try {
      await emailClient.emails.send({
        from: 'PerfilaPro <leads@perfilapro.es>',
        to: inbox,
        replyTo: email,
        subject,
        html,
      });
      console.log(`lead-b2b: ${company} (${email}) → ${inbox}`);
    } catch (err) {
      console.error('lead-b2b: error enviando email:', err.message);
      return jsonResponse(500, { error: 'No se pudo enviar el email' });
    }

    return jsonResponse(200, { ok: true });
  };
}

const resend = new Resend(process.env.RESEND_API_KEY);
exports.handler = makeHandler(resend);
exports.makeHandler = makeHandler;
