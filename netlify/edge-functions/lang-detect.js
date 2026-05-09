// Detección de idioma en la raíz del sitio.
// Lee cookie pp_lang (si existe) o Accept-Language y redirige a /es/ o /ca/.
// Solo se ejecuta en `/` — el resto de paths los gestiona Netlify directamente.

export default async (request, context) => {
  const url = new URL(request.url);
  if (url.pathname !== '/') return context.next();

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
