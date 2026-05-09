// Toggle de idioma flotante (es/ca). Solo se muestra en /es/* y /ca/*.
// Al hacer click guarda cookie pp_lang (1 año) y navega al equivalente
// en el otro idioma preservando query string y hash.

(function () {
  'use strict';

  var path = location.pathname;
  var isEs = path.indexOf('/es/') === 0;
  var isCa = path.indexOf('/ca/') === 0;
  if (!isEs && !isCa) return;

  var current = isCa ? 'ca' : 'es';

  function targetPath(lang) {
    if (isEs) return '/' + lang + '/' + path.slice(4);
    if (isCa) return '/' + lang + '/' + path.slice(4);
    return '/' + lang + '/';
  }

  function switchTo(lang) {
    if (lang === current) return;
    document.cookie = 'pp_lang=' + lang + '; path=/; max-age=31536000; SameSite=Lax';
    location.href = targetPath(lang) + location.search + location.hash;
  }

  function inject() {
    if (document.getElementById('pp-lang-switch')) return;

    var wrap = document.createElement('div');
    wrap.id = 'pp-lang-switch';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', current === 'ca' ? 'Idioma' : 'Idioma');
    wrap.style.cssText = [
      'position:fixed', 'top:14px', 'right:14px', 'z-index:998',
      'display:inline-flex', 'background:#FFFFFF',
      'border:1px solid #E5E7EB', 'border-radius:999px',
      'font:600 11px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,.06)', 'overflow:hidden',
    ].join(';');

    function btn(label, lang) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', lang === 'ca' ? 'Català' : 'Español');
      var active = lang === current;
      b.style.cssText = [
        'border:0', 'padding:7px 12px',
        'background:' + (active ? '#0A1F44' : '#FFFFFF'),
        'color:' + (active ? '#FFFFFF' : '#6B7280'),
        'cursor:' + (active ? 'default' : 'pointer'),
        'transition:color .15s,background .15s',
        '-webkit-tap-highlight-color:transparent',
        'letter-spacing:0.04em',
      ].join(';');
      if (!active) {
        b.addEventListener('click', function () { switchTo(lang); });
        b.addEventListener('mouseenter', function () { b.style.color = '#0A1F44'; });
        b.addEventListener('mouseleave', function () { b.style.color = '#6B7280'; });
      }
      if (active) b.setAttribute('aria-current', 'true');
      return b;
    }

    wrap.appendChild(btn('ES', 'es'));
    wrap.appendChild(btn('CA', 'ca'));
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
