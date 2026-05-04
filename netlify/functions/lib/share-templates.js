// Plantillas Satori para imágenes generadas server-side.
//
// Satori acepta un árbol "react element-like" sin necesitar React: cada nodo
// es { type: 'div'|'img'|..., props: { style, children } }. Usamos esa forma
// directa para evitar el peso de añadir react/jsx solo para esto.
//
// Cuatro formatos:
// - og        1200×630   meta og:image / twitter:image (compartidos en redes)
// - square    1080×1080  post Instagram/Facebook
// - story     1080×1920  Instagram/Facebook story
// - linkedin  1200×627   post LinkedIn

const COLORS = {
  bg:        '#FAF3E6',
  surface:   '#FFFFFF',
  ink:       '#1E1B14',
  inkSoft:   '#5C5246',
  accent:    '#01696F',
  accentDeep:'#024A4F',
  accentSoft:'#E5F0F1',
  border:    '#E8DDC9',
};

const TEMPLATES = {
  og:       { width: 1200, height: 630,  layout: 'horizontal' },
  square:   { width: 1080, height: 1080, layout: 'vertical'   },
  story:    { width: 1080, height: 1920, layout: 'vertical'   },
  linkedin: { width: 1200, height: 627,  layout: 'horizontal' },
};

function avatarNode({ fotoUrl, nombre, size }) {
  const initial = (nombre || '?').trim().charAt(0).toUpperCase();
  if (fotoUrl) {
    return {
      type: 'img',
      props: {
        src: fotoUrl,
        width: size,
        height: size,
        style: {
          width: size, height: size,
          borderRadius: size / 2,
          objectFit: 'cover',
          border: `4px solid ${COLORS.surface}`,
        },
      },
    };
  }
  return {
    type: 'div',
    props: {
      style: {
        width: size, height: size,
        borderRadius: size / 2,
        background: COLORS.accent,
        color: COLORS.surface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        fontWeight: 700,
        border: `4px solid ${COLORS.surface}`,
      },
      children: initial,
    },
  };
}

function brandStrip({ fontSize = 22 } = {}) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: COLORS.accent,
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.05em',
      },
      children: [
        { type: 'span', props: { children: '✦' } },
        { type: 'span', props: { children: 'PerfilaPro' } },
      ],
    },
  };
}

function horizontalLayout({ width, height, card, siteUrl }) {
  const avatarSize = Math.round(height * 0.45);
  return {
    type: 'div',
    props: {
      style: {
        width, height,
        display: 'flex',
        flexDirection: 'row',
        background: COLORS.bg,
        padding: 64,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', paddingRight: 56 },
            children: avatarNode({ fotoUrl: card.foto_url, nombre: card.nombre, size: avatarSize }),
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', paddingTop: 16, paddingBottom: 16 },
            children: [
              brandStrip({ fontSize: 22 }),
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', gap: 12 },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: 60, fontWeight: 700, color: COLORS.ink, lineHeight: 1.05 },
                        children: card.nombre || '',
                      },
                    },
                    card.tagline ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 30, color: COLORS.inkSoft, lineHeight: 1.3 },
                        children: card.tagline,
                      },
                    } : null,
                    card.zona ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 22, color: COLORS.accentDeep, fontWeight: 600 },
                        children: '📍 ' + card.zona,
                      },
                    } : null,
                  ].filter(Boolean),
                },
              },
              {
                type: 'div',
                props: {
                  style: { fontSize: 20, color: COLORS.inkSoft },
                  children: `${siteUrl.replace(/^https?:\/\//, '')}/c/${card.slug}`,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function verticalLayout({ width, height, card, siteUrl }) {
  const avatarSize = Math.round(width * 0.42);
  return {
    type: 'div',
    props: {
      style: {
        width, height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: COLORS.bg,
        padding: 80,
        fontFamily: 'Inter',
      },
      children: [
        brandStrip({ fontSize: 28 }),
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 },
            children: [
              avatarNode({ fotoUrl: card.foto_url, nombre: card.nombre, size: avatarSize }),
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: 72, fontWeight: 700, color: COLORS.ink, textAlign: 'center', lineHeight: 1.05 },
                        children: card.nombre || '',
                      },
                    },
                    card.tagline ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 36, color: COLORS.inkSoft, textAlign: 'center', lineHeight: 1.3 },
                        children: card.tagline,
                      },
                    } : null,
                    card.zona ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 28, color: COLORS.accentDeep, fontWeight: 600 },
                        children: '📍 ' + card.zona,
                      },
                    } : null,
                  ].filter(Boolean),
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              padding: '20px 40px',
              background: COLORS.accent,
              color: COLORS.surface,
              fontSize: 28,
              fontWeight: 700,
              borderRadius: 100,
              letterSpacing: '0.03em',
            },
            children: `${siteUrl.replace(/^https?:\/\//, '')}/c/${card.slug}`,
          },
        },
      ],
    },
  };
}

function buildTemplate(name, { card, siteUrl }) {
  const config = TEMPLATES[name];
  if (!config) throw new Error(`Plantilla desconocida: ${name}`);
  const args = { width: config.width, height: config.height, card, siteUrl };
  return config.layout === 'vertical' ? verticalLayout(args) : horizontalLayout(args);
}

module.exports = { TEMPLATES, COLORS, buildTemplate };
