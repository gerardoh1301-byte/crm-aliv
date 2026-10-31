# Cambios en el CRM (`gerardoh1301-byte/crm-aliv`, rama `sistema-integrado`)

Rama aparte: **producción no cambia hasta que la fusiones a `main`** (Render despliega `main`). Código local en `C:\Users\USER\.gemini\antigravity\scratch\builder-crm`.

## Seguridad (urgente, más que cambiar las claves)

| Problema | Riesgo | Arreglo |
|---|---|---|
| La cookie de sesión guardaba el ID del miembro sin firmar, y el ID del admin es fijo y está en el código (`modo-local.ts`) | Cualquiera que lo conozca entra como admin **sin PIN** y ve clientes, ajustes y claves | Cookie firmada con HMAC (`src/lib/sesion-local.ts`). Al desplegar, **todos vuelven a iniciar sesión una vez** |
| El PIN `aliv2026` estaba escrito en el código como clave maestra para cualquier perfil | Cambiar `ADMIN_PIN` no cerraba el acceso | Eliminado. Los PIN por defecto solo valen en modo local fuera de producción |
| `consultar_pedido` con un número buscaba `numero contiene X O contacto = este` | Un cliente que pedía "el pedido 1" podía recibir pedidos de otros clientes, con dirección | Solo devuelve pedidos del mismo cliente (mismo teléfono) |

No probé estos huecos contra el CRM en producción: salen de leer el código. Las pruebas automáticas nuevas (`tests/sesion-local.test.ts`) cubren la cookie.

## Sistema integrado

| Qué | Dónde |
|---|---|
| `GET /api/metricas` (Bearer `METRICAS_TOKEN`): métricas sin datos personales por día, canal, anuncio de origen, pedidos y salud del bot | `src/lib/metricas.ts`, `src/app/api/metricas/route.ts` |
| Alertas de chats sin respuesta hace más de 60 min, por campanita y Web Push (gratis), de 8:00 a 22:00 | `src/app/api/alertas/route.ts` (lo llaman los barridos cada 30 min) |
| `confirmar_pedido`: el cliente confirma su pedido web escribiendo primero (con o sin número) | `modules/pedidos/servidor.tsx` |
| Ofertas de NAC600 en el chat: 2 = S/189, 3 = S/199. Antes cobraba S/238 por 2 frascos | `modules/pedidos/servidor.tsx` |
| Prompt: regla de salud, "cápsulas", ofertas y flujo de confirmación | `config/plantillas/ecommerce.ts` |
| Suscripción a `comment.received` y `referral.received` (se guardan, sin respuesta automática todavía) | `src/lib/zernio/webhooks.ts`, `scripts/zernio-webhook.mjs` |

## Verificado

- `npm run typecheck` sin errores y `eslint` limpio en los archivos tocados.
- `npm test`: 55 de 56 pasan. La que falla (`tests/modo-local.test.ts`) **ya fallaba antes**: `modoLocal()` dejó de apagarse en producción en un cambio anterior. Mis cambios no dependen de ella.
- Las consultas SQL nuevas se ejecutaron contra una copia de la base embebida con datos de prueba (métricas, búsqueda por teléfono y por número). La base local quedó restaurada.
- **No verificado:** el CRM corriendo completo en local (el Postgres embebido falla con Node 24 en esta PC) ni en producción.

## Al fusionar (en este orden)

1. En Render → *Environment*, agrega `METRICAS_TOKEN` (genera uno: `openssl rand -hex 32`) y, si quieres, `SESSION_SECRET`. Sin `SESSION_SECRET` se usa `AGENT_WORKER_SECRET`.
2. Fusiona `sistema-integrado` en `main` y espera el despliegue.
3. Entra de nuevo al CRM con tu PIN (las sesiones viejas dejan de valer).
4. Después de cambiar las claves, vuelve a registrar el webhook de Zernio (`npm run zernio:webhook -- --url https://crm-aliv.onrender.com`), con el secreto nuevo y los eventos nuevos.
5. Si en *Ajustes → Agente IA* hay un prompt guardado, reemplaza al del código: pega allí las secciones nuevas de `config/plantillas/ecommerce.ts` (salud, ofertas de NAC600, confirmación de pedidos web).

## Pendiente de tu decisión

- **Provincia:** el bot no menciona el adelanto de S/20 que exige tu skill (ver `../reglas-comerciales.md`). No lo cambié hasta que decidas.
- **Archivos sin seguimiento en el repo local:** hay notas de voz de clientes (`scripts/audio*.ogg`) y scripts de prueba que no subí. Bórralos o guárdalos fuera del repo.
