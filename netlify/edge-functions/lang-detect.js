// Detección de idioma en la raíz del sitio.
// Lee cookie pp_lang (si existe) o Accept-Language y redirige a /es/ o /ca/.
// Solo se ejecuta en `/` — el resto de paths los gestiona Netlify directamente.

export default async (request, context) => {
  const url = new URL(request.url);
  if (url.pathname !== '/') return context.next();

  // Aplica al dominio canónico perfilapro.es y a los hosts de deploy
  // preview (*.netlify.app). El resto (perfilapro.cat, perfilapro.com
  // y sus www) tienen reglas de redirect propias en netlify.toml que
  // hacen el hop de host + path en un solo salto. Si esta función
  // disparara ahí añadiría /ca/ o /es/ al path antes del host-swap y
  // produciría un doble prefijo (perfilapro.cat/ → /ca/ →
  // perfilapro.es/ca/ca/ → 404). Los previews sí necesitan detección
  // porque sirven public/ directamente y no hay index.html en la raíz.
  const host = url.host.toLowerCase();
  const isCanonical = host === 'perfilapro.es' || host === 'www.perfilapro.es';
  const isNetlifyPreview = host.endsWith('.netlify.app');
  if (!isCanonical && !isNetlifyPreview) {
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
