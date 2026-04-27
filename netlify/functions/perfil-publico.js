'use strict';

// Consulta `cards` directamente (no `directory_public`) — decisión intencional:
// - /p/:slug es accesible para cualquier tarjeta activa, con o sin categoría asignada.
//   Tener URL propia es un derecho del plan gratuito.
// - Los listados en /directorio/* sí usan `directory_public`, que exige JOIN con
//   `categories` y `directory_visible = true`. Aparecer en listados requiere completar
//   el perfil (especialidad + ciudad + activar visibilidad).
// Esta asimetría es intencional: no es un bug.

const { getDb } = require('./lib/supabase-client');
const { getPublicProfile, getCategoryByCard, getCityBySlug } = require('./lib/get-profile');
const { esc, safeJson, labelOf, PROFILE_CSS, htmlPage, breadcrumb } = require('./lib/dir-utils');

function normalizePhone(tel) {
  if (!tel) return null;
  const digits = String(tel).replace(/\D/g, '');
  return tel.trim().startsWith('+') ? '+' + digits : '+34' + digits;
}

exports.handler = async (event) => {
  const proto  = (event.headers?.['x-forwarded-proto']) || 'https';
  const host   = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const slug = event.path
    .replace('/.netlify/functions/perfil-publico', '')
    .replace(/^\/p\//, '')
    .replace(/\/$/, '');

  if (!slug) return { statusCode: 400, body: 'Missing slug' };

  const db = getDb();
  const data = await getPublicProfile(db, slug);

  if (!data) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage({
        title: 'Perfil no encontrado — PerfilaPro',
        desc: 'Este perfil no existe o no está activo.',
        canonical: `${siteUrl}/p/${slug}`,
        body: `<div style="text-align:center;padding:4rem 1rem;color:var(--muted)"><h1 style="font-family:var(--ff-d);font-size:1.5rem;font-weight:400;margin-bottom:.5rem">Perfil no encontrado</h1><p>Este perfil no existe o no está activo.</p></div>`,
        crumbs: null,
        siteUrl,
      }),
    };
  }

  // Incrementar contador de visitas (no bloqueante)
  db.from('cards')
    .update({ profile_views: (data.profile_views || 0) + 1 })
    .eq('slug', data.slug)
    .then(({ error: ve }) => { if (ve) console.error('profile_views error:', ve.message); });

  const [cat, city] = await Promise.all([
    getCategoryByCard(db, data.category_id),
    getCityBySlug(db, data.city_slug),
  ]);

  const isPaid = !!data.stripe_session_id;
  const isPro  = data.plan === 'pro';
  const profileUrl = `${siteUrl}/p/${data.slug}`;
  const cardUrl    = `${siteUrl}/c/${data.slug}`;

  const avatarInitial = esc((data.nombre || '').trim().charAt(0).toUpperCase() || '?');
  const sectorLabel   = cat ? cat.sector_label : '';
  const cityLabel     = city ? `${city.name}${city.province && city.province !== city.name ? `, ${city.province}` : ''}` : (data.zona || '');
  const descFull      = data.descripcion || '';
  const descDisplay   = isPaid ? descFull : (descFull.length > 80 ? descFull.substring(0, 80) + '…' : descFull);

  const waUrl = isPaid && data.whatsapp
    ? `https://wa.me/${data.whatsapp}?text=${encodeURIComponent('Hola, he visto tu perfil en PerfilaPro y me interesa contactarte.')}`
    : null;

  const serviciosHTML = (data.servicios || []).map((s, i) => {
    const m = s.match(/^(.+?)[\s·\-–]+(\d[\d.,€\s\/h]*)$/);
    const nombre = esc(m ? m[1].trim() : s);
    const precio = esc(m ? m[2].trim() : '');
    return `<div class="prof-svc-item${i === 0 ? ' prof-svc-item--lead' : ''}">
  <span class="prof-svc-name">${nombre}</span>
  ${precio ? `<span class="prof-svc-price">${precio}</span>` : ''}
</div>`;
  }).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: data.nombre || '',
    description: descFull.substring(0, 200),
    url: profileUrl,
    ...(isPaid && data.whatsapp ? { telephone: '+' + data.whatsapp } : {}),
    ...(city ? { address: { '@type': 'PostalAddress', addressLocality: city.name, addressRegion: city.province, addressCountry: 'ES' } } : {}),
    ...(cat ? { category: cat.specialty_label } : {}),
  };

  const crumbs = [
    { label: 'Directorio', url: `${siteUrl}/directorio` },
    ...(cat ? [
      { label: sectorLabel, url: `${siteUrl}/directorio/${cat.sector}` },
      { label: cat.specialty_label, url: `${siteUrl}/directorio/${cat.sector}/${cat.specialty}` },
    ] : []),
    { label: data.nombre || slug },
  ];

  const metaTitle = `${esc(data.nombre)} — ${esc(data.tagline || sectorLabel || 'Profesional')} en ${esc(cityLabel || 'España')} | PerfilaPro`;
  const metaDesc  = `${data.tagline || ''} ${descFull ? '· ' + descFull.substring(0, 120) : ''} ${cityLabel ? '· ' + cityLabel : ''}`.trim().substring(0, 160);

  const body = `<div class="prof-wrap">
  <div class="prof-hero">
    <div class="prof-av">
      ${isPaid && data.foto_url
        ? `<img src="${esc(data.foto_url)}" alt="${esc(data.nombre)}" width="80" height="80">`
        : `<span class="prof-av-init">${avatarInitial}</span>`}
    </div>
    <div>
      <h1 class="prof-name">${esc(data.nombre)}</h1>
      ${data.tagline ? `<p class="prof-role">${esc(data.tagline)}</p>` : ''}
      ${cityLabel ? `<p class="prof-loc"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(cityLabel)}</p>` : ''}
    </div>
  </div>

  ${descDisplay ? `<div class="prof-section">
    <p class="prof-section-lbl">Sobre mí</p>
    <p class="prof-desc">${esc(descDisplay)}</p>
  </div>` : ''}

  ${serviciosHTML ? `<div class="prof-section">
    <p class="prof-section-lbl">Servicios</p>
    <div class="prof-svc-list">${serviciosHTML}</div>
  </div>` : ''}

  ${isPaid && (waUrl || data.telefono) ? `<div class="prof-section">
    <p class="prof-section-lbl">Contacto directo</p>
    <div class="prof-contact">
      ${waUrl ? `<a href="${esc(waUrl)}" target="_blank" rel="noopener" class="btn btn--wa">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.535 5.858L0 24l6.335-1.652A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
        Contactar por WhatsApp
      </a>` : ''}
      ${data.telefono ? `<a href="tel:${normalizePhone(data.telefono)}" class="btn btn--call">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.05 12.05 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.84a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.05 12.05 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        Llamar
      </a>` : ''}
    </div>
  </div>` : ''}

  ${!isPaid ? `<div class="prof-section">
    <p class="prof-section-lbl">Contacto</p>
    <div class="contact-locked">
      <p>Este profesional aún no ha habilitado el contacto directo.</p>
      <p style="margin-top:.5rem;font-size:.8125rem">¿Eres ${esc(data.nombre)}? <a href="${esc(siteUrl)}/#crear">Activa tu plan</a> para aparecer primero y recibir contactos.</p>
    </div>
  </div>` : ''}

  <a href="${esc(cardUrl)}" class="prof-card-link">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 2v4M16 2v4M2 10h20"/></svg>
    Ver tarjeta de contacto
  </a>

  <div class="prof-cta">
    <p>¿Eres profesional? Aparece en el directorio y recibe clientes directamente.</p>
    <a href="${esc(siteUrl)}/#crear">Crea tu perfil gratis →</a>
  </div>
</div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: htmlPage({
      title: metaTitle,
      desc: metaDesc,
      canonical: profileUrl,
      body,
      crumbs,
      siteUrl,
      jsonLd,
      extraCss: PROFILE_CSS,
    }),
  };
};
