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

// Strings de la página, es/ca. Mismo patrón que los emails del repo
// (*_STRINGS). Esta es la ÚNICA pantalla que ven las familias: la ruta
// /ca/inscripcion ya marcaba <html lang="ca"> y formateaba las fechas en
// catalán, pero el copy estaba en castellano a fuego.
const PAGE_STRINGS = {
  es: {
    closedTitle: 'Inscripciones cerradas',
    closedBody: 'Este enlace de inscripción no está activo. Si crees que es un error, contacta con tu club.',
    planTitle: 'Plan de pagos de la temporada',
    planTotal: 'Total temporada',
    planNote: 'El club te indicará cómo abonar cada pago en su fecha (Bizum, efectivo o transferencia).',
    matricula: 'Matrícula (pago único)',
    monthly: 'Cuota mensual',
    months: 'meses',
    payOnline: 'Pagar online',
    payOnlineNote: '— domiciliación SEPA o tarjeta. Cómodo y automático.',
    payClubAlt: 'Lo gestiono con el club',
    payClubAltNote: '— Bizum, efectivo o transferencia.',
    payClubOnly: 'Pago al club',
    payClubOnlyNote: '— el club te indicará cómo abonar cada concepto en su fecha.',
    pageTitle: 'Inscripción de temporada',
    titlePrefix: 'Inscripción · ',
    sectPlayer: 'El/la deportista',
    fullName: 'Nombre y apellidos',
    birthDate: 'Fecha de nacimiento',
    genderLabel: 'Sexo',
    optional: 'opcional',
    genderM: 'Masculino', genderF: 'Femenino', genderX: 'Otro',
    docKind: 'Documento',
    docDni: 'DNI', docNie: 'NIE', docPass: 'Pasaporte', docBook: 'Libro de familia',
    docNumber: 'Nº documento',
    sectTutor: 'Tutor/a legal',
    tutorName: 'Nombre completo',
    tutorEmail: 'Email',
    tutorPhone: 'Teléfono',
    tutorDni: 'DNI del tutor/a',
    sectConsent: 'Consentimientos',
    consentData: 'Autorizo el tratamiento de los datos del menor para la gestión deportiva del club. (Obligatorio)',
    consentImage: 'Cedo los derechos de imagen para la ficha digital y el carnet del jugador/a. (Opcional)',
    photoLabel: 'Foto del jugador/a',
    photoNote: 'para el carnet',
    sectPay: 'Pago',
    submit: 'Inscribir →',
    foot: 'PerfilaPro · La ficha del menor no es pública hasta que tú lo autorices.',
    jsPhotoTooBig: 'La foto supera el máximo de 2 MB.',
    jsSending: 'Enviando…',
    jsGenericError: 'No se pudo completar la inscripción',
    jsOkTitle: '¡Inscripción recibida!',
    jsOkBody: 'Te hemos enviado un email para acceder a tu panel y completar la ficha.',
  },
  ca: {
    closedTitle: 'Inscripcions tancades',
    closedBody: 'Aquest enllaç d\'inscripció no està actiu. Si creus que és un error, contacta amb el teu club.',
    planTitle: 'Pla de pagaments de la temporada',
    planTotal: 'Total temporada',
    planNote: 'El club t\'indicarà com abonar cada pagament en la seva data (Bizum, efectiu o transferència).',
    matricula: 'Matrícula (pagament únic)',
    monthly: 'Quota mensual',
    months: 'mesos',
    payOnline: 'Pagar en línia',
    payOnlineNote: '— domiciliació SEPA o targeta. Còmode i automàtic.',
    payClubAlt: 'Ho gestiono amb el club',
    payClubAltNote: '— Bizum, efectiu o transferència.',
    payClubOnly: 'Pagament al club',
    payClubOnlyNote: '— el club t\'indicarà com abonar cada concepte en la seva data.',
    pageTitle: 'Inscripció de temporada',
    titlePrefix: 'Inscripció · ',
    sectPlayer: 'L\'esportista',
    fullName: 'Nom i cognoms',
    birthDate: 'Data de naixement',
    genderLabel: 'Sexe',
    optional: 'opcional',
    genderM: 'Masculí', genderF: 'Femení', genderX: 'Altre',
    docKind: 'Document',
    docDni: 'DNI', docNie: 'NIE', docPass: 'Passaport', docBook: 'Llibre de família',
    docNumber: 'Núm. document',
    sectTutor: 'Tutor/a legal',
    tutorName: 'Nom complet',
    tutorEmail: 'Correu electrònic',
    tutorPhone: 'Telèfon',
    tutorDni: 'DNI del tutor/a',
    sectConsent: 'Consentiments',
    consentData: 'Autoritzo el tractament de les dades del menor per a la gestió esportiva del club. (Obligatori)',
    consentImage: 'Cedeixo els drets d\'imatge per a la fitxa digital i el carnet del jugador/a. (Opcional)',
    photoLabel: 'Foto del jugador/a',
    photoNote: 'per al carnet',
    sectPay: 'Pagament',
    submit: 'Inscriure →',
    foot: 'PerfilaPro · La fitxa del menor no és pública fins que tu ho autoritzis.',
    jsPhotoTooBig: 'La foto supera el màxim de 2 MB.',
    jsSending: 'Enviant…',
    jsGenericError: 'No s\'ha pogut completar la inscripció',
    jsOkTitle: 'Inscripció rebuda!',
    jsOkBody: 'T\'hem enviat un correu per accedir al teu tauler i completar la fitxa.',
  },
};
function strings(lang) { return PAGE_STRINGS[lang] || PAGE_STRINGS.es; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eur(cents, lang = 'es') {
  if (cents == null) return null;
  return (cents / 100).toLocaleString(lang === 'ca' ? 'ca-ES' : 'es-ES', { style: 'currency', currency: 'EUR' });
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
  const T = strings(lang);
  const inner = `<div class="card ok-box">
    <p class="big">📋</p>
    <h1>${esc(T.closedTitle)}</h1>
    <p class="sub">${esc(T.closedBody)}</p>
  </div>`;
  return shell(T.closedTitle, inner, lang);
}

function formPage({ token, org, campaign, lang = 'es' }) {
  // Plan de pagos a medida (conceptos con fecha) tiene prioridad sobre el
  // modelo matrícula+cuota cuando el club lo ha diseñado.
  const T = strings(lang);
  const plan = readPlan(campaign.concepts_jsonb);
  const hasPlan = plan.length > 0;

  let amountsBlock = '';
  if (hasPlan) {
    const rows = plan.map(c =>
      `<div class="plan-row"><span>${esc(c.concepto)} <small>${esc(fmtDate(c.due_date, lang))}</small></span><strong>${eur(c.amount_cents, lang)}</strong></div>`
    ).join('');
    const total = eur(planTotalCents(plan), lang);
    amountsBlock = `<div class="amounts">
      <div class="plan-title">${esc(T.planTitle)}</div>
      ${rows}
      <div class="plan-total"><span>${esc(T.planTotal)}</span><strong>${total}</strong></div>
      <div class="plan-note">${esc(T.planNote)}</div>
    </div>`;
  } else {
    const matricula = eur(campaign.matricula_cents, lang);
    const fee = eur(campaign.monthly_fee_cents, lang);
    const inst = campaign.num_installments || 9;
    const amountsLines = [];
    if (matricula) amountsLines.push(`<div>${esc(T.matricula)}: <strong>${matricula}</strong></div>`);
    if (fee) amountsLines.push(`<div>${esc(T.monthly)}: <strong>${fee}</strong> × ${inst} ${esc(T.months)}</div>`);
    amountsBlock = amountsLines.length ? `<div class="amounts">${amountsLines.join('')}</div>` : '';
  }

  // Pago online (SEPA/tarjeta) solo si el club tiene Stripe Connect activo.
  // Con plan a medida y club conectado, cobramos el plan por Stripe (lo que
  // vence ya + mandato para los plazos). Sin Connect, el plan se cobra al
  // club (manual). El modelo matrícula+cuota mantiene su comportamiento.
  const canPayOnline = !!org.stripe_connect_charges_enabled;
  const onlineOpt = `<label class="pay"><input type="radio" name="payment_choice" value="online" checked>
        <span><strong>${esc(T.payOnline)}</strong> ${esc(T.payOnlineNote)}</span></label>`;
  const clubOptAlt = `<label class="pay"><input type="radio" name="payment_choice" value="club">
        <span><strong>${esc(T.payClubAlt)}</strong> ${esc(T.payClubAltNote)}</span></label>`;
  const clubOptOnly = `<label class="pay"><input type="radio" name="payment_choice" value="club" checked>
        <span><strong>${esc(T.payClubOnly)}</strong> ${esc(T.payClubOnlyNote)}</span></label>`;
  let payOptions;
  if (hasPlan) {
    payOptions = canPayOnline ? (onlineOpt + clubOptAlt) : clubOptOnly;
  } else {
    payOptions = onlineOpt + clubOptAlt;
  }

  const inner = `
  <div class="card">
    <h1>${esc(T.pageTitle)}</h1>
    <p class="sub"><span class="club">${esc(org.name)}</span> · ${esc(campaign.season)}</p>
  </div>
  <form id="enrForm" class="card" autocomplete="on">
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">

    <div class="sect">${esc(T.sectPlayer)}</div>
    <label for="nombre">${esc(T.fullName)}</label>
    <input id="nombre" name="nombre" type="text" required maxlength="100">
    <div class="row2">
      <div><label for="birth_date">${esc(T.birthDate)}</label><input id="birth_date" name="birth_date" type="date" required></div>
      <div><label for="gender">${esc(T.genderLabel)} <small>${esc(T.optional)}</small></label>
        <select id="gender" name="gender"><option value="">—</option><option value="M">${esc(T.genderM)}</option><option value="F">${esc(T.genderF)}</option><option value="X">${esc(T.genderX)}</option></select></div>
    </div>
    <div class="row2">
      <div><label for="doc_kind">${esc(T.docKind)} <small>${esc(T.optional)}</small></label>
        <select id="doc_kind" name="doc_kind"><option value="">—</option><option value="dni">${esc(T.docDni)}</option><option value="nie">${esc(T.docNie)}</option><option value="pasaporte">${esc(T.docPass)}</option><option value="libro_familia">${esc(T.docBook)}</option></select></div>
      <div><label for="doc_number">${esc(T.docNumber)} <small>${esc(T.optional)}</small></label><input id="doc_number" name="doc_number" type="text" maxlength="40"></div>
    </div>

    <div class="sect">${esc(T.sectTutor)}</div>
    <label for="tutor_legal_name">${esc(T.tutorName)}</label>
    <input id="tutor_legal_name" name="tutor_legal_name" type="text" required maxlength="100">
    <div class="row2">
      <div><label for="tutor_legal_email">${esc(T.tutorEmail)}</label><input id="tutor_legal_email" name="tutor_legal_email" type="email" required autocapitalize="off"></div>
      <div><label for="tutor_legal_phone">${esc(T.tutorPhone)} <small>${esc(T.optional)}</small></label><input id="tutor_legal_phone" name="tutor_legal_phone" type="tel"></div>
    </div>
    <label for="tutor_legal_dni">${esc(T.tutorDni)} <small>${esc(T.optional)}</small></label>
    <input id="tutor_legal_dni" name="tutor_legal_dni" type="text" maxlength="20">

    <div class="sect">${esc(T.sectConsent)}</div>
    <label class="check"><input type="checkbox" id="consent_data" name="consent_data" required>
      <span>${esc(T.consentData)}</span></label>
    <label class="check"><input type="checkbox" id="consent_image" name="consent_image">
      <span>${esc(T.consentImage)}</span></label>
    <div id="photoBlock" style="display:none;margin-top:.6rem">
      <label for="player_photo">${esc(T.photoLabel)} <small>${esc(T.photoNote)}</small></label>
      <input id="player_photo" name="player_photo" type="file" accept="image/png,image/jpeg,image/webp">
      <img id="photoPreview" alt="" style="display:none;max-width:90px;border-radius:8px;margin-top:.5rem">
    </div>

    <div class="sect">${esc(T.sectPay)}</div>
    ${amountsBlock}
    ${payOptions}

    <button type="submit" class="btn" id="submitBtn">${esc(T.submit)}</button>
    <p class="err" id="enrErr"></p>
  </form>
  <p class="foot">${esc(T.foot)}</p>

  <script>
  (function(){
    var TOKEN = ${JSON.stringify(token)};
    var S = ${JSON.stringify({
      photoTooBig: T.jsPhotoTooBig, sending: T.jsSending, genericError: T.jsGenericError,
      okTitle: T.jsOkTitle, okBody: T.jsOkBody, submit: T.submit,
    })};
    var form = document.getElementById('enrForm');
    var btn = document.getElementById('submitBtn');
    var err = document.getElementById('enrErr');

    // Foto del carnet: solo visible al ceder derechos de imagen. Se sube en
    // el mismo acto que el consentimiento (se manda en base64 con el submit).
    var photoData = null;
    var photoBlock = document.getElementById('photoBlock');
    var fileInput = document.getElementById('player_photo');
    var preview = document.getElementById('photoPreview');
    form.consent_image.addEventListener('change', function(){
      photoBlock.style.display = form.consent_image.checked ? 'block' : 'none';
      if (!form.consent_image.checked) { photoData = null; fileInput.value = ''; preview.style.display = 'none'; }
    });
    fileInput.addEventListener('change', function(){
      photoData = null; preview.style.display = 'none'; err.textContent = '';
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 2*1024*1024) { err.textContent = S.photoTooBig; fileInput.value = ''; return; }
      var reader = new FileReader();
      reader.onload = function(){
        var res = reader.result || '';
        var comma = res.indexOf(',');
        photoData = { base64: comma >= 0 ? res.slice(comma+1) : res, contentType: f.type };
        preview.src = res; preview.style.display = 'block';
      };
      reader.readAsDataURL(f);
    });

    form.addEventListener('submit', async function(e){
      e.preventDefault();
      err.textContent = '';
      var fd = new FormData(form);
      var payload = { token: TOKEN, idioma: ${JSON.stringify(lang)} };
      fd.forEach(function(v,k){ if (v instanceof File) return; payload[k] = v; });
      payload.consent_data = form.consent_data.checked;
      payload.consent_image = form.consent_image.checked;
      if (form.consent_image.checked && photoData) {
        payload.photo_base64 = photoData.base64;
        payload.photo_content_type = photoData.contentType;
      }
      btn.disabled = true; btn.textContent = S.sending;
      try {
        var r = await fetch('/api/enrollment-submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        var data = await r.json();
        if (!r.ok) { throw new Error(data.error || S.genericError); }
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
          '<div class="card ok-box"><p class="big">✅</p><h1>'+S.okTitle+'</h1>'+
          '<p class="sub">'+S.okBody+'</p></div>';
      } catch(ex) {
        err.textContent = ex.message;
        btn.disabled = false; btn.textContent = S.submit;
      }
    });
  })();
  </script>`;
  return shell(T.titlePrefix + org.name, inner, lang);
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
