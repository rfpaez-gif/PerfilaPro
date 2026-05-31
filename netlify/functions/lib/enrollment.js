'use strict';

// Validación y normalización del payload de inscripción del padre
// (capa I1 · docs/cantera-inscripcion-temporada.md, pantalla A).
//
// Lib PURO: no toca BD ni Stripe. Recibe el body crudo del formulario
// público y devuelve { data, errors }. La creación de la ficha la hace
// lib/player-create con estos datos ya saneados; el cobro lo lanza el
// endpoint (capa I4) según payment_choice.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_KINDS = Object.freeze(['dni', 'nie', 'pasaporte', 'libro_familia']);
const GENDERS = Object.freeze(['M', 'F', 'X']);
// Cómo paga el padre: online (Connect, 3%) o lo gestiona con el club.
const PAYMENT_CHOICES = Object.freeze(['online', 'club']);

function stripTags(str) {
  return String(str == null ? '' : str).replace(/<[^>]*>/g, '').trim();
}

function cleanEmail(v) {
  return String(v == null ? '' : v).toLowerCase().trim();
}

// Valida una fecha 'YYYY-MM-DD' real (no 2014-13-40) y dentro de rango.
function isValidBirthDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  const thisYear = new Date().getUTCFullYear();
  return y >= 1900 && y <= thisYear;
}

// Normaliza y valida el payload de inscripción. Devuelve:
//   { data, errors }  — errors es [] si todo OK; data siempre presente
//   con lo que se pudo parsear (para repintar el form).
//
// Decisión 2 del diseño: los DOCUMENTOS son opcionales en la inscripción
// (completables después). Aquí solo se validan datos del jugador, tutor
// y consentimientos; los documentos los maneja el endpoint aparte.
function validateEnrollment(body) {
  const b = body || {};
  const errors = [];

  // ── Deportista ──
  const nombre = stripTags(b.nombre).substring(0, 100);
  if (!nombre) errors.push('nombre');

  const birthDate = String(b.birth_date == null ? '' : b.birth_date).trim();
  if (!isValidBirthDate(birthDate)) errors.push('birth_date');

  let gender = null;
  if (b.gender != null && b.gender !== '') {
    if (GENDERS.includes(b.gender)) gender = b.gender;
    else errors.push('gender');
  }

  let docKind = null;
  if (b.doc_kind != null && b.doc_kind !== '') {
    if (DOC_KINDS.includes(b.doc_kind)) docKind = b.doc_kind;
    else errors.push('doc_kind');
  }
  const docNumber = b.doc_number ? stripTags(b.doc_number).substring(0, 40) : null;
  const nationality = b.nationality ? stripTags(b.nationality).substring(0, 60) : null;
  const direccion = b.direccion ? stripTags(b.direccion).substring(0, 200) : null;

  // ── Tutor legal (obligatorio) ──
  const tutorEmail = cleanEmail(b.tutor_legal_email);
  if (!EMAIL_RE.test(tutorEmail)) errors.push('tutor_legal_email');
  const tutorName = stripTags(b.tutor_legal_name).substring(0, 100);
  if (!tutorName) errors.push('tutor_legal_name');
  const tutorDni = b.tutor_legal_dni ? stripTags(b.tutor_legal_dni).substring(0, 20) : null;
  const tutorPhone = b.tutor_legal_phone ? stripTags(b.tutor_legal_phone).replace(/[^\d+\s]/g, '').trim().substring(0, 30) : null;

  // ── Tutor secundario (opcional) ──
  let tutor2 = null;
  const tutor2Email = b.tutor_secundario_email ? cleanEmail(b.tutor_secundario_email) : null;
  if (tutor2Email) {
    if (!EMAIL_RE.test(tutor2Email)) errors.push('tutor_secundario_email');
    else if (tutor2Email !== tutorEmail) {
      tutor2 = {
        email: tutor2Email,
        name: stripTags(b.tutor_secundario_name).substring(0, 100) || null,
        dni: b.tutor_secundario_dni ? stripTags(b.tutor_secundario_dni).substring(0, 20) : null,
        phone: b.tutor_secundario_phone ? stripTags(b.tutor_secundario_phone).replace(/[^\d+\s]/g, '').trim().substring(0, 30) : null,
      };
    }
  }

  // ── Consentimientos ──
  // data_processing es OBLIGATORIO (no hay ficha sin tratamiento de datos).
  // image_rights es opcional (gobierna public_card más adelante).
  const consentData = b.consent_data === true || b.consent_data === 'true' || b.consent_data === 'on';
  if (!consentData) errors.push('consent_data');
  const consentImage = b.consent_image === true || b.consent_image === 'true' || b.consent_image === 'on';

  // ── Pago ──
  let paymentChoice = 'club';
  if (b.payment_choice != null && b.payment_choice !== '') {
    if (PAYMENT_CHOICES.includes(b.payment_choice)) paymentChoice = b.payment_choice;
    else errors.push('payment_choice');
  }

  const idioma = b.idioma === 'ca' ? 'ca' : 'es';

  const data = {
    nombre, birth_date: DATE_RE.test(birthDate) ? birthDate : null, gender,
    doc_kind: docKind, doc_number: docNumber, nationality, direccion,
    tutor_legal: { email: EMAIL_RE.test(tutorEmail) ? tutorEmail : null, name: tutorName || null, dni: tutorDni, phone: tutorPhone },
    tutor_secundario: tutor2,
    consent_data: consentData,
    consent_image: consentImage,
    payment_choice: paymentChoice,
    idioma,
  };

  return { data, errors };
}

module.exports = {
  DOC_KINDS,
  GENDERS,
  PAYMENT_CHOICES,
  EMAIL_RE,
  isValidBirthDate,
  validateEnrollment,
};
