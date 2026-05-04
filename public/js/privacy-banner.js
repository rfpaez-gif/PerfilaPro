(function () {
  'use strict';

  // Estado del consentimiento. Compat con versión anterior:
  //   '1'         (legacy informativo)         -> tratado como 'accepted'
  //   'accepted'  el usuario acepta analytics
  //   'rejected'  el usuario rechaza analytics
  //   null/undef  no ha decidido todavia: mostramos banner
  var STORAGE_KEY = 'pp_privacy_ack';

  function getConsent() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === '1') return 'accepted';
      return v;
    } catch (_) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
  }

  // Notifica a la pagina que el usuario ha consentido. La pagina puede
  // definir `window.ppLoadAnalytics` para cargar PostHog u otros tras consent.
  function fireAnalyticsLoad() {
    if (typeof window.ppLoadAnalytics === 'function') {
      try { window.ppLoadAnalytics(); } catch (_) {}
    }
  }

  // Si ya hay consentimiento previo y es "accepted", carga analytics
  // de inmediato sin mostrar banner.
  var current = getConsent();
  if (current === 'accepted') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireAnalyticsLoad);
    } else {
      fireAnalyticsLoad();
    }
    return;
  }
  if (current === 'rejected') {
    // Decision tomada, no molestamos al usuario y no cargamos analytics.
    return;
  }

  function inject() {
    if (document.getElementById('pp-privacy-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'pp-privacy-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de privacidad');
    banner.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
      'max-width:620px', 'margin:0 auto',
      'background:#111', 'color:#fff', 'border-radius:12px',
      'padding:14px 16px', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
      'font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'display:flex', 'flex-wrap:wrap', 'gap:10px', 'align-items:center', 'justify-content:space-between',
    ].join(';');

    var text = document.createElement('span');
    text.style.flex = '1 1 280px';
    text.innerHTML =
      'Usamos cookies tecnicas necesarias para que el servicio funcione, ' +
      'y cookies de analitica para entender como se usa la web (anonimizadas, sin perfilado publicitario). ' +
      '<a href="/privacidad.html" style="color:#9bd4ff;text-decoration:underline">Mas info</a>.';

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex:0 0 auto';

    var btnReject = document.createElement('button');
    btnReject.type = 'button';
    btnReject.textContent = 'Rechazar';
    btnReject.style.cssText = [
      'background:transparent', 'color:#fff', 'border:1px solid rgba(255,255,255,.4)',
      'border-radius:999px', 'padding:8px 16px', 'cursor:pointer',
    ].join(';');
    btnReject.addEventListener('click', function () {
      setConsent('rejected');
      banner.remove();
    });

    var btnAccept = document.createElement('button');
    btnAccept.type = 'button';
    btnAccept.textContent = 'Aceptar';
    btnAccept.style.cssText = [
      'background:#fff', 'color:#111', 'border:0', 'border-radius:999px',
      'padding:8px 16px', 'cursor:pointer', 'font-weight:600',
    ].join(';');
    btnAccept.addEventListener('click', function () {
      setConsent('accepted');
      banner.remove();
      fireAnalyticsLoad();
    });

    btns.appendChild(btnReject);
    btns.appendChild(btnAccept);
    banner.appendChild(text);
    banner.appendChild(btns);
    document.body.appendChild(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
