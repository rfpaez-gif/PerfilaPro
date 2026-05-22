'use strict';

// Lógica compartida de invite_team — usada por admin-orgs.js (acceso founder)
// y org-panel.js (acceso cliente self-serve). Mismo flujo en ambos casos:
//   1. Sanitizar plantilla común.
//   2. Cachear logo de la org una vez para los N miembros.
//   3. Por cada miembro: validar email → crear card B2B → renderizar tarjeta
//      de visita PDF → mandar email branded con la tarjeta adjunta →
//      marcar edit_link_sent_at.
//
// El caller (founder admin o cliente self-serve) se encarga de:
//   - Validar inputs (org_slug, team array, límite 100).
//   - Resolver la org desde BD y comprobar permisos.
//   - Devolver el JSON al usuario.
//
// Por qué un módulo aparte: el loop tiene ~100 líneas con un montón de
// estado intermedio (toSlug, token, PDF, fallback de logo). Duplicarlo
// en dos sitios garantiza drift; importarlo desde una sola fuente
// mantiene admin y panel cliente alineados — si añadimos un campo de
// plantilla en el futuro, lo añadimos UNA vez.

const crypto = require('crypto');
const {
  buildBusinessCardPDF,
  fetchLogoAsPngBuffer,
} = require('../printable-card-utils');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripTagsInline(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function toSlug(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
}

/**
 * Ejecuta un lote de invitaciones para una org.
 *
 * @param {Object} deps
 * @param {Object} deps.db            Cliente Supabase (o mock).
 * @param {Object} deps.emailClient   Cliente Resend (o mock con .emails.send).
 * @param {Function} deps.buildInviteEmail  fn(opts) → { subject, html }.
 * @param {Object} deps.org           Org ya cargada de BD con: id, slug, name,
 *                                    tagline, logo_url, color_primary, address,
 *                                    phone, email.
 * @param {Array}  deps.team          [{ email, nombre?, ocupacion? }, …].
 * @param {Object} deps.template      Datos comunes opcionales: tagline, descripcion,
 *                                    cp, zona, servicios[].
 * @param {string} deps.siteUrl       Base URL (sin trailing slash).
 *
 * @returns {Promise<{ok: Array, failed: Array}>}
 */
async function inviteTeamMembers({ db, emailClient, buildInviteEmail, org, team, template, siteUrl }) {
  const tpl = template || {};
  const tplTagline     = tpl.tagline ? stripTagsInline(tpl.tagline).substring(0, 140) : null;
  const tplDescripcion = tpl.descripcion ? stripTagsInline(tpl.descripcion).substring(0, 300) : null;
  const tplCp          = tpl.cp ? String(tpl.cp).trim().replace(/\D/g, '').substring(0, 5) : null;
  const tplZona        = tpl.zona ? stripTagsInline(tpl.zona).substring(0, 100) : null;
  const tplServicios   = Array.isArray(tpl.servicios)
    ? tpl.servicios.map(s => stripTagsInline(s).substring(0, 100)).filter(Boolean).slice(0, 20)
    : [];

  // Logo cacheado una sola vez para los N miembros.
  const orgLogoBuffer = org.logo_url
    ? await fetchLogoAsPngBuffer(org.logo_url).catch(() => null)
    : null;

  const ok = [];
  const failed = [];

  for (const raw of team) {
    const rawEmail     = raw && typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const rawNombre    = raw && typeof raw.nombre === 'string' ? raw.nombre : '';
    const rawOcupacion = raw && typeof raw.ocupacion === 'string' ? raw.ocupacion : '';

    if (!EMAIL_RE.test(rawEmail)) {
      failed.push({ email: rawEmail || '(sin email)', error: 'email inválido' });
      continue;
    }

    const cleanNombre    = rawNombre    ? stripTagsInline(rawNombre).substring(0, 100)    : '';
    const cleanOcupacion = rawOcupacion ? stripTagsInline(rawOcupacion).substring(0, 140) : '';
    const displayName = cleanNombre || 'Nuevo profesional';
    let slug = cleanNombre ? toSlug(cleanNombre) : '';
    if (!slug) {
      slug = `agente-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    }

    const { data: existing } = await db
      .from('cards')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      slug = `${slug.substring(0, 35)}-${Date.now().toString().slice(-4)}-${crypto.randomBytes(1).toString('hex')}`;
    }

    const editToken = crypto.randomBytes(32).toString('hex');
    const editTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const row = {
      slug,
      nombre:                displayName,
      email:                 rawEmail,
      plan:                  'b2b',
      status:                'active',
      organization_id:       org.id,
      edit_token:            editToken,
      edit_token_expires_at: editTokenExpiresAt,
      whatsapp:              '',
      idioma:                'es',
    };
    // Cargo individual (ocupacion) prevalece sobre tagline común — cada
    // miembro luce su rol específico en /e/:slug.
    const memberTagline = cleanOcupacion || tplTagline;
    if (memberTagline)  row.tagline     = memberTagline;
    if (tplDescripcion) row.descripcion = tplDescripcion;
    if (tplCp)          row.cp          = tplCp;
    if (tplZona)        row.zona        = tplZona;
    if (tplServicios.length) row.servicios = tplServicios;

    // Pre-rellena el emplazamiento con la sede de la org. Cubre el caso
    // "despacho sede única" out-of-the-box (todos los miembros heredan la
    // dirección sin tocar nada) y deja al miembro multi-sede (AOSSA con
    // emplazamientos en distintas provincias) cambiarla desde /editar.
    // local_publico=true porque un workplace es público por definición.
    if (org.address) {
      row.direccion     = stripTagsInline(org.address).substring(0, 200);
      row.local_publico = true;
    }

    const { error: insErr } = await db.from('cards').insert(row);
    if (insErr) {
      failed.push({ email: rawEmail, error: insErr.message });
      continue;
    }

    const editUrl = `${siteUrl}/es/editar?slug=${slug}&token=${editToken}`;
    const { subject, html } = buildInviteEmail({
      orgName:    org.name,
      orgLogoUrl: org.logo_url,
      orgColor:   org.color_primary,
      nombre:     cleanNombre,
      editUrl,
    });

    // Tarjeta de visita PDF — defensiva: si falla, mandamos el email sin
    // adjunto (la invitación es lo crítico, la tarjeta es bonus).
    let bizCardAttachment = null;
    try {
      const cardForPdf = {
        slug,
        nombre:    displayName,
        tagline:   memberTagline || null,
        whatsapp:  null,
        email:     rawEmail,
        direccion: row.direccion || null,
      };
      const pdfBuffer = await buildBusinessCardPDF({
        card: cardForPdf,
        org,
        logoBuffer: orgLogoBuffer,
        siteUrl,
      });
      bizCardAttachment = {
        filename: `tarjeta-${slug}.pdf`,
        content: pdfBuffer,
      };
    } catch (err) {
      console.warn(`team-invite: render de tarjeta de visita para ${slug} falló (no fatal):`, err.message);
    }

    try {
      const sendPayload = {
        from: 'PerfilaPro <hola@perfilapro.es>',
        to: rawEmail,
        subject,
        html,
      };
      if (bizCardAttachment) sendPayload.attachments = [bizCardAttachment];
      await emailClient.emails.send(sendPayload);
      ok.push({ email: rawEmail, slug });

      // Best-effort: si falla el UPDATE, la invitación ya está enviada
      // y la consideramos OK. El chip "Invitado hace Xd" combina este
      // campo con kit_email_sent_at via pickLastEmailTimestamp.
      try {
        const { error: stampErr } = await db
          .from('cards')
          .update({ edit_link_sent_at: new Date().toISOString() })
          .eq('slug', slug);
        if (stampErr) console.warn(`team-invite: no marqué edit_link_sent_at para ${slug}:`, stampErr.message);
      } catch (stampErr) {
        console.warn(`team-invite: no marqué edit_link_sent_at para ${slug}:`, stampErr.message);
      }
    } catch (err) {
      // Card creada pero email falló. El admin puede reenviar desde el panel.
      console.error(`team-invite: email a ${rawEmail} falló:`, err.message);
      failed.push({ email: rawEmail, slug, error: 'card creada pero email falló' });
    }
  }

  return { ok, failed };
}

module.exports = {
  inviteTeamMembers,
  stripTagsInline,
  toSlug,
  EMAIL_RE,
};
