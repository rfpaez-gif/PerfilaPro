'use strict';

const { getDb } = require('./lib/supabase-client');

exports.handler = async () => {
  const db = getDb();

  const [{ data: categories }, { data: cities }] = await Promise.all([
    db.from('categories')
      .select('sector, sector_label, specialty, specialty_label')
      .order('sector')
      .order('sort_order'),
    db.from('cities')
      .select('name, slug, province')
      .eq('active', true)
      .order('name'),
  ]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
    body: JSON.stringify({ categories: categories || [], cities: cities || [] }),
  };
};
