'use strict';

// GET /inscripcion/:token   ·   Cantera · inscripción pública (capa I4)
//
// Sirve la página del formulario del padre. Resuelve la campaña por token:
//   - campaña abierta → formulario con nombre del club + importes.
//   - cerrada / inexistente → página informativa (sin form).
// Siempre noindex (es un enlace privado que reparte el club). El submit lo
// hace el front contra /api/enrollment-submit; si el padre elige pagar
// online, encadena /api/create-enrollment-checkout con la parent_session.
//
// Gateado por isCanteraActive() (404 si el carril está off — no revelamos
// la existencia del endpoint).

const { createClient } = require('@supabase/supabase-js');
const { isCanteraActive } = require('./lib/cantera-flag');
const { readPlan, planTotalCents } = require('./lib/enrollment-campaign');

const defaultDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TOKEN_RE = /^[0-9a-f]{32}$/;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eur(cents) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

// Formatea una fecha AAAA-MM-DD a lenguaje natural (es/ca). Defensivo:
// si el locale o la fecha fallan, devuelve la cadena original.
function fmtDate(due, lang = 'es') {
  try {
    const d = new Date(due + 'T00:00:00');
    if (isNaN(d.getTime())) return due;
    return d.toLocaleDateString(lang === 'ca' ? 'ca-ES' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return due; }
}

function htmlResponse(statusCode, html) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body: html,
  };
}

