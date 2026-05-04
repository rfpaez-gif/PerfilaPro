// Job programado diario que purga (hard-delete) cards soft-deleted hace
// más de 30 días. Borra en orden: visits → facturas → cards.
//
// Periodo de gracia GDPR: el usuario soft-borra desde delete-account y
// dispone de 30 días para arrepentirse o exportar sus datos. Pasados
// los 30 días el job elimina la fila físicamente.
//
// Schedule: diario a las 03:00 UTC (configurado en netlify.toml).

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const GRACE_DAYS = 30;

async function purge(db, { graceDays = GRACE_DAYS, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: selectError } = await db
    .from('cards')
    .select('slug')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);

  if (selectError) {
    console.error('purge-deleted: error consultando candidates:', selectError.message);
    return { purged: 0, errors: 1 };
  }

  let purged = 0;
  let errors = 0;

  for (const { slug } of candidates || []) {
    const { error: visitsError } = await db.from('visits').delete().eq('slug', slug);
    if (visitsError) {
      console.error(`purge-deleted [${slug}]: visits failed:`, visitsError.message);
      errors++;
      continue;
    }

    const { error: facturasError } = await db.from('facturas').delete().eq('slug', slug);
    if (facturasError) {
      console.error(`purge-deleted [${slug}]: facturas failed:`, facturasError.message);
      errors++;
      continue;
    }

    const { error: cardError } = await db.from('cards').delete().eq('slug', slug);
    if (cardError) {
      console.error(`purge-deleted [${slug}]: card failed:`, cardError.message);
      errors++;
      continue;
    }

    purged++;
  }

  console.log(`purge-deleted: ${purged} cards purgadas, ${errors} errores, cutoff ${cutoff}`);
  return { purged, errors };
}

function makeHandler(db) {
  return async () => {
    const result = await purge(db);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  };
}

exports.handler = makeHandler(supabase);
exports.makeHandler = makeHandler;
exports.purge = purge;
exports.GRACE_DAYS = GRACE_DAYS;
