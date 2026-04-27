'use strict';

const { getDb } = require('./lib/supabase-client');
const { getSpecialtyMeta, getSectorCities, listProfiles, PAGE_SIZE } = require('./lib/get-profile');
const { esc, labelOf, renderCard, paginationLinks, htmlPage } = require('./lib/dir-utils');

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const parts     = event.path.split('/').filter(Boolean);
  const sector    = parts[1];
  const specialty = parts[2];

  if (!sector || !specialty) return { statusCode: 400, body: 'Missing params' };

  const page = Math.max(1, parseInt(event.queryStringParameters?.p || '1', 10));
  const db   = getDb();

  const [meta, cities, { profiles, total, error }] = await Promise.all([
    getSpecialtyMeta(db, sector, specialty),
    getSectorCities(db, sector, specialty),
    listProfiles(db, { sector, specialty, page }),
  ]);

  if (error) console.error('dir-especialidad error:', error.message);

  const sectorLabel    = labelOf(sector, meta?.sector_label);
  const specialtyLabel = meta?.specialty_label || labelOf(specialty, null);
  const canonicalBase  = `${siteUrl}/directorio/${sector}/${specialty}`;
  const canonical      = page > 1 ? `${canonicalBase}?p=${page}` : canonicalBase;
  const totalPages     = Math.ceil(total / PAGE_SIZE);

  const title = meta?.meta_title
    ? `${meta.meta_title} | PerfilaPro`
    : `${specialtyLabel} en España | PerfilaPro`;
  const desc  = meta?.meta_desc
    || `Encuentra ${specialtyLabel.toLowerCase()} cerca de ti. Directorio actualizado en PerfilaPro.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${specialtyLabel} en España`,
    url: canonicalBase,
    numberOfItems: total,
    itemListElement: profiles.slice(0, 10).map((p, i) => ({
      '@type': 'ListItem',
      position: (page - 1) * PAGE_SIZE + i + 1,
      url: `${siteUrl}/p/${p.slug}`,
      name: p.nombre,
    })),
  };

  const citiesHtml = cities.length ? `<div class="sub-section">
  <p class="sub-section-label">Por ciudad</p>
  <div class="sub-chips">
    ${cities.slice(0, 24).map(c => `<a href="${esc(siteUrl)}/directorio/${esc(sector)}/${esc(specialty)}/${esc(c.city_slug)}" class="sub-chip">${esc(c.city_name)}</a>`).join('')}
  </div>
</div>` : '';

  const cardsHtml = profiles.length
    ? `<div class="dir-grid">${profiles.map(p => renderCard(p, siteUrl)).join('\n')}</div>`
    : `<div class="dir-empty"><h2>Sin resultados aún</h2><p>Aún no hay ${esc(specialtyLabel.toLowerCase())} en el directorio.</p></div>`;

  const body = `
<div class="dir-ph">
  <h1>${esc(specialtyLabel)} en España</h1>
  ${desc ? `<p class="dir-ph-desc">${esc(desc)}</p>` : ''}
  ${total > 0 ? `<p class="dir-count">${total} profesionale${total !== 1 ? 's' : ''}</p>` : ''}
</div>
${citiesHtml}
${cardsHtml}
${paginationLinks(page, totalPages, canonicalBase)}`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: htmlPage({
      title,
      desc,
      canonical,
      prevUrl: page > 1 ? `${canonicalBase}?p=${page - 1}` : null,
      nextUrl: page < totalPages ? `${canonicalBase}?p=${page + 1}` : null,
      body,
      crumbs: [
        { label: 'Directorio', url: `${siteUrl}/directorio` },
        { label: sectorLabel, url: `${siteUrl}/directorio/${sector}` },
        { label: specialtyLabel },
      ],
      siteUrl,
      jsonLd,
    }),
  };
};
