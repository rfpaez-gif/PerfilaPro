const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const { buildEmailLayout, COLORS } = require('./lib/email-layout');
const { checkRateLimit, rateLimitResponse } = require('./lib/rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function buildEditLinkEmail({ nombre, editUrl }) {
  const firstName = (nombre || '').split(' ')[0] || 'Hola';

  const bodyHtml = `
            <p style="margin:0 0 24px;font-size:15px;color:${COLORS.inkSoft};line-height:1.7">
              Has solicitado editar tu perfil profesional. Haz clic en el botón de abajo para acceder al formulario de edición. El enlace es válido durante <strong>7 días</strong>.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              <tr><td align="center">
                <a href="${editUrl}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px">Editar mi perfil →</a>
              </td></tr>
            </table>

            <p style="margin:0;font-size:13px;color:${COLORS.inkSoft};line-height:1.6">
              Si no has solicitado este enlace, puedes ignorar este email. Nadie ha accedido a tu perfil.
            </p>`;

  return buildEmailLayout({
    preheader: 'Tu enlace de edición de PerfilaPro · válido 7 días',
    title: `Edita tu perfil, ${firstName}`,
    bodyHtml,
  });
}

function makeHandler(db, emailClient) {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const rl = checkRateLimit(event, { bucket: 'send-edit-link', limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl.limited) return rateLimitResponse(rl.retryAfter);

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'JSON inválido' }),
      };
    }

    const email    = (body.email || '').toLowerCase().trim();
    const slugParam = (body.slug  || '').toLowerCase().trim();

    if (!email && !slugParam) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Email o slug requerido' }),
      };
    }

    // Look up card by slug (from card footer link) or by email (manual form)
    const query = db.from('cards').select('slug, nombre, email, edit_link_sent_at').eq('status', 'active').is('deleted_at', null);
    const { data: card } = slugParam
      ? await query.eq('slug', slugParam).single()
      : await query.eq('email', email).single();

    const sendTo = slugParam ? card?.email : email;

    if (card && sendTo) {
      // Rate limit: máx 1 envío cada 10 minutos por tarjeta
      const lastSent = card.edit_link_sent_at ? new Date(card.edit_link_sent_at) : null;
      if (lastSent && Date.now() - lastSent.getTime() < 10 * 60 * 1000) {
        // Devolvemos 200 para no revelar si existe — el usuario espera y ya
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      }

      const token = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db
        .from('cards')
        .update({ edit_token: token, edit_token_expires_at: tokenExpiry, edit_link_sent_at: new Date().toISOString() })
        .eq('slug', card.slug);

      const siteUrl = process.env.URL || process.env.SITE_URL || 'https://perfilapro.es';
      const editUrl = `${siteUrl}/editar.html?slug=${card.slug}&token=${token}`;

      if (emailClient) {
        try {
          await emailClient.emails.send({
            from: 'PerfilaPro <hola@perfilapro.es>',
            to: sendTo,
            subject: `${card.nombre ? card.nombre.split(' ')[0] + ', tu' : 'Tu'} enlace para editar tu perfil`,
            html: buildEditLinkEmail({ nombre: card.nombre, editUrl }),
          });
        } catch (err) {
          console.error('Error enviando email de edición:', err.message);
        }
      }
    }

    // Always 200 — prevents email enumeration
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  };
}

exports.handler = makeHandler(supabase, resend);
exports.makeHandler = makeHandler;
exports.buildEditLinkEmail = buildEditLinkEmail;
