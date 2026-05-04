#!/usr/bin/env node
'use strict';

/**
 * scripts/quipu-validate.js
 *
 * Validacion tecnica de la API v1 de Quipu sin commit de credenciales.
 * Lee QUIPU_APP_ID y QUIPU_APP_SECRET de .env.local (gitignored) o de
 * variables de entorno.
 *
 * Uso:
 *   node scripts/quipu-validate.js
 *
 * Requisitos: Node 18+ (usa fetch nativo).
 *
 * El script ejecuta el siguiente flujo:
 *   1. Solicita token OAuth2 con grant_type=client_credentials.
 *   2. GET /numbering_series como smoke test del token.
 *   3. POST /contacts con NIF ficticio valido (12345678Z).
 *   4. POST /invoices con concepto "Suscripcion PerfilaPro Pro mensual"
 *      e importe 4.05 EUR + 21% IVA = 4.90 EUR total.
 *   5. GET /invoices/:id para inspeccionar la factura creada.
 *   6. Imprime resumen y volcado JSON de la factura.
 *
 * IMPORTANTE: durante la validacion la cuenta debe tener Verifactu
 * desactivado (Configuracion -> Verifactu -> "Voy a facturar con Quipu,
 * pero aun no enviare los registros a Verifactu") para no contaminar
 * AEAT con datos de prueba.
 */

const fs   = require('fs');
const path = require('path');

// --- Cargar .env.local sin dependencias externas ---
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const APP_ID     = process.env.QUIPU_APP_ID;
const APP_SECRET = process.env.QUIPU_APP_SECRET;
const BASE       = 'https://getquipu.com';
const ACCEPT     = 'application/vnd.quipu.v1+json';

if (!APP_ID || !APP_SECRET) {
  console.error('ERROR: define QUIPU_APP_ID y QUIPU_APP_SECRET en .env.local o como variables de entorno.');
  process.exit(1);
}

// --- Helpers ---
async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function apiGet(p, token) {
  const res = await fetch(`${BASE}${p}`, {
    headers: { 'Accept': ACCEPT, 'Authorization': `Bearer ${token}` },
  });
  return { ok: res.ok, status: res.status, body: await safeJson(res) };
}

async function apiPost(p, token, payload) {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: {
      'Accept':        ACCEPT,
      'Content-Type':  ACCEPT,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await safeJson(res) };
}

function fail(stage, res) {
  console.error(`\nFALLO en [${stage}] · HTTP ${res.status}`);
  console.error(JSON.stringify(res.body, null, 2));
  process.exit(1);
}

// --- Flujo principal ---
async function main() {
  console.log('==> Validacion API Quipu v1\n');

  // 1. Autenticacion
  console.log('[1/5] Solicitando token OAuth2...');
  const basic = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64');
  const tokenRes = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type':  'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: 'grant_type=client_credentials&scope=ecommerce',
  });
  if (!tokenRes.ok) fail('auth', { status: tokenRes.status, body: await safeJson(tokenRes) });
  const tokenData = await tokenRes.json();
  const token     = tokenData.access_token;
  console.log(`      OK · expires_in=${tokenData.expires_in}s scope=${tokenData.scope || 'n/a'}\n`);

  // 2. Smoke test
  console.log('[2/5] Smoke test (GET /numbering_series)...');
  const smoke = await apiGet('/numbering_series', token);
  if (!smoke.ok) fail('smoke', smoke);
  const numerations = smoke.body?.data || [];
  console.log(`      OK · ${numerations.length} numeraciones disponibles\n`);

  // 3. Crear contacto demo
  console.log('[3/5] Creando contacto ficticio (NIF 12345678Z)...');
  const contactPayload = {
    data: {
      type: 'contacts',
      attributes: {
        name:         'Cliente Demo PerfilaPro',
        company_name: 'Demo Cliente SL',
        vat_number:   '12345678Z',
        email:        `demo+${Date.now()}@perfilapro.test`,
        kind:         'customer',
        address:      'Calle de Prueba 1',
        city:         'Madrid',
        postal_code:  '28001',
        country_code: 'ES',
      },
    },
  };
  const contactRes = await apiPost('/contacts', token, contactPayload);
  if (!contactRes.ok) fail('crear contacto', contactRes);
  const contactId = contactRes.body?.data?.id;
  console.log(`      OK · contact_id=${contactId}\n`);

  // 4. Crear factura
  console.log('[4/5] Creando factura demo (4.05 EUR + 21% IVA = 4.90 EUR total)...');
  const today = new Date().toISOString().slice(0, 10);
  const invoicePayload = {
    data: {
      type: 'invoices',
      attributes: {
        kind:           'income',
        issue_date:     today,
        due_dates:      [today],
        payment_method: 'bank_card',
      },
      relationships: {
        contact: { data: { id: contactId, type: 'contacts' } },
        items: {
          data: [{
            type: 'book_entry_items',
            attributes: {
              concept:           'Suscripcion PerfilaPro Pro mensual (validacion API)',
              unitary_amount:    '4.05',
              quantity:          1,
              vat_percent:       21,
              retention_percent: 0,
            },
          }],
        },
      },
    },
  };
  const invoiceRes = await apiPost('/invoices', token, invoicePayload);
  if (!invoiceRes.ok) fail('crear factura', invoiceRes);
  const invoiceId   = invoiceRes.body?.data?.id;
  const invoiceAttr = invoiceRes.body?.data?.attributes || {};
  console.log(`      OK · invoice_id=${invoiceId}`);
  console.log(`      filing_number=${invoiceAttr.filing_number || invoiceAttr.number || '(no asignado)'}`);
  console.log(`      total=${invoiceAttr.total_amount}  iva=${invoiceAttr.vat_amount}\n`);

  // 5. Recuperar la factura completa
  console.log(`[5/5] GET /invoices/${invoiceId} para inspeccion completa...`);
  const inspect = await apiGet(`/invoices/${invoiceId}`, token);
  if (!inspect.ok) fail('GET factura', inspect);

  const verifactuKeys = Object.entries(inspect.body?.data?.attributes || {})
    .filter(([k]) => /verifactu|aeat|hacienda|exempt|filing|qr|seal|sii|legal/i.test(k));
  console.log(`      OK · campos relacionados con Verifactu/AEAT en la respuesta:`);
  if (verifactuKeys.length === 0) {
    console.log('        (ninguno · esperado con Verifactu desactivado en la cuenta)');
  } else {
    for (const [k, v] of verifactuKeys) console.log(`        - ${k}: ${JSON.stringify(v)}`);
  }

  // --- Resumen ---
  console.log('\n=== RESUMEN ===');
  console.log('Auth                  OK');
  console.log('Smoke (numbering)     OK');
  console.log(`Crear contacto        OK · id=${contactId}`);
  console.log(`Crear factura         OK · id=${invoiceId}`);
  console.log(`Recuperar factura     OK`);
  console.log('\nVolcado completo de la factura (para revision):');
  console.log(JSON.stringify(inspect.body, null, 2));
}

main().catch(err => {
  console.error('\nERROR no capturado:', err);
  process.exit(1);
});
