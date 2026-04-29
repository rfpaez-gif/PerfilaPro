/* PerfilaPro — Dark / light mode toggle
   Reads system preference on first load.
   Toggled by any [data-theme-toggle] element.
   No localStorage (blocked in Netlify sandbox). */
(function () {
  var root = document.documentElement;
  var pref = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', pref);

  var ICONS = {
    dark:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  };

  function syncButtons(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.innerHTML = theme === 'dark' ? ICONS.dark : ICONS.light;
      btn.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    });
  }

  function toggle() {
    pref = pref === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', pref);
    syncButtons(pref);
  }

  /* Wire up any toggle buttons already in the DOM */
  function wireButtons() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.removeEventListener('click', toggle);
      btn.addEventListener('click', toggle);
    });
    syncButtons(pref);
  }

  /* Run after DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }
})();
