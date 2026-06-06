'use strict';

// Desconecta el COBRO de un jugador cuando se le da de BAJA de un club.
//
// IMPORTANTE — solo se invoca en la baja del club (cierre de membresía vía
// cancel-membership / founder cantera_close_membership). NO se invoca al
// cambiar de equipo (enrollment_assign no cierra membresía) ni en un traspaso
// a otro club (cantera_execute_transfer: el jugador sigue activo en otro sitio
// y monta su propio cobro allí). Mezclar esos casos cancelaría pagos de un
// jugador que sigue jugando — el bug que hay que evitar.
//
// Dos piezas, ambas scoped a (card_slug, organization_id) — solo el club que
// da la baja, nunca el cobro de otro club:
//   1. enrollment_charges 'scheduled' → 'canceled'. Son los plazos futuros del
//      plan a medida que aún no se han cobrado. NO toca paid/processing/failed
//      (ya cobrados, en vuelo, o fallidos — su estado es histórico).
//   2. parent_subscriptions activas (cuota mensual Stripe) → cancela la
//      Subscription en la cuenta Connect del club y marca 'canceled' en BD.
//      Best-effort: si Stripe falla o no se puede cancelar, NO marca 'canceled'
//      (sería mentir: Stripe seguiría cobrando) — incrementa sub_errors para
//      que el caller lo sepa, y la baja sigue adelante igualmente.
//
// Idempotente: re-ejecutar no rompe (los scheduled ya cancelados no vuelven a
// estar scheduled; las subs ya canceladas no salen del filtro de activas).

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid'];

async function teardownPlayerBilling(db, stripe, { cardSlug, orgId, connectAccountId }) {
  const result = { charges_canceled: 0, subs_canceled: 0, sub_errors: 0 };
  if (!cardSlug || !orgId) return result;

  // 1. Cargos programados futuros del plan → cancelados.
  try {
    const { data: rows, error } = await db
      .from('enrollment_charges')
      .update({ status: 'canceled' })
      .eq('card_slug', cardSlug)
      .eq('organization_id', orgId)
      .eq('status', 'scheduled')
      .select('id');
    if (error) console.error('billing-teardown: enrollment_charges cancel error:', error.message);
    else result.charges_canceled = (rows || []).length;
  } catch (e) {
    console.error('billing-teardown: enrollment_charges cancel threw:', e.message);
  }

  // 2. Cuota mensual Stripe activa → cancelar en la cuenta Connect del club.
  try {
    const { data: subs, error } = await db
      .from('parent_subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('card_slug', cardSlug)
      .eq('organization_id', orgId)
      .in('status', ACTIVE_SUB_STATUSES);
    if (error) {
      console.error('billing-teardown: parent_subscriptions query error:', error.message);
      return result;
    }
    for (const sub of subs || []) {
      // Si hay una Subscription real en Stripe, hay que cancelarla allí ANTES
      // de marcar canceled en BD. Si no podemos (sin stripe/cuenta) o falla,
      // no marcamos canceled — Stripe seguiría cobrando y mentiríamos.
      if (sub.stripe_subscription_id) {
        if (!stripe || !connectAccountId) { result.sub_errors++; continue; }
        try {
          await stripe.subscriptions.cancel(sub.stripe_subscription_id, { stripeAccount: connectAccountId });
        } catch (e) {
          result.sub_errors++;
          console.error('billing-teardown: stripe subscription cancel error:', e.message);
          continue;
        }
      }
      await db.from('parent_subscriptions').update({ status: 'canceled' }).eq('id', sub.id);
      result.subs_canceled++;
    }
  } catch (e) {
    console.error('billing-teardown: parent_subscriptions threw:', e.message);
  }

  return result;
}

module.exports = { teardownPlayerBilling, ACTIVE_SUB_STATUSES };
