#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');

// Carga manual del .env para evitar problemas con dotenv
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const eq = clean.indexOf('=');
    if (eq < 0) return;
    const key = clean.substring(0, eq).trim();
    const val = clean.substring(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
}

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

// ── Checkpoint de progreso ───────────────────────────────────────────────────
const PROGRESS_FILE = path.join(__dirname, '.seed-progress.json');

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (_) { /* ignore corrupt file, start fresh */ }
  return { lastCompleted: -1, ok: 0, skipped: 0, errors: 0 };
}

function saveProgress(state) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(`⚠ no se pudo guardar progreso: ${e.message}`);
  }
}

// ── Generación de imagen con backoff exponencial ─────────────────────────────
async function generateImage(prompt) {
  const encoded = encodeURIComponent(prompt);
  // Hasta 6 reintentos: 5s, 10s, 20s, 40s, 80s, 160s (≈5 min total en el peor caso)
  const MAX_ATTEMPTS = 6;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=600&height=800&model=flux&nologo=true&enhance=true&seed=${seed}`;

    let res;
    try {
      res = await fetch(url);
    } catch (netErr) {
      if (attempt === MAX_ATTEMPTS) throw netErr;
      const wait = 5000 * Math.pow(2, attempt - 1);
      process.stdout.write(`(red ${netErr.code || 'err'}, retry ${attempt}/${MAX_ATTEMPTS} en ${wait / 1000}s) `);
      await sleep(wait);
      continue;
    }

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // 429 o 5xx → reintentar; otros códigos → fallar inmediatamente
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Pollinations ${res.status}`);
    }

    const wait = 5000 * Math.pow(2, attempt - 1);
    process.stdout.write(`(${res.status}, retry ${attempt}/${MAX_ATTEMPTS} en ${wait / 1000}s) `);
    await sleep(wait);
  }

  throw new Error('Pollinations: agotados los reintentos');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset  = args.includes('--reset');
  const limitIdx = args.indexOf('--limit');
  const startIdx = args.indexOf('--start');

  if (reset && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('Checkpoint eliminado.');
  }

  const progress = loadProgress();

  // Prioridad: --start explícito > checkpoint > 0
  let start;
  if (startIdx >= 0) {
    start = parseInt(args[startIdx + 1], 10);
  } else if (progress.lastCompleted >= 0) {
    start = progress.lastCompleted + 1;
    console.log(`↻ Reanudando desde índice ${start} (checkpoint previo).`);
  } else {
    start = 0;
  }

  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : archetypes.length - start;
  const db    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const batch = archetypes.slice(start, start + limit);

  if (batch.length === 0) {
    console.log('Nada que generar (¿checkpoint completo? usa --reset para empezar de cero).');
    return;
  }

  console.log(`\nGenerando ${batch.length} perfiles semilla${dryRun ? ' [DRY RUN — sin llamadas API]' : ''}...\n`);

  let ok = progress.ok, skipped = progress.skipped, errors = progress.errors;
  let lastCompletedAbs = start - 1;
  let interrupted = false;

  // Guardar progreso si el usuario interrumpe (Ctrl-C / SIGTERM)
  const onSignal = (sig) => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\n${sig} recibido — guardando checkpoint y saliendo...`);
    saveProgress({ lastCompleted: lastCompletedAbs, ok, skipped, errors });
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  for (let i = 0; i < batch.length; i++) {
    const absoluteIdx = start + i;
    const arch   = batch[i];
    const slug   = 'seed-' + toSlug(arch.nombre_arquetipo);
    const sector = SECTOR_MAP[arch.sector] || 'otro';
    const city   = CITIES[absoluteIdx % CITIES.length];
    const nombre = arch.nombre_arquetipo.split(' ')[0];

    process.stdout.write(`[${String(absoluteIdx + 1).padStart(2)}/${archetypes.length}] ${arch.nombre_arquetipo.padEnd(32)} `);

    // Saltar si ya existe
    const { data: existing } = await db.from('cards').select('slug').eq('slug', slug).maybeSingle();
    if (existing) {
      console.log('↩ ya existe');
      skipped++;
      lastCompletedAbs = absoluteIdx;
      saveProgress({ lastCompleted: lastCompletedAbs, ok, skipped, errors });
      continue;
    }

    if (dryRun) {
      console.log(`✓ dry  slug=${slug}  sector=${sector}  ciudad=${city}`);
      ok++;
      lastCompletedAbs = absoluteIdx;
      continue;
    }

    try {
      const fullPrompt = `${BASE_PROMPT} ${arch.descripcion_accion}`;
      const imageBuffer = await generateImage(fullPrompt);

      const storagePath = `seeds/${slug}.jpg`;
      const { error: uploadErr } = await db.storage
        .from('Avatars')
        .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = db.storage.from('Avatars').getPublicUrl(storagePath);

      const { data: cat } = await db
        .from('categories').select('id').eq('sector', sector).limit(1).maybeSingle();

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
      lastCompletedAbs = absoluteIdx;
      saveProgress({ lastCompleted: lastCompletedAbs, ok, skipped, errors });
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
      errors++;
      // No avanzamos lastCompleted: el siguiente arranque reintentará este índice.
      saveProgress({ lastCompleted: lastCompletedAbs, ok, skipped, errors });
    }

    // Espaciar peticiones para no disparar el rate-limit de Pollinations
    if (i < batch.length - 1) await sleep(2200);
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Generados: ${ok}  |  Saltados: ${skipped}  |  Errores: ${errors}`);
  console.log(`Checkpoint: ${PROGRESS_FILE}`);
  console.log(`─────────────────────────────────────────\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
