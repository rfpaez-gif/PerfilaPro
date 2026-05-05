'use strict';

const { getDb } = require('./lib/supabase-client');
const { getSpecialtyMeta, getSectorCities, listProfiles, PAGE_SIZE } = require('./lib/get-profile');
const { esc, labelOf, renderCard, paginationLinks, htmlPage, getPageRange, buildDirectoryMeta, SHOWCASE_INTRO, buildShowcaseCta } = require('./lib/dir-utils');

function makeHandler(deps) {
  const _getSpecialtyMeta = deps.getSpecialtyMeta;
  const _getSectorCities  = deps.getSectorCities;
  const _listProfiles     = deps.listProfiles;
  const _PAGE_SIZE        = deps.PAGE_SIZE;
  const _getDb            = deps.getDb;

  return async (event) => {
    const proto   = (event.headers?.['x-forwarded-proto']) || 'https';
    const host    = (event.headers?.host) || 'perfilapro.es';
    const siteUrl = `${proto}://${host}`;

    const parts     = event.path.split('/').filter(Boolean);
    const sector    = parts[1];
    const specialty = parts[2];

    if (!sector || !specialty) return { statusCode: 400, body: 'Missing params' };

    const { page } = getPageRange(event.queryStringParameters?.p);
    const db = _getDb();

    const [meta, cities, { profiles, total, error }] = await Promise.all([
      _getSpecialtyMeta(db, sector, specialty),
      _getSectorCities(db, sector, specialty),
      _listProfiles(db, { sector, specialty, page }),
    ]);

    if (error) console.error('dir-especialidad error:', error.message);

    const sectorLabel    = labelOf(sector, meta?.sector_label);
    const specialtyLabel = meta?.specialty_label || labelOf(specialty, null);
    const canonicalBase  = `${siteUrl}/directorio/${sector}/${specialty}`;
    const canonical      = page > 1 ? `${canonicalBase}?p=${page}` : canonicalBase;
    const totalPages     = Math.ceil(total / _PAGE_SIZE);

    const { title: _title, desc: _desc } = buildDirectoryMeta({ sectorLabel, specialtyLabel });
    const title = meta?.meta_title ? `${meta.meta_title} | PerfilaPro` : _title;
    const desc  = meta?.meta_desc || _desc;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${specialtyLabel} en España`,
      url: canonicalBase,
      numberOfItems: total,
      itemListElement: profiles.slice(0, 10).map((p, i) => ({
        '@type': 'ListItem',
        position: (page - 1) * _PAGE_SIZE + i + 1,
        url: `${siteUrl}/p/${p.slug}`,
        name: p.nombre,
      })),
    };

    const citiesHtml = cities.length ? `<div class="pp-sub-section">
  <p class="pp-sub-section__label">Por ciudad</p>
  <div class="pp-sub-chips">
    ${cities.slice(0, 24).map(c => `<a href="${esc(siteUrl)}/directorio/${esc(sector)}/${esc(specialty)}/${esc(c.city_slug)}" class="pp-sub-chip">${esc(c.city_name)}</a>`).join('')}
  </div>
</div>` : '';

    const cardsHtml = profiles.length
      ? `<div class="pp-dir-grid">${profiles.map(p => renderCard(p, siteUrl)).join('\n')}</div>`
      : `<div class="pp-dir-empty"><h2>Sin resultados aún</h2><p>Aún no hay ${esc(specialtyLabel.toLowerCase())} con perfil PerfilaPro.<br>Si tu trabajo encaja aquí, sé tú quien empiece.</p></div>`;

    const body = `
<div class="pp-dir-ph">
  <h1>${esc(specialtyLabel)} en España</h1>
  <p class="pp-dir-ph__desc">${SHOWCASE_INTRO}</p>
  ${total > 0 ? `<p class="pp-dir-ph__count">${total} ${total === 1 ? 'profesional' : 'profesionales'} con perfil</p>` : ''}
</div>
${citiesHtml}
${cardsHtml}
${paginationLinks(page, totalPages, canonicalBase)}
${buildShowcaseCta(siteUrl)}`;

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
}

exports.handler = makeHandler({ getDb, getSpecialtyMeta, getSectorCities, listProfiles, PAGE_SIZE });
exports.makeHandler = makeHandler;
