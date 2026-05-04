// Plantillas y mapeos para el asistente Google Business Profile.
// Todo determinístico, sin LLM: el usuario edita lo que quiera antes de
// pegar en GBP.

// Mapeo sector PerfilaPro → categorías Google Business Profile (en español
// porque Google las acepta en el idioma del business). Damos 2-3 sugerencias
// por sector y el usuario elige; las primeras son las más usadas.
const GBP_CATEGORIES = {
  oficios:    ['Fontanero', 'Electricista', 'Manitas (servicio de reparación)', 'Cerrajero', 'Reparación de electrodomésticos'],
  salud:      ['Fisioterapeuta', 'Psicólogo', 'Quiropráctico', 'Nutricionista', 'Podólogo'],
  educacion:  ['Profesor particular', 'Academia', 'Escuela de idiomas', 'Centro de formación'],
  comercial:  ['Asesor comercial', 'Agente inmobiliario', 'Agente de seguros'],
  belleza:    ['Peluquería', 'Centro de estética', 'Manicura', 'Barbería', 'Centro de depilación'],
  reforma:    ['Empresa de construcción', 'Pintor', 'Carpintero', 'Albañil', 'Reformas integrales'],
  hosteleria: ['Restaurante', 'Cafetería', 'Bar', 'Catering', 'Pastelería'],
  tech:       ['Servicio de reparación de ordenadores', 'Empresa de software', 'Consultor informático', 'Diseñador web'],
  legal:      ['Abogado', 'Asesoría fiscal', 'Gestoría', 'Notario', 'Asesor laboral'],
  jardineria: ['Servicio de jardinería', 'Paisajista', 'Empresa de podas'],
  transporte: ['Empresa de mudanzas', 'Servicio de transporte', 'Taxi', 'Mensajería'],
  fotografia: ['Fotógrafo', 'Videógrafo', 'Estudio fotográfico'],
  eventos:    ['Organizador de eventos', 'Wedding planner', 'DJ', 'Animador infantil'],
  automocion: ['Taller mecánico', 'Mecánico', 'Chapa y pintura', 'ITV'],
  seguridad:  ['Empresa de seguridad', 'Cerrajero (urgencias)', 'Instalador de alarmas'],
  cuidados:   ['Servicio de cuidados a domicilio', 'Cuidador de personas mayores', 'Niñera'],
  fitness:    ['Entrenador personal', 'Gimnasio', 'Estudio de pilates', 'Estudio de yoga'],
  turismo:    ['Agencia de viajes', 'Guía turístico'],
  comercio:   ['Tienda local', 'Comercio especializado'],
  otro:       ['Servicio profesional'],
};

// Plantillas de descripción (max 750 chars que pide Google). Se rellenan
// con datos del card. Si supera el límite, truncamos por palabra.
function buildDescription(card) {
  const nombre  = card.nombre || '';
  const tagline = card.tagline || '';
  const zona    = card.zona || '';
  const servicios = (card.servicios || []).slice(0, 5).map(s => s.replace(/\s*·\s*\d.*$/, '').trim()).filter(Boolean);

  const lines = [
    `${nombre}${tagline ? ` · ${tagline}` : ''}.`,
    zona ? `Atendemos en ${zona}.` : '',
    servicios.length ? `Servicios: ${servicios.join(', ')}.` : '',
    'Pide presupuesto sin compromiso. Atención personalizada y cercana.',
    `Reserva tu cita por WhatsApp · perfil completo y portafolio en perfilapro.es/c/${card.slug}`,
  ].filter(Boolean);

  let text = lines.join(' ');
  if (text.length > 750) {
    // Trunca por palabra hasta caber, deja "..." final.
    const words = text.split(' ');
    while (words.join(' ').length > 747 && words.length > 1) words.pop();
    text = words.join(' ') + '...';
  }
  return text;
}

// 5 posts iniciales (max 1500 chars cada uno en GBP, pero 250-300 funciona
// mejor para engagement). Mezclamos: presentación, oferta, servicio, prueba
// social, CTA.
function buildPosts(card) {
  const firstName = (card.nombre || '').split(' ')[0] || '';
  const tagline   = card.tagline || 'Profesional';
  const zona      = card.zona || 'tu zona';
  const servicio  = (card.servicios && card.servicios[0])
    ? card.servicios[0].replace(/\s*·\s*\d.*$/, '').trim()
    : 'nuestros servicios';
  const cardUrl   = `https://perfilapro.es/c/${card.slug}`;

  return [
    {
      title:  '¡Estamos aquí!',
      body:   `${firstName ? `Soy ${firstName}` : 'Hola a todos'}, ${tagline.toLowerCase()}. Atiendo en ${zona} con presupuesto sin compromiso y atención personalizada. Si necesitas ayuda con ${servicio.toLowerCase()}, escríbeme — te respondo en menos de 1 hora durante el horario laboral.`,
      cta:    { label: 'Llamar ahora',    url: cardUrl },
    },
    {
      title:  `${servicio} a domicilio`,
      body:   `Realizamos ${servicio.toLowerCase()} en ${zona} con todas las garantías. Materiales incluidos, factura, IVA y atención post-servicio. Pide tu presupuesto y nos coordinamos para visitarte cuando mejor te venga.`,
      cta:    { label: 'Pedir presupuesto', url: cardUrl },
    },
    {
      title:  '¿Por qué elegirnos?',
      body:   `Atención personalizada, transparencia en presupuestos y compromiso con los plazos. Trabajamos con clientes en ${zona} y zonas cercanas. Reseñas reales en nuestro perfil PerfilaPro — escanea el QR del local o visítalo online.`,
      cta:    { label: 'Ver perfil',         url: cardUrl },
    },
    {
      title:  'Cómo contactar',
      body:   `WhatsApp, llamada o formulario online — el medio que prefieras. Respondemos en menos de 1 hora durante el horario laboral. Para urgencias en ${zona}, llámanos directamente.`,
      cta:    { label: 'Abrir WhatsApp',    url: cardUrl },
    },
    {
      title:  'Servicio + portafolio online',
      body:   `Si quieres ver más sobre lo que hacemos, fotos de trabajos anteriores y testimonios, todo está en nuestro perfil online. Está actualizado y se puede compartir fácilmente.`,
      cta:    { label: 'Ver portafolio',    url: cardUrl },
    },
  ];
}

