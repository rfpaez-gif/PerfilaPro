'use strict';

// Creación de la ficha de un jugador/staff de cantera (capa I1).
//
// Extrae la lógica de escritura de register-player.js para compartirla
// entre el alta del club (register-player, auth org-panel) y la
// inscripción self-service del padre (capa I4, endpoint público). Ambos
// crean exactamente lo mismo: card(player|club_staff) + member_club_seasons
// de la temporada + card_admins(tutores), con categoría resuelta por
// birth_year y PII cifrada si CANTERA_PII_KEY está configurada.
//
// Lib casi puro: recibe el `db` (Supabase) ya inyectado y los datos YA
// VALIDADOS por el caller. No hace auth, no manda emails, no toca Stripe.
// Sin transacción multi-statement en la Data API: ante fallo de membership
// o admins compensa borrando la card (FK ON DELETE CASCADE).

const crypto = require('crypto');
const { CARD_KINDS } = require('./card-kind');
const { isPiiCryptoConfigured, encryptBirthDate, birthYearFromDate } = require('./pii-crypto');
const {
  listSportsCategories,
  categoryForBirthYear,
  parseSeasonStartYear,
  currentSeasonStartYear,
  formatSeason,
} = require('./sports-categories');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Slug opaco: 'p-' + 8 hex (anti-doxxing de menores; NO derivado del
// nombre). ~4.3e9 combinaciones; reintenta ante colisión.
function makePlayerSlug() {
  return 'p-' + crypto.randomBytes(4).toString('hex');
}

async function uniquePlayerSlug(db) {
  let slug = makePlayerSlug();
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (!clash) break;
    slug = makePlayerSlug();
  }
  return slug;
}

function makeAdminRow(slug, email, role, extra = {}) {
  return {
    card_slug: slug,
    email,
    role,
    edit_token: crypto.randomBytes(32).toString('hex'),
    edit_token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    ...(extra.name ? { name: extra.name } : {}),
    ...(extra.dni ? { dni: extra.dni } : {}),
    ...(extra.phone ? { phone: extra.phone } : {}),
  };
}

// Crea la ficha completa. Entradas (todas YA validadas por el caller):
//   db        — cliente Supabase.
//   org       — { id, sport } del club.
//   input     — {
//     nombre, role (default 'jugador'), birthDate ('YYYY-MM-DD'|null),
//     gender, dorsal, position, teamName, previousClubName,
//     season (string|null → vigente), idioma,
//     docKind, docNumber, nationality, direccion,   // puente federativo (opcional)
//     publicCard (default false),
//     tutors: [ { email, role, name?, dni?, phone? } ]  // ≥1; role
//              default 'tutor_legal' para el primero.
//   }
//
// Devuelve:
//   éxito → { ok:true, slug, card_kind, season, category_id, admins }
//   error → { ok:false, stage, error }   // stage: 'card'|'membership'|'admins'
async function createPlayerCard(db, org, input) {
  const role = input.role || 'jugador';
  const isPlayer = role === 'jugador';
  const cardKind = isPlayer ? CARD_KINDS.PLAYER : CARD_KINDS.CLUB_STAFF;

  const birthDate = input.birthDate || null;
  const birthYear = birthDate ? birthYearFromDate(birthDate) : null;

  // Temporada: la del input si parsea, si no la vigente (cutoff julio).
  const seasonStartYear = parseSeasonStartYear(input.season) ?? currentSeasonStartYear();
  const season = formatSeason(seasonStartYear);

  // Categoría (solo jugadores, según deporte del club).
  let categoryId = null;
  if (isPlayer && org.sport && birthYear) {
    const categories = await listSportsCategories(db, org.sport);
    const match = categoryForBirthYear({ categories, birthYear, seasonStartYear });
    categoryId = match ? match.id : null;
  }

  // PII: fecha de nacimiento cifrada (si CANTERA_PII_KEY configurada).
  let birthDateEncrypted = null;
  if (birthDate && isPiiCryptoConfigured()) {
    try {
      birthDateEncrypted = encryptBirthDate(birthDate);
    } catch (err) {
      console.error('player-create: fallo cifrando birth_date:', err.message);
    }
  }

  const slug = await uniquePlayerSlug(db);

  // ── INSERT card ──
  const cardRow = {
    slug,
    card_kind: cardKind,
    nombre: input.nombre,
    idioma: input.idioma === 'ca' ? 'ca' : 'es',
    organization_id: org.id,
    status: 'active',
    public_card: input.publicCard === true,
    birth_year: birthYear,
    gender: input.gender || null,
    birth_date_encrypted: birthDateEncrypted,
  };
  if (input.docKind) cardRow.doc_kind = input.docKind;
  if (input.docNumber) cardRow.doc_number = input.docNumber;
  if (input.nationality) cardRow.nationality = input.nationality;
  if (input.direccion) cardRow.direccion = input.direccion;

  const { error: cardErr } = await db.from('cards').insert(cardRow);
  if (cardErr) {
    console.error('player-create: error insertando card:', cardErr.message);
    return { ok: false, stage: 'card', error: cardErr };
  }

  // Compensación ante fallo posterior (FK ON DELETE CASCADE limpia hijos).
  const rollback = async (stage, err) => {
    console.error(`player-create: ${stage}:`, err && err.message);
    await db.from('cards').delete().eq('slug', slug);
    return { ok: false, stage, error: err };
  };

  // ── INSERT member_club_seasons ──
  const { error: seasonErr } = await db.from('member_club_seasons').insert({
    card_slug: slug,
    organization_id: org.id,
    season,
    role,
    category_id: categoryId,
    team_name: input.teamName || null,
    dorsal: isPlayer ? (input.dorsal ?? null) : null,
    position: input.position || null,
    previous_club_name: input.previousClubName || null,
  });
  if (seasonErr) return rollback('membership', seasonErr);

  // ── INSERT card_admins (tutores) ──
  const tutors = Array.isArray(input.tutors) ? input.tutors : [];
  const seen = new Set();
  const adminRows = [];
  tutors.forEach((t, i) => {
    if (!t || !t.email || seen.has(t.email)) return;
    seen.add(t.email);
    const role = t.role || (i === 0 ? 'tutor_legal' : 'tutor_secundario');
    adminRows.push(makeAdminRow(slug, t.email, role, t));
  });
  if (adminRows.length > 0) {
    const { error: adminErr } = await db.from('card_admins').insert(adminRows);
    if (adminErr) return rollback('admins', adminErr);
  }

  return { ok: true, slug, card_kind: cardKind, season, category_id: categoryId, admins: adminRows };
}

module.exports = {
  TOKEN_TTL_MS,
  makePlayerSlug,
  uniquePlayerSlug,
  createPlayerCard,
};
