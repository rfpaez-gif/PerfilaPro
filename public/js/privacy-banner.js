(function () {
  'use strict';

  var STORAGE_KEY = 'pp_privacy_ack';

  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch (_) { return; }

  function inject() {
    if (document.getElementById('pp-privacy-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'pp-privacy-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Aviso de privacidad');
    banner.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
      'max-width:560px', 'margin:0 auto',
      'background:#111', 'color:#fff', 'border-radius:12px',
      'padding:14px 16px', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
      'font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'display:flex', 'flex-wrap:wrap', 'gap:10px', 'align-items:center', 'justify-content:space-between',
    ].join(';');

    var text = document.createElement('span');
    text.style.flex = '1 1 280px';
    text.innerHTML = 'Usamos cookies técnicas y analítica propia anonimizada para que el servicio funcione. ' +
                     '<a href="/privacidad.html" style="color:#9bd4ff;text-decoration:underline">Más info</a>.';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Entendido';
    btn.style.cssText = [
      'background:#fff', 'color:#111', 'border:0', 'border-radius:999px',
      'padding:8px 16px', 'cursor:pointer', 'font-weight:600', 'flex:0 0 auto',
    ].join(';');
    btn.addEventListener('click', function () {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
      banner.remove();
    });

    banner.appendChild(text);
    banner.appendChild(btn);
    document.body.appendChild(banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
