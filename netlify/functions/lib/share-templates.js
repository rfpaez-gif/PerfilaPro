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

// Hex literales (Satori no soporta CSS vars). Sincronizado con
// /styles/tokens-color.css. Sistema general (Tinta + Verde Match
// sobre Crema), no se usa el especial Teal Documentos aquí.
const COLORS = {
  bg:        '#FAF7F0',  // --color-crema
  surface:   '#FFFFFF',
  ink:       '#0A1F44',  // --color-tinta
  inkSoft:   '#6B7280',  // --color-gris-500
  accent:    '#00C277',  // --color-verde-match
  accentDeep:'#00A865',  // --color-verde-dark
  accentSoft:'#E6F9F0',  // --color-verde-light
  border:    '#E5E7EB',  // --color-gris-200
};

const TEMPLATES = {
  og:       { width: 1200, height: 630,  layout: 'horizontal' },
  square:   { width: 1080, height: 1080, layout: 'vertical'   },
  story:    { width: 1080, height: 1920, layout: 'vertical'   },
  linkedin: { width: 1200, height: 627,  layout: 'horizontal' },
};

// Avatar cuadrado (radius 24) en lugar de circular. El recorte cuadrado
// preserva contexto (camión detrás de Antonio, pared del escaparate de
// Natalia, mesa de trabajo de Carlos) y deja el rostro como protagonista
// sin amputar hombros. La esquina ligeramente redondeada conserva tono
// suave sin parecer carnet.
function avatarNode({ fotoUrl, nombre, size, radius = 24 }) {
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
          borderRadius: radius,
          objectFit: 'cover',
        },
      },
    };
  }
  return {
    type: 'div',
    props: {
      style: {
        width: size, height: size,
        borderRadius: radius,
        background: COLORS.accent,
        color: COLORS.surface,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        fontWeight: 700,
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
  // Avatar cuadrado al 70% de la altura (era 45% circular) — el rostro pasa
  // a ser el bloque dominante del frame en formatos OG/LinkedIn sin asfixiar
  // la columna de texto (1200-padding-avatar deja ≈600px para nombre+tagline).
  const avatarSize = Math.round(height * 0.70);
  return {
    type: 'div',
    props: {
      style: {
        width, height,
        display: 'flex',
        flexDirection: 'row',
        background: COLORS.bg,
        padding: 56,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', paddingRight: 48 },
            children: avatarNode({ fotoUrl: card.foto_url, nombre: card.nombre, size: avatarSize, radius: 20 }),
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
  // Avatar cuadrado al 62% del ancho (era 42% circular). En 1080×1080 = 670px
  // y en 1080×1920 = 670px. El recorte cuadrado deja el contexto del entorno
  // profesional intacto y el rostro domina el frame. Las tipografías bajan
  // (72→60, 36→32, 28→24) para acomodar el avatar más grande sin desbordar
  // el formato cuadrado.
  const avatarSize = Math.round(width * 0.62);
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
        padding: 60,
        fontFamily: 'Inter',
      },
      children: [
        brandStrip({ fontSize: 28 }),
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 },
            children: [
              avatarNode({ fotoUrl: card.foto_url, nombre: card.nombre, size: avatarSize, radius: 32 }),
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: 60, fontWeight: 700, color: COLORS.ink, textAlign: 'center', lineHeight: 1.05 },
                        children: card.nombre || '',
                      },
                    },
                    card.tagline ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 32, color: COLORS.inkSoft, textAlign: 'center', lineHeight: 1.3 },
                        children: card.tagline,
                      },
                    } : null,
                    card.zona ? {
                      type: 'div',
                      props: {
                        style: { fontSize: 24, color: COLORS.accentDeep, fontWeight: 600 },
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
