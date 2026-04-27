'use strict';

const { getDb } = require('./lib/supabase-client');
const { getSpecialtyMeta, getCityBySlug, listProfiles, PAGE_SIZE } = require('./lib/get-profile');
const { esc, labelOf, renderCard, paginationLinks, htmlPage } = require('./lib/dir-utils');

exports.handler = async (event) => {
  const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
  const host    = (event.headers?.host) || 'perfilapro.es';
  const siteUrl = `${proto}://${host}`;

  const parts     = event.path.split('/').filter(Boolean);
  const sector    = parts[1];
  const specialty = parts[2];
  const citySlug  = parts[3];

  if (!sector || !specialty || !citySlug) return { statusCode: 400, body: 'Missing params' };

  const isAllCities = specialty === '_';

  const page = Math.max(1, parseInt(event.queryStringParameters?.p || '1', 10));
  const db   = getDb();

  const [meta, cityMeta, { profiles, total, error }] = await Promise.all([
    isAllCities ? null : getSpecialtyMeta(db, sector, specialty),
    getCityBySlug(db, citySlug),
    listProfiles(db, { sector, specialty: isAllCities ? undefined : specialty, citySlug, page }),
  ]);

  if (error) console.error('dir-ciudad error:', error.message);

  const sectorLabel    = labelOf(sector, meta?.sector_label);
  const specialtyLabel = isAllCities ? sectorLabel : (meta?.specialty_label || labelOf(specialty, null));
  const cityLabel      = cityMeta ? cityMeta.name : citySlug.charAt(0).toUpperCase() + citySlug.slice(1).replace(/-/g, ' ');
  const canonicalBase  = `${siteUrl}/directorio/${sector}/${specialty}/${citySlug}`;
  const canonical      = page > 1 ? `${canonicalBase}?p=${page}` : canonicalBase;
  const totalPages     = Math.ceil(total / PAGE_SIZE);

  const title = `${specialtyLabel} en ${cityLabel} | PerfilaPro`;
  const desc  = `Encuentra ${specialtyLabel.toLowerCase()} en ${cityLabel}. Directorio de profesionales actualizado en PerfilaPro.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${specialtyLabel} en ${cityLabel}`,
    url: canonicalBase,
    numberOfItems: total,
    itemListElement: profiles.slice(0, 10).map((p, i) => ({
      '@type': 'ListItem',
      position: (page - 1) * PAGE_SIZE + i + 1,
      url: `${siteUrl}/p/${p.slug}`,
      name: p.nombre,
    })),
  };

  const cardsHtml = profiles.length
    ? `<div class="dir-grid">${profiles.map(p => renderCard(p, siteUrl)).join('\n')}</div>`
    : `<div class="dir-empty"><h2>Sin resultados aún</h2><p>Aún no hay ${esc(specialtyLabel.toLowerCase())} en ${esc(cityLabel)}.</p></div>`;

  const body = `
<div class="dir-ph">
  <h1>${esc(specialtyLabel)} en ${esc(cityLabel)}</h1>
  <p class="dir-ph-desc">${esc(desc)}</p>
  ${total > 0 ? `<p class="dir-count">${total} profesionale${total !== 1 ? 's' : ''}</p>` : ''}
</div>
${cardsHtml}
${paginationLinks(page, totalPages, canonicalBase)}`;

  const crumbs = [
    { label: 'Directorio', url: `${siteUrl}/directorio` },
    { label: sectorLabel, url: `${siteUrl}/directorio/${sector}` },
  ];
  if (!isAllCities) crumbs.push({ label: specialtyLabel, url: `${siteUrl}/directorio/${sector}/${specialty}` });
  crumbs.push({ label: cityLabel });

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
      crumbs,
      siteUrl,
      jsonLd,
    }),
  };
};
