const { createClient } = require('@supabase/supabase-js');
const { checkAdminAuth, unauthorizedResponse } = require('./admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = checkAdminAuth(event);
  if (!auth.authorized) return unauthorizedResponse(auth.blocked);

  const { data: cards, error } = await supabase
    .from('cards')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }

  const now = new Date();

  const stats = (cards || []).reduce(
    (acc, c) => {
      const isPaid = !!c.stripe_session_id;
      const isExpired = c.expires_at && new Date(c.expires_at) <= now;
      const daysLeft = c.expires_at
        ? (new Date(c.expires_at) - now) / (1000 * 60 * 60 * 24)
        : null;
      const isExpiringSoon = daysLeft !== null && !isExpired && daysLeft <= 30;

      acc.total++;
      if (!isPaid) {
        acc.free++;
      } else if (isExpired) {
        acc.expired++;
      } else {
        acc.active++;
        if (isExpiringSoon) acc.expiringSoon++;
        if (c.plan === 'pro') acc.revenue += 19;
        else if (c.plan === 'base') acc.revenue += 9;
        else if (c.plan === 'renovacion') acc.revenue += 5;
      }

      return acc;
    },
    { total: 0, active: 0, expired: 0, free: 0, revenue: 0, expiringSoon: 0 }
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ stats, cards: cards || [] }),
  };
};