// Recomendaciones de fotos para el listing GBP. Cada slot indica el caso
// de uso para que el usuario sepa qué subir.
const PHOTO_SLOTS = [
  { key: 'logo',     label: 'Logo / foto principal',  spec: '720×720 cuadrada · JPG/PNG · max 5 MB',  tip: 'Si no tienes logo, usa una foto profesional tuya en primer plano' },
  { key: 'cover',    label: 'Portada del perfil',      spec: '1024×575 horizontal · JPG/PNG · max 5 MB', tip: 'Genera la imagen automática desde tu PerfilaPro o usa una foto de tu local/equipo' },
  { key: 'team',     label: 'Equipo / yo trabajando', spec: 'Cualquier ratio · max 5 MB',             tip: 'Una foto haciendo tu trabajo o del equipo aumenta clics x2-3' },
  { key: 'work_1',   label: 'Trabajo realizado #1',   spec: 'Cualquier ratio · max 5 MB',             tip: 'Antes/después es lo que más convierte' },
  { key: 'work_2',   label: 'Trabajo realizado #2',   spec: 'Cualquier ratio · max 5 MB',             tip: 'Mostrar variedad de servicios o proyectos' },
];

// Pasos guiados del asistente. Cada paso tiene un title, body con
// indicaciones y una acción (copy / download / link).
function buildSteps(card, siteUrl) {
  const cardUrl = `${siteUrl}/c/${card.slug}`;
  return [
    { id: 'intro',       title: 'Antes de empezar',           body: 'Necesitas una cuenta de Google y, si todavía no la tienes, una ficha de Google Business Profile. Si nunca la has creado, ve a https://www.google.com/business y elige "Añadir tu negocio". Vuelve a esta página con la ficha abierta para hacer copy-paste.' },
    { id: 'name',        title: '1. Nombre del negocio',      body: `Pega exactamente este nombre en GBP. No añadas ciudad ni servicios — Google penaliza el keyword stuffing.\n\n${card.nombre}`,         action: { type: 'copy', value: card.nombre } },
    { id: 'category',    title: '2. Categoría principal',     body: 'Google admite una categoría primaria + hasta 9 secundarias. La primaria es la más importante: úsala para el servicio principal. Las secundarias te dan visibilidad adicional.' },
    { id: 'description', title: '3. Descripción del negocio (max 750 caracteres)', body: 'Pega y edita lo que quieras. Tu objetivo: que en los primeros 200 chars el usuario sepa qué haces, dónde y cómo contactarte.', action: { type: 'copy', value: buildDescription(card) } },
    { id: 'website',     title: '4. URL del sitio web',       body: `En GBP, campo "Sitio web". Pega esta URL — es tu PerfilaPro, que actúa como página oficial.\n\n${cardUrl}`,                              action: { type: 'copy', value: cardUrl } },
    { id: 'photos',      title: '5. Fotos',                   body: 'GBP recomienda mínimo logo + portada + 3 fotos de trabajo. Sube las fotos en este orden y nombra los archivos en español (Google los lee).' },
    { id: 'qr',          title: '6. QR del perfil',           body: 'Descarga el QR vectorial (SVG) para vinilos del local, o el PNG 1024 para web. Pégalo en una publicación fijada de tu GBP con el texto "Escanea para ver mi perfil completo".' },
    { id: 'posts',       title: '7. Posts iniciales',         body: 'GBP premia las cuentas activas. Publica estos 5 posts en los primeros días para arrancar con engagement. No copies todos a la vez — 1-2 por semana.' },
    { id: 'verify',      title: '8. Verificación del negocio', body: 'Google te pedirá verificar el negocio: postal con código (5-15 días) o, en algunos casos, vídeo en directo o llamada telefónica. Sin verificar, tu ficha no aparece en búsquedas. Una vez recibido el código, lo introduces en el panel y listo.' },
  ];
}

module.exports = {
  GBP_CATEGORIES,
  PHOTO_SLOTS,
  buildDescription,
  buildPosts,
  buildSteps,
};
