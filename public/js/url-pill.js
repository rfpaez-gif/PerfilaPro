/* ============================================================
   PerfilaPro · UrlPill · copy-to-clipboard handler
   Inicialización automática en DOMContentLoaded.
   Re-llamable manualmente vía window.ppInitUrlPills() para
   contenido inyectado dinámicamente.
   ============================================================ */
(function () {
  'use strict';

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  function bind(btn) {
    if (btn.dataset.ppCopyBound === '1') return;
    btn.dataset.ppCopyBound = '1';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var url = btn.getAttribute('data-pp-copy');
      if (!url) return;

      var original = btn.textContent;
      copyToClipboard(url)
        .then(function () {
          btn.textContent = 'Copiado';
          btn.setAttribute('data-pp-copied', '1');
        })
        .catch(function () {
          btn.textContent = 'Error';
        })
        .then(function () {
          setTimeout(function () {
            btn.textContent = original;
            btn.removeAttribute('data-pp-copied');
          }, 1500);
        });
    });
  }

  function init() {
    var nodes = document.querySelectorAll('.pp-url-pill__copy[data-pp-copy]');
    for (var i = 0; i < nodes.length; i++) bind(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ppInitUrlPills = init;
})();
