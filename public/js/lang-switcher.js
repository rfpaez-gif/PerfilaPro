// Toggle de idioma (es/ca). Solo en /es/* y /ca/*.
// Estrategia de inserción:
//   1. Si existe .pp-nav__actions → entra como primer hijo (a la izquierda del CTA verde)
//   2. Si solo existe .pp-nav      → se añade al final (a la derecha del logo)
//   3. Fallback                    → flotante fixed top-right
// Click → setea cookie pp_lang (1 año) y navega al equivalente preservando query+hash.

(function () {
  'use strict';

  var path = location.pathname;
  var isEs = path.indexOf('/es/') === 0;
  var isCa = path.indexOf('/ca/') === 0;
  if (!isEs && !isCa) return;

  var current = isCa ? 'ca' : 'es';

  function targetPath(lang) {
    return '/' + lang + '/' + path.slice(4);
  }

  function switchTo(lang) {
    if (lang === current) return;
    document.cookie = 'pp_lang=' + lang + '; path=/; max-age=31536000; SameSite=Lax';
    location.href = targetPath(lang) + location.search + location.hash;
  }

  function buildSwitch(mode) {
    // mode: 'inline' (dentro de la nav) | 'float' (esquina fixed)
    var wrap = document.createElement('div');
    wrap.id = 'pp-lang-switch';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Idioma');

    var base = [
      'display:inline-flex', 'background:#FFFFFF',
      'border:1px solid #E5E7EB', 'border-radius:999px',
      'font:600 11px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'overflow:hidden', 'flex-shrink:0',
    ];
    if (mode === 'float') {
      base = base.concat([
        'position:fixed', 'top:14px', 'right:14px', 'z-index:998',
        'box-shadow:0 2px 8px rgba(0,0,0,.06)',
      ]);
    } else {
      base = base.concat(['margin-right:8px', 'align-self:center']);
    }
    wrap.style.cssText = base.join(';');

    function btn(label, lang) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', lang === 'ca' ? 'Català' : 'Español');
      var active = lang === current;
      b.style.cssText = [
        'border:0', 'padding:7px 11px',
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
      } else {
        b.setAttribute('aria-current', 'true');
      }
      return b;
    }
    wrap.appendChild(btn('ES', 'es'));
    wrap.appendChild(btn('CA', 'ca'));
    return wrap;
  }

  function inject() {
    if (document.getElementById('pp-lang-switch')) return;

    var actions = document.querySelector('.pp-nav__actions');
    if (actions) {
      actions.insertBefore(buildSwitch('inline'), actions.firstChild);
      return;
    }
    var nav = document.querySelector('.pp-nav');
    if (nav) {
      var sw = buildSwitch('inline');
      sw.style.marginLeft = 'auto'; // empuja el toggle a la derecha del logo
      sw.style.marginRight = '0';
      nav.appendChild(sw);
      return;
    }
    document.body.appendChild(buildSwitch('float'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
