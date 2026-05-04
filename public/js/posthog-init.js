(function () {
  'use strict';

  // Define una funcion global ppLoadAnalytics que privacy-banner.js
  // dispara cuando el usuario acepta cookies. Si no hay consent o
  // POSTHOG_API_KEY no esta configurada, no se carga PostHog ni se
  // emiten eventos (no-op silencioso).
  //
  // Tras carga, expone:
  //   window.ppEvent(name, props)        emite un evento custom
  //   window.ppIdentify(id, traits)      identifica al usuario
  //   window.ppReset()                   limpia identificacion
  //
  // Estas helpers son siempre seguras de llamar: si PostHog no esta
  // cargado (consent rejected o key no configurada), hacen no-op.

  var loaded = false;

  function loadPostHog(key, host) {
    if (loaded) return;
    loaded = true;

    // Snippet oficial PostHog (https://posthog.com/docs/libraries/js)
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

    posthog.init(key, {
      api_host:               host,
      capture_pageview:       true,
      capture_pageleave:      true,
      persistence:            'localStorage+cookie',
      autocapture:            true,
      disable_session_recording: true, // privacidad: no grabamos sesiones
    });
  }

  // Carga config desde el backend (clave publica de PostHog viene de env var
  // del servidor para evitar hardcodearla en cada HTML).
  window.ppLoadAnalytics = async function () {
    try {
      var res = await fetch('/api/analytics-config', { credentials: 'omit' });
      if (!res.ok) return;
      var cfg = await res.json();
      if (!cfg || !cfg.posthog || !cfg.posthog.key) return; // analitica deshabilitada
      loadPostHog(cfg.posthog.key, cfg.posthog.host);
    } catch (_) {
      // network error o navegador sin fetch: silencioso
    }
  };

  // Helpers que siempre son seguros de llamar
  window.ppEvent = function (name, props) {
    if (typeof posthog !== 'undefined' && posthog && typeof posthog.capture === 'function') {
      try { posthog.capture(name, props || {}); } catch (_) {}
    }
  };

  window.ppIdentify = function (id, traits) {
    if (typeof posthog !== 'undefined' && posthog && typeof posthog.identify === 'function') {
      try { posthog.identify(id, traits || {}); } catch (_) {}
    }
  };

  window.ppReset = function () {
    if (typeof posthog !== 'undefined' && posthog && typeof posthog.reset === 'function') {
      try { posthog.reset(); } catch (_) {}
    }
  };
})();
