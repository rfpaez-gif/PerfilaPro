const RESEND_API = 'https://api.resend.com/emails';

async function send({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY no configurada, email omitido');
    return;
  }

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'PerfilaPro <hola@perfilapro.es>',
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[email] Error Resend:', err);
  }
}

function welcomeEmail({ nombre, slug, plan }) {
  const siteUrl = process.env.SITE_URL || 'https://perfilapro.netlify.app';
  const cardUrl = `${siteUrl}/c/${slug}`;
  const planLabel = plan === 'pro' ? 'Pro · 12 meses' : 'Base · 3 meses';

  const subject = `Ya está lista tu tarjeta, ${nombre} 🎉`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5f2ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e1b14;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid rgba(30,27,20,.08);overflow:hidden;">
        <tr><td style="background:#01696f;padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#fff;letter-spacing:-.01em;">PerfilaPro</p>
        </td></tr>
        <tr><td style="padding:36px 32px 28px;">
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;line-height:1.25;color:#1e1b14;">
            Ya está lista tu tarjeta, ${nombre}. 🎉
          </h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#6b6458;">
            Acabas de hacer algo que muchos profesionales llevan posponiendo años: tener una presencia digital que se ve bien y se comparte en dos segundos.
          </p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#6b6458;">
            Tu tarjeta está aquí:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#01696f;border-radius:10px;">
              <a href="${cardUrl}" style="display:block;padding:13px 26px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">${cardUrl}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#6b6458;">
            Compártela por WhatsApp, ponla en tu bio de Instagram, imprímela como QR en tu furgoneta. Para eso está.
          </p>
          <p style="margin:0;font-size:15px;line-height:1.65;color:#6b6458;">
            Plan activo: <strong style="color:#01696f;">${planLabel}</strong>. Te avisaremos antes de que caduque para que no te pille desprevenido.
          </p>
        </td></tr>
        <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid rgba(30,27,20,.08);margin:0;"></td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;font-size:13px;color:#a89f90;line-height:1.5;">
            Cualquier cosa, responde a este email.<br>— El equipo de PerfilaPro
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `¡Ya está lista tu tarjeta, ${nombre}!

Acabas de hacer algo que muchos profesionales llevan posponiendo años: tener una presencia digital que se ve bien y se comparte en dos segundos.

Tu tarjeta: ${cardUrl}

Plan activo: ${planLabel}. Te avisaremos antes de que caduque.

Cualquier cosa, responde a este email.
— El equipo de PerfilaPro`;

  return { subject, html, text };
}

function expiryEmail({ nombre, slug, daysLeft }) {
  const siteUrl = process.env.SITE_URL || 'https://perfilapro.netlify.app';
  const cardUrl = `${siteUrl}/c/${slug}`;
  const renewUrl = `${siteUrl}/#crear`;
  const isUrgent = daysLeft <= 7;

  const subject = isUrgent
    ? `⚠️ Tu tarjeta caduca en ${daysLeft} día${daysLeft === 1 ? '' : 's'}, ${nombre}`
    : `Tu tarjeta caduca en ${daysLeft} días, ${nombre}`;

  const headerColor = isUrgent ? '#dc2626' : '#ca8a04';
  const intro = isUrgent
    ? 'En pocos días tu tarjeta dejará de estar visible. Renuévala ahora para que tus clientes sigan encontrándote.'
    : 'Aviso sin drama: en un mes caduca tu tarjeta PerfilaPro. Renuévala cuando quieras y seguirá activa sin interrupciones.';

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f5f2ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e1b14;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ec;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid rgba(30,27,20,.08);overflow:hidden;">
        <tr><td style="background:${headerColor};padding:24px 32px;">
          <p style="margin:0;font-size:20px;font-weight:800;color:#fff;letter-spacing:-.01em;">PerfilaPro</p>
        </td></tr>
        <tr><td style="padding:36px 32px 28px;">
          <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;line-height:1.25;color:#1e1b14;">
            ${isUrgent ? `${nombre}, te quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'}. ⚠️` : `${nombre}, tu tarjeta caduca en ${daysLeft} días.`}
          </h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#6b6458;">${intro}</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#01696f;border-radius:10px;">
              <a href="${renewUrl}" style="display:block;padding:13px 26px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">Renovar tarjeta</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:14px;line-height:1.65;color:#a89f90;">
            Tu tarjeta actual: <a href="${cardUrl}" style="color:#01696f;text-decoration:none;">${cardUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid rgba(30,27,20,.08);margin:0;"></td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;font-size:13px;color:#a89f90;line-height:1.5;">
            Cualquier cosa, responde a este email.<br>— El equipo de PerfilaPro
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${nombre}, tu tarjeta PerfilaPro caduca en ${daysLeft} día${daysLeft === 1 ? '' : 's'}.

${intro}

Renuévala aquí: ${renewUrl}

Tu tarjeta: ${cardUrl}

— El equipo de PerfilaPro`;

  return { subject, html, text };
}

module.exports = { send, welcomeEmail, expiryEmail };
