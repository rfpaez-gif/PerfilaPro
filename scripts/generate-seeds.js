#!/usr/bin/env node
'use strict';

/**
 * generate-seeds.js — genera fotos y fichas de perfiles semilla via Imagen 3 (Google AI)
 *
 * Uso:
 *   node scripts/generate-seeds.js              # genera todos
 *   node scripts/generate-seeds.js --dry-run    # simula sin llamar a la API
 *   node scripts/generate-seeds.js --limit 5    # solo los primeros 5
 *   node scripts/generate-seeds.js --start 10   # desde el arquetipo nº 10
 *
 * Variables de entorno requeridas (en .env o exportadas):
 *   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const archetypes = require('./archetypes.json');

const { GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltan variables de entorno: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ── Prompt base (parte común del prompt Banana) ──────────────────────────────
const BASE_PROMPT =
  'Portrait photo, professional, warm natural light, subject in upper third of frame, ' +
  'neutral or soft background. 600x800px, vertical format. Realistic, approachable, no text.';

// ── Ciudades en rotación round-robin ─────────────────────────────────────────
const CITIES = [
  'madrid', 'barcelona', 'valencia', 'sevilla', 'zaragoza',
  'malaga', 'bilbao', 'alicante', 'murcia', 'granada',
];

// ── Mapeo sector JSON → sector en tabla categories ───────────────────────────
const SECTOR_MAP = {
  'Sanidad y cuidados':                      'salud',
  'Educación y formación':                   'educacion',
  'Hostelería y turismo':                    'hosteleria',
  'Comercio y ventas':                       'comercio',
  'Oficios, construcción y reformas':        'oficios',
  'Transporte y logística':                  'transporte',
  'Automoción y mantenimiento de vehículos': 'automocion',
  'Tecnología e informática':                'tech',
  'Legal y asesoría':                        'legal',
  'Belleza y bienestar':                     'belleza',
  'Fitness y deporte':                       'fitness',
  'Jardinería, agricultura y medio rural':   'jardineria',
  'Seguridad y vigilancia':                  'seguridad',
  'Fotografía, imagen y eventos':            'fotografia',
  'Servicios a empresas y oficina':          'otro',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function toSlug(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 40);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Generación de imagen via Imagen 3 (Google AI REST API) ───────────────────
async function generateImage(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '3:4',
        personGeneration: 'allow_adult',
        safetySetting: 'block_only_high',
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Imagen API ${res.status}: ${txt.substring(0, 200)}`);
  }

  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error(`Sin imagen en respuesta: ${JSON.stringify(data).substring(0, 200)}`);

  return Buffer.from(b64, 'base64');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const startIdx = args.indexOf('--start');
  const limit  = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : archetypes.length;
  const start  = startIdx >= 0 ? parseInt(args[startIdx + 1], 10) : 0;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const batch = archetypes.slice(start, start + limit);

  console.log(`\nGenerando ${batch.length} perfiles semilla${dryRun ? ' [DRY RUN — sin llamadas API]' : ''}...\n`);

  let ok = 0, skipped = 0, errors = 0;

  for (let i = 0; i < batch.length; i++) {
    const arch   = batch[i];
    const slug   = 'seed-' + toSlug(arch.nombre_arquetipo);
    const sector = SECTOR_MAP[arch.sector] || 'otro';
    const city   = CITIES[i % CITIES.length];
    const nombre = arch.nombre_arquetipo.split(' ')[0];

    process.stdout.write(`[${String(i + 1).padStart(2)}/${batch.length}] ${arch.nombre_arquetipo.padEnd(32)} `);

    // Saltar si ya existe
    const { data: existing } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (existing) {
      console.log('↩ ya existe');
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`✓ dry  slug=${slug}  sector=${sector}  ciudad=${city}`);
      ok++;
      continue;
    }

    try {
      // 1. Generar imagen
      const fullPrompt = `${BASE_PROMPT} ${arch.descripcion_accion}`;
      const imageBuffer = await generateImage(fullPrompt);

      // 2. Subir a Supabase Storage (bucket Avatars, carpeta seeds/)
      const storagePath = `seeds/${slug}.jpg`;
      const { error: uploadErr } = await db.storage
        .from('Avatars')
        .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = db.storage.from('Avatars').getPublicUrl(storagePath);

      // 3. Buscar category_id del sector (primera especialidad disponible)
      const { data: cat } = await db
        .from('categories').select('id').eq('sector', sector).limit(1).maybeSingle();

      // 4. Insertar ficha semilla
      const { error: insertErr } = await db.from('cards').insert({
        slug,
        nombre,
        tagline:           arch.rol_profesional,
        foto_url:          publicUrl,
        plan:              'base',
        status:            'active',
        is_seed:           true,
        directory_visible: false,
        city_slug:         city,
        profession_label:  arch.rol_profesional,
        profile_views:     Math.floor(Math.random() * 120) + 20,
        ...(cat ? { category_id: cat.id } : {}),
      });
      if (insertErr) throw insertErr;

      console.log('✓ ok');
      ok++;
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
      errors++;
    }

    // Rate limit: Imagen 3 permite ~30 req/min → ~2,1 s entre llamadas
    if (i < batch.length - 1) await sleep(2200);
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Generados: ${ok}  |  Saltados: ${skipped}  |  Errores: ${errors}`);
  console.log(`─────────────────────────────────────────\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
