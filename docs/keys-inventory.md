# Keys & Secrets Inventory — PerfilaPro

> **Regla de oro:** ningún valor real aparece en este documento ni en el repositorio.
> Última revisión: 2026-04-29 · Responsable: CEO

---

## Inventario completo

| Variable | Proveedor | Entorno | Criticidad | Ubicación actual | Frontend | Notas |
|---|---|---|---|---|---|---|
| `SUPABASE_URL` | Supabase | prod | Media | Netlify env vars | No | URL pública del proyecto. Cambia si se migra de proyecto. |
| `SUPABASE_SERVICE_KEY` | Supabase | prod | **⚠ CRÍTICA** | Netlify env vars | No | Llave maestra con acceso total a la BD. Nunca exponer. Rotar si hay sospecha de filtración. |
| `STRIPE_SECRET_KEY` | Stripe | prod | **⚠ CRÍTICA** | Netlify env vars | No | `sk_live_...`. Permite crear cobros reales. Rotar inmediatamente si se filtra. |
| `STRIPE_WEBHOOK_SECRET` | Stripe | prod | Alta | Netlify env vars | No | `whsec_...`. Verifica que los webhooks vienen de Stripe. Rotar desde Stripe Dashboard. |
| `STRIPE_PRICE_BASE` | Stripe | prod | Media | Netlify env vars | No | ID del precio del plan Base (`price_...`). Cambiar si se modifica el producto en Stripe. |
| `STRIPE_PRICE_PRO` | Stripe | prod | Media | Netlify env vars | No | ID del precio del plan Pro (`price_...`). Ídem. |
| `RESEND_API_KEY` | Resend | prod | Alta | Netlify env vars | No | `re_...`. Acceso de envío de emails. Rotar si hay uso anómalo. |
| `ADMIN_PASSWORD` | Interno | prod | Alta | Netlify env vars | No | Contraseña del panel `/admin.html`. Mínimo 20 chars, aleatoria. |
| `ADMIN_TOTP_SECRET` | Interno | prod | Alta | Netlify env vars | No | Opcional. Semilla TOTP para 2FA del admin (RFC 6238). Si no se define, el 2FA queda desactivado. |
| `AGENT_JWT_SECRET` | Interno | prod | Alta | Netlify env vars | No | Firma los JWT de agentes comerciales (HS256, 7 días TTL). Rotar invalida todas las sesiones activas. |
| `SITE_URL` | Interno | prod | Baja | Netlify env vars | No | `https://perfilapro.es`. Usado para construir enlaces en emails. Netlify también inyecta `URL` automáticamente como fallback. |
| `URL` | Netlify | prod | Baja | Auto-inyectada por Netlify | No | Variable automática de Netlify con la URL del deploy. No configurar manualmente. |

---

## 🔴 Hallazgos urgentes

| # | Hallazgo | Riesgo | Acción |
|---|---|---|---|
| 1 | **Sin entorno `dev` ni `preview`** | Alto | Cualquier prueba local usa las keys de producción. Ver sección Entornos. |
| 2 | **`SUPABASE_SERVICE_KEY` es llave maestra** | Crítico | Confirmar que no aparece en logs de Netlify ni en código de frontend. ✅ Verificado en este repo. |
| 3 | **Sin Stripe test keys** | Alto | No hay forma de probar el flujo de pago sin arriesgar cobros reales o usar la misma cuenta. |
| 4 | **`ADMIN_TOTP_SECRET` opcional** | Medio | Si no está definida, el admin solo tiene contraseña. Recomendado activar en producción. |
| 5 | **Sin registro de última rotación** | Medio | No hay fecha de cuándo se crearon/rotaron las keys. Ver sección Rotación. |
| 6 | **ImprovMX no tiene variable en el código** | Info | ImprovMX gestiona el ruteo de email a nivel DNS/dashboard. No requiere variable de entorno en el repo — confirmar que la configuración DNS está documentada fuera. |

---

## Entornos — estado actual y objetivo

| Entorno | Estado | Netlify | Supabase | Stripe |
|---|---|---|---|---|
| `production` | ✅ Operativo | Site principal | Proyecto principal | Llaves `live` |
| `preview` (PRs) | ⚠ Sin configurar | Deploy previews de Netlify | — | — |
| `dev` (local) | ⚠ Sin configurar | — | — | — |

**Objetivo mínimo:** crear un segundo proyecto en Supabase y usar Stripe test keys para `dev` y `preview`, de modo que ninguna prueba toque datos reales.

---

## Rotación — checklist por proveedor

### Supabase — `SUPABASE_SERVICE_KEY`
1. Supabase Dashboard → Settings → API → Regenerate service_role key
2. Actualizar en Netlify → Site settings → Environment variables
3. Trigger redeploy en Netlify
4. Verificar que las funciones responden (test con `/api/card-status`)
5. Registrar fecha en este documento

### Stripe — `STRIPE_SECRET_KEY`
1. Stripe Dashboard → Developers → API keys → Roll key
2. Actualizar en Netlify
3. Verificar webhook con un pago de test
4. Registrar fecha

### Stripe — `STRIPE_WEBHOOK_SECRET`
1. Stripe Dashboard → Developers → Webhooks → Reveal/rotate signing secret
2. Actualizar en Netlify
3. Verificar con evento de test desde Stripe Dashboard

### Resend — `RESEND_API_KEY`
1. Resend Dashboard → API Keys → Crear nueva → Borrar la anterior
2. Actualizar en Netlify
3. Enviar email de test

### Internos — `ADMIN_PASSWORD`, `AGENT_JWT_SECRET`
1. Generar nuevo valor: `openssl rand -base64 32`
2. Actualizar en Netlify
3. Para `AGENT_JWT_SECRET`: todos los agentes deberán volver a logarse

---

## Checklist de deploy a producción

Antes de cualquier merge a `main` que afecte a variables de entorno:

- [ ] ¿Están todas las variables del inventario definidas en Netlify prod?
- [ ] ¿Se ha comprobado que `SUPABASE_SERVICE_KEY` no está en código frontend?
- [ ] ¿Se usaron keys de test durante el desarrollo?
- [ ] ¿El webhook de Stripe apunta al endpoint correcto?
- [ ] ¿`SITE_URL` coincide con el dominio actual?

---

## Historial de rotaciones

| Variable | Fecha | Motivo | Responsable |
|---|---|---|---|
| — | — | Inventario inicial creado | CEO + CODE |