function shell(title, inner, lang = 'es') {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8">
<title>${esc(title)} — PerfilaPro</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<style>
:root{--ink:#0A1F44;--accent:#00C277;--gris:#6B7280;--bg:#FAF7F0;--line:#E5E7EB;--err:#B0392A}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:1.5rem 1rem;line-height:1.5}
.wrap{max-width:520px;margin:0 auto}
.card{background:#fff;border:1px solid var(--line);border-radius:1rem;padding:1.5rem 1.25rem;margin-bottom:1rem}
h1{font-size:1.4rem;margin:0 0 .25rem;letter-spacing:-.02em}
.club{color:var(--accent);font-weight:700}
.sub{color:var(--gris);font-size:.9rem;margin:.25rem 0 0}
.sect{font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gris);margin:1.25rem 0 .5rem}
label{display:block;font-size:.85rem;font-weight:600;margin:.65rem 0 .25rem}
label small{font-weight:400;color:var(--gris)}
input,select{width:100%;padding:.6rem .7rem;border:1px solid var(--line);border-radius:.6rem;font-size:1rem;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--accent)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.check{display:flex;gap:.6rem;align-items:flex-start;margin:.6rem 0;font-size:.88rem;font-weight:400}
.check input{width:auto;margin-top:.2rem}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.pay{border:1px solid var(--line);border-radius:.6rem;padding:.6rem .7rem;margin:.4rem 0;display:flex;gap:.6rem;align-items:flex-start;cursor:pointer}
.pay input{width:auto;margin-top:.2rem}
.amounts{background:#F3FAF6;border-radius:.6rem;padding:.75rem;font-size:.9rem;margin:.5rem 0}
.plan-title{font-weight:700;margin-bottom:.4rem}
.plan-row{display:flex;justify-content:space-between;gap:.75rem;padding:.25rem 0}
.plan-row small{color:var(--gris);font-weight:400;display:block}
.plan-total{display:flex;justify-content:space-between;gap:.75rem;border-top:1px solid var(--line);margin-top:.4rem;padding-top:.4rem;font-weight:700}
.plan-note{color:var(--gris);font-size:.8rem;margin-top:.5rem}
.btn{width:100%;background:var(--accent);color:#fff;border:none;border-radius:100px;padding:.85rem;font-size:1rem;font-weight:700;cursor:pointer;margin-top:1rem}
.btn:disabled{opacity:.6;cursor:default}
.err{color:var(--err);font-size:.85rem;margin-top:.5rem;min-height:1.2em}
.foot{text-align:center;color:var(--gris);font-size:.78rem;margin-top:1rem}
.ok-box{text-align:center;padding:1rem 0}
.ok-box .big{font-size:2.5rem}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

function closedPage(lang = 'es') {
  const inner = `<div class="card ok-box">
    <p class="big">📋</p>
    <h1>Inscripciones cerradas</h1>
    <p class="sub">Este enlace de inscripción no está activo. Si crees que es un error, contacta con tu club.</p>
  </div>`;
  return shell('Inscripciones cerradas', inner, lang);
}

function formPage({ token, org, campaign, lang = 'es' }) {
  // Plan de pagos a medida (conceptos con fecha) tiene prioridad sobre el
  // modelo matrícula+cuota cuando el club lo ha diseñado.
  const plan = readPlan(campaign.concepts_jsonb);
  const hasPlan = plan.length > 0;

  let amountsBlock = '';
  if (hasPlan) {
    const rows = plan.map(c =>
      `<div class="plan-row"><span>${esc(c.concepto)} <small>${esc(fmtDate(c.due_date, lang))}</small></span><strong>${eur(c.amount_cents)}</strong></div>`
    ).join('');
    const total = eur(planTotalCents(plan));
    amountsBlock = `<div class="amounts">
      <div class="plan-title">Plan de pagos de la temporada</div>
      ${rows}
      <div class="plan-total"><span>Total temporada</span><strong>${total}</strong></div>
      <div class="plan-note">El club te indicará cómo abonar cada pago en su fecha (Bizum, efectivo o transferencia).</div>
    </div>`;
  } else {
    const matricula = eur(campaign.matricula_cents);
    const fee = eur(campaign.monthly_fee_cents);
    const inst = campaign.num_installments || 9;
    const amountsLines = [];
    if (matricula) amountsLines.push(`<div>Matrícula (pago único): <strong>${matricula}</strong></div>`);
    if (fee) amountsLines.push(`<div>Cuota mensual: <strong>${fee}</strong> × ${inst} meses</div>`);
    amountsBlock = amountsLines.length ? `<div class="amounts">${amountsLines.join('')}</div>` : '';
  }

  // Pago online (SEPA/tarjeta) solo si el club tiene Stripe Connect activo.
  // Con plan a medida y club conectado, cobramos el plan por Stripe (lo que
  // vence ya + mandato para los plazos). Sin Connect, el plan se cobra al
  // club (manual). El modelo matrícula+cuota mantiene su comportamiento.
  const canPayOnline = !!org.stripe_connect_charges_enabled;
  const onlineOpt = `<label class="pay"><input type="radio" name="payment_choice" value="online" checked>
        <span><strong>Pagar online</strong> — domiciliación SEPA o tarjeta. Cómodo y automático.</span></label>`;
  const clubOptAlt = `<label class="pay"><input type="radio" name="payment_choice" value="club">
        <span><strong>Lo gestiono con el club</strong> — Bizum, efectivo o transferencia.</span></label>`;
  const clubOptOnly = `<label class="pay"><input type="radio" name="payment_choice" value="club" checked>
        <span><strong>Pago al club</strong> — el club te indicará cómo abonar cada concepto en su fecha.</span></label>`;
  let payOptions;
  if (hasPlan) {
    payOptions = canPayOnline ? (onlineOpt + clubOptAlt) : clubOptOnly;
  } else {
    payOptions = onlineOpt + clubOptAlt;
  }

  const inner = `
  <div class="card">
    <h1>Inscripción de temporada</h1>
    <p class="sub"><span class="club">${esc(org.name)}</span> · ${esc(campaign.season)}</p>
  </div>
  <form id="enrForm" class="card" autocomplete="on">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

    <div class="sect">El/la deportista</div>
    <label for="nombre">Nombre y apellidos</label>
    <input id="nombre" name="nombre" type="text" required maxlength="100">
    <div class="row2">
      <div><label for="birth_date">Fecha de nacimiento</label><input id="birth_date" name="birth_date" type="date" required></div>
      <div><label for="gender">Sexo <small>opcional</small></label>
        <select id="gender" name="gender"><option value="">—</option><option value="M">Masculino</option><option value="F">Femenino</option><option value="X">Otro</option></select></div>
    </div>
    <div class="row2">
      <div><label for="doc_kind">Documento <small>opcional</small></label>
        <select id="doc_kind" name="doc_kind"><option value="">—</option><option value="dni">DNI</option><option value="nie">NIE</option><option value="pasaporte">Pasaporte</option><option value="libro_familia">Libro de familia</option></select></div>
      <div><label for="doc_number">Nº documento <small>opcional</small></label><input id="doc_number" name="doc_number" type="text" maxlength="40"></div>
    </div>

    <div class="sect">Tutor/a legal</div>
    <label for="tutor_legal_name">Nombre completo</label>
    <input id="tutor_legal_name" name="tutor_legal_name" type="text" required maxlength="100">
    <div class="row2">
      <div><label for="tutor_legal_email">Email</label><input id="tutor_legal_email" name="tutor_legal_email" type="email" required autocapitalize="off"></div>
      <div><label for="tutor_legal_phone">Teléfono <small>opcional</small></label><input id="tutor_legal_phone" name="tutor_legal_phone" type="tel"></div>
    </div>
    <label for="tutor_legal_dni">DNI del tutor/a <small>opcional</small></label>
    <input id="tutor_legal_dni" name="tutor_legal_dni" type="text" maxlength="20">

    <div class="sect">Consentimientos</div>
    <label class="check"><input type="checkbox" id="consent_data" name="consent_data" required>
      <span>Autorizo el tratamiento de los datos del menor para la gestión deportiva del club. (Obligatorio)</span></label>
    <label class="check"><input type="checkbox" id="consent_image" name="consent_image">
      <span>Cedo los derechos de imagen para la ficha digital y el carnet del jugador/a. (Opcional)</span></label>

    <div class="sect">Pago</div>
    ${amountsBlock}
    ${payOptions}

    <button type="submit" class="btn" id="submitBtn">Inscribir →</button>
    <p class="err" id="enrErr"></p>
  </form>
  <p class="foot">PerfilaPro · La ficha del menor no es pública hasta que tú lo autorices.</p>

  <script>
  (function(){
    var TOKEN = ${JSON.stringify(token)};
    var form = document.getElementById('enrForm');
    var btn = document.getElementById('submitBtn');
    var err = document.getElementById('enrErr');
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      err.textContent = '';
      var fd = new FormData(form);
      var payload = { token: TOKEN, idioma: ${JSON.stringify(lang)} };
      fd.forEach(function(v,k){ payload[k] = v; });
      payload.consent_data = form.consent_data.checked;
      payload.consent_image = form.consent_image.checked;
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        var r = await fetch('/api/enrollment-submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        var data = await r.json();
        if (!r.ok) { throw new Error(data.error || 'No se pudo completar la inscripción'); }
        if (data.payment_choice === 'online' && data.parent_session) {
          // Encadena el checkout de inscripción con la sesión del tutor.
          var c = await fetch('/api/create-enrollment-checkout', {
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+data.parent_session},
            body: JSON.stringify({ card_slug: data.slug, campaign_id: data.campaign_id })
          });
          var cd = await c.json();
          if (c.ok && cd.url) { window.location.href = cd.url; return; }
          // Si el cobro online no arranca, caemos a la confirmación: la
          // ficha ya está creada y el club puede cobrar por otra vía.
        }
        document.querySelector('.wrap').innerHTML =
          '<div class="card ok-box"><p class="big">✅</p><h1>¡Inscripción recibida!</h1>'+
          '<p class="sub">Te hemos enviado un email para acceder a tu panel y completar la ficha.</p></div>';
      } catch(ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = 'Inscribir →';
      }
    });
  })();
  </script>`;
  return shell('Inscripción · ' + org.name, inner, lang);
}

function makeHandler(db) {
  return async (event) => {
    // 404 si el carril está off — no revelamos el endpoint.
    if (!isCanteraActive()) return htmlResponse(404, shell('No encontrado', '<div class="card ok-box"><h1>404</h1></div>'));

    const parts = (event.path || '').split('/').filter(Boolean);
    // /es/inscripcion/:token o /inscripcion/:token → último segmento.
    const token = (parts[parts.length - 1] || event.queryStringParameters?.token || '').trim();
    const lang = (event.path || '').includes('/ca/') ? 'ca' : 'es';

    if (!TOKEN_RE.test(token)) return htmlResponse(404, closedPage(lang));

    const { data: campaign } = await db
      .from('enrollment_campaigns')
      .select('id, organization_id, season, status, matricula_cents, monthly_fee_cents, num_installments, concepts_jsonb')
      .eq('public_token', token)
      .maybeSingle();
    if (!campaign || campaign.status !== 'open') return htmlResponse(200, closedPage(lang));

    const { data: org } = await db
      .from('organizations')
      .select('id, name, kind, deleted_at, stripe_connect_charges_enabled')
      .eq('id', campaign.organization_id)
      .maybeSingle();
    if (!org || org.deleted_at || org.kind !== 'sports_club') return htmlResponse(200, closedPage(lang));

    return htmlResponse(200, formPage({ token, org, campaign, lang }));
  };
}

exports.handler = makeHandler(defaultDb);
exports.makeHandler = makeHandler;
exports.formPage = formPage;
exports.closedPage = closedPage;
