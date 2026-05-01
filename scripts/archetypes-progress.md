# Refactor de archetypes — diversidad y "acento"

> **Lee este archivo primero** para retomar el trabajo en cualquier sesión nueva.
> Toda la información necesaria está aquí + `scripts/archetypes.json` + sección "Pending work" de `CLAUDE.md`.
> No hace falta releer el chat anterior.

---

## 1 · Qué estamos haciendo

Reescribir las **75 entradas** de `scripts/archetypes.json` para que cada perfil seed del directorio lleve un **"acento" demográfico** (origen aparente, edad, género, expresión) embebido en su `descripcion_accion`. Después se regenerarán las imágenes con **Gemini 2.5 Flash Image** ("Nano Banana"), modelo ya validado.

## 2 · Modelo y prompt — VALIDADOS, no tocar

**Modelo de imagen**: `gemini-2.5-flash-image` vía REST API
(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`).
La clave `GEMINI_API_KEY` está configurada en **Netlify env vars** (Production + Deploy Previews + Branch deploys) y en `.env` local. Coste ~$0.04/imagen.

**Construcción del prompt** = `BASE_PROMPT + " " + descripcion_accion`.

**BASE_PROMPT** (fijo, común para las 75):
```
Portrait photo, professional, warm natural light, subject in upper third of frame, neutral or soft background. 600x800px, vertical format. Realistic, approachable, no text.
```

**Estilo del "acento"** validado con 3 imágenes aprobadas (úsalo como ancla):
- *"Guapa y sonriente mujer albañil de origen latino coloca ladrillos en una pared al sol"*
- *"Joven árabe electricista arregla un cuadro eléctrico mientras sonríe a un compañero de trabajo"*
- *"Camionero de 50 años posa sonriente con los brazos cruzados, apoyado en su moderno Mercedes-Benz nuevo"*

**Patrón**: `[adjetivo afectivo opcional] + [género/edad/origen] + [rol] + [acción o pose] + [contexto/ambiente]`, en español natural, sin sonar a stock photo. Mínimo **65 de 75 sonriendo** (decisión del producto). Algunos en pose con brazos cruzados, mayoría en acción. Siempre en su entorno de trabajo.

## 3 · Distribución objetivo (las cuotas)

### Origen aparente
| Origen | % | Total target |
|---|---|---|
| Blanco / europeo | ~70% | **52** |
| Latinoamericano | ~13% | **10** |
| Magrebí (norte África) | ~8% | **6** |
| Negro africano subsahariano | ~4% | **3** |
| Asiático oriental | ~3% | **2** |
| Sur-asiático | ~3% | **2** |
| **Total** | | **75** |

### Edad aproximada
| Rango | % | Total target |
|---|---|---|
| 20-30 | ~20% | **15** |
| 30-45 | ~45% | **34** |
| 45-60 | ~25% | **19** |
| 60+ | ~10% | **7** |

### Género
| Género | % | Total target |
|---|---|---|
| Femenino | ~50% | **37** |
| Masculino | ~50% | **38** |

Con **6-8 disonancias estratégicas** repartidas (rompen estereotipo de género asociado al rol). Ejemplos de candidatas: enfermero hombre, instructor yoga hombre, mecánica mujer, peluquero hombre joven, manicurista hombre, fontanera mujer, costurero hombre, etc.

## 4 · Reglas de edición por entrada

| Campo | Regla |
|---|---|
| `descripcion_accion` | **SIEMPRE reescribir** incluyendo el acento. |
| `nombre_arquetipo` | Cambiar SOLO si el demográfico nuevo entra en conflicto cultural/fonético con el nombre antiguo (p.ej. Francisco → Lucía si ahora es mujer latina). Si el nombre es compatible, mantener. ⚠ El slug se deriva de aquí — al cambiar nombres se invalidan los seeds antiguos (acción del usuario: borrar `cards WHERE is_seed=true` en Supabase y `Avatars/seeds/*` en Storage antes de regenerar). |
| `rol_profesional` | Neutralizar SOLO si el género lingüístico choca con el demográfico (Enfermera → Enfermería para hombre, Albañil → Albañilería para mujer, Cocinera → Cocina para hombre). En cualquier otro caso, dejar tal cual. |
| `sector` | NUNCA tocar — es la clave para mapear a la tabla `categories`. |

## 5 · Bloques de trabajo (una sesión por bloque)

- [x] **Bloque 1** — entradas 1-25: Sanidad, Educación, Hostelería, Comercio, Oficios
- [x] **Bloque 2** — entradas 26-50: Transporte, Automoción, Tecnología, Legal, Belleza
- [x] **Bloque 3** — entradas 51-75: Fitness, Jardinería, Seguridad, Fotografía, Servicios oficina
- [x] **Bloque 4** — pipeline: refactor de `scripts/generate-seeds.js` para usar Gemini

## 6 · Running totals — ACTUALIZAR al final de cada bloque

### Origen
| Origen | Asignados | Target | Pendientes |
|---|---|---|---|
| Blanco europeo | 52 | 52 | 0 |
| Latinoamericano | 10 | 10 | 0 |
| Magrebí | 6 | 6 | 0 |
| Negro africano | 3 | 3 | 0 |
| Asiático oriental | 2 | 2 | 0 |
| Sur-asiático | 2 | 2 | 0 |

### Edad
| Rango | Asignados | Target | Pendientes |
|---|---|---|---|
| 20-30 | 15 | 15 | 0 |
| 30-45 | 34 | 34 | 0 |
| 45-60 | 19 | 19 | 0 |
| 60+ | 7 | 7 | 0 |

### Género
| Género | Asignados | Target | Pendientes |
|---|---|---|---|
| Femenino | 37 | 37 | 0 |
| Masculino | 38 | 38 | 0 |

> ✅ Las 75 entradas reescritas. Cuotas de origen, edad y género cuadran exactamente con el target.

### Disonancias estratégicas registradas
| # entrada | Rol | Disonancia |
|---|---|---|
| 5 | Cuidador de personas mayores (Samir) | Hombre magrebí mayor cuidando a una señora |
| 21 | Albañilería (Marisol) | Mujer latina en obra colocando ladrillos |
| 22 | Electricista (Lidia) | Mujer europea en cuadros eléctricos |
| 24 | Carpintera (Julia) | Mujer europea en taller de madera |
| 27 | Conductora de tráiler (Raquel) | Mujer europea camionera en área de servicio |
| 29 | Carretillera (Yasmine) | Mujer magrebí en logística pesada |
| 47 | Esteticista (Adrián) | Hombre europeo en cabina de estética |
| 49 | Manicurista (Rohan) | Hombre sur-asiático pintando uñas |
| 65 | Técnica en emergencias sanitarias (Aitana) | Mujer europea en emergencias |

## 7 · Bloque 4 — pipeline post-JSON  ✅ HECHO

Refactor aplicado en `scripts/generate-seeds.js`:

1. ✅ `generateImage()` ahora llama a `gemini-2.5-flash-image:generateContent` con
   POST + JSON body. Lee `candidates[0].content.parts[].inlineData.data` y lo
   pasa por `sharp(...).jpeg({ quality: 85 })` antes de devolverlo.
2. ✅ `sharp ^0.33.5` añadido a `devDependencies` del `package.json`.
3. ✅ Backoff exponencial (6 reintentos) y checkpoint preservados — ahora
   reintentan ante 429 / 5xx / errores de red / respuestas no-JSON. Sin imagen
   (texto de rechazo del modelo) NO reintenta.
4. ✅ Tests: no había mocks de Pollinations en `tests/`, así que no había nada
   que actualizar.

> **Acción manual del usuario antes de regenerar**: borrar los seeds antiguos
> en Supabase (`Avatars/seeds/*` en Storage + `DELETE FROM cards WHERE
> is_seed=true`) y luego ejecutar `node scripts/generate-seeds.js` para
> generar las 75 nuevas.

## 8 · Cómo retomar en una sesión nueva

```bash
# 1. Sincronizar la rama
git fetch origin claude/resume-seed-generation-CWNDw
git checkout claude/resume-seed-generation-CWNDw
git pull --ff-only

# 2. Leer este archivo y mirar el checkbox del primer bloque ⏳
# 3. Editar scripts/archetypes.json aplicando las reglas a las entradas del bloque
# 4. Actualizar este archivo:
#    - marcar el bloque ✅
#    - sumar a Running totals
#    - registrar disonancias en la tabla
# 5. Validar tests
npm test

# 6. Commit + push
git add scripts/archetypes.json scripts/archetypes-progress.md
git commit -m "feat(seeds): bloque N — sectores X-Y con acento + diversidad"
git push origin claude/resume-seed-generation-CWNDw
```

## 9 · Estado de la rama y de producción

- Rama de trabajo: `claude/resume-seed-generation-CWNDw`. **Nunca pushear a otra rama sin permiso explícito.**
- En `main` están desplegadas (cherry-pick) las páginas temporales de preview/lab:
  - `/lab-gemini.html` + `/api/lab-gemini` (lab de prompts, protegido por `ADMIN_PASSWORD`)
  - `/preview-gemini-3.html` (las 3 cards validadas)
  - `/preview-seeds.html` (versión vieja con Pollinations, prácticamente obsoleta)
- En `claude/...` (no en main) viven: el escaparate del home (`showcase` endpoint), las mejoras del seed generator (backoff/checkpoint), las anotaciones de Pending work en `CLAUDE.md`.

## 10 · Cosas que NO hace falta volver a hacer

- Re-validar el modelo o el prompt base — ya hecho con 3 muestras aprobadas.
- Configurar `GEMINI_API_KEY` en Netlify — ya está.
- Generar otra página de preview — el usuario revisa el JSON en GitHub Mobile.
- Discutir distribución/cuotas — ya cerradas en sección 3.
