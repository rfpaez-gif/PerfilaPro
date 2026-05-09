// Detección de idioma en la raíz del sitio.
// Lee cookie pp_lang (si existe) o Accept-Language y redirige a /es/ o /ca/.
// Solo se ejecuta en `/` — el resto de paths los gestiona Netlify directamente.

export default async (request, context) => {
  const url = new URL(request.url);
  if (url.pathname !== '/') return context.next();

  // Solo aplica al dominio canónico perfilapro.es. Los demás hosts
  // (perfilapro.cat, perfilapro.com y sus www) tienen reglas de
  // redirect propias en netlify.toml que harán el hop de host + path
  // en un solo salto. Si esta función disparara aquí, añadiría /ca/ o
  // /es/ al path antes del host-swap y produciría un doble prefijo
  // (p.ej. perfilapro.cat/ → /ca/ → perfilapro.es/ca/ca/ → 404).
  const host = url.host.toLowerCase();
  if (host !== 'perfilapro.es' && host !== 'www.perfilapro.es') {
    return context.next();
  }

  const cookie = request.headers.get('cookie') || '';
  const cookieMatch = cookie.match(/(?:^|;\s*)pp_lang=(es|ca)(?:;|$)/);
  if (cookieMatch) {
    return Response.redirect(`${url.origin}/${cookieMatch[1]}/`, 302);
  }

  const accept = (request.headers.get('accept-language') || '').toLowerCase();
  const primary = accept.split(',')[0].trim();
  const target = /^ca(-|$)/.test(primary) ? 'ca' : 'es';

  return Response.redirect(`${url.origin}/${target}/`, 302);
};

export const config = {
  path: '/',
};
