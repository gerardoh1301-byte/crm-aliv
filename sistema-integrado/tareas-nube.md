# Tareas programadas en la nube (Claude Code)

Corren en los servidores de Anthropic **aunque la PC esté apagada** y **no tienen costo extra**: consumen el uso de tu plan de Claude. Se crean en [claude.ai/code/routines](https://claude.ai/code/routines) o con `/schedule` desde una sesión de Claude Code.

## Requisitos (una sola vez)

1. **Repositorio:** `gerardoh1301-byte/crm-aliv`, rama `main`, con la rama `sistema-integrado` ya fusionada. Las skills viven en `.claude/skills/` del repo, y cada corrida las carga sola.
2. **Conectores** en claude.ai: Meta Ads, Shopify y Google Sheets, **con la cuenta dueña de la hoja** (ver `configuracion.md`). Quita de cada tarea los conectores que no usa.
3. **Entorno de nube** propio (no el *Default*):
   - Acceso de red: permite `crm-aliv.onrender.com`.
   - *Network secret* para ese dominio: encabezado `Authorization: Bearer <METRICAS_TOKEN>`, el mismo valor que la variable `METRICAS_TOKEN` en Render. Si tu cuenta no tiene network secrets, usa una variable de entorno `METRICAS_TOKEN` (las ve cualquiera que use ese entorno).
4. **Modelo:** Sonnet 5.5 con esfuerzo bajo o medio. Son revisiones rutinarias y tu regla es usar el modelo más económico para eso.

## Las tres tareas

Horas en Lima. En cron, `CRON_TZ=America/Lima` delante; si el editor no lo acepta, súmale 5 horas y escríbelo en UTC. Evita la hora en punto (puede arrancar unos minutos tarde).

### 1. Panel y lectura del día — todos los días 7:07
```
CRON_TZ=America/Lima 7 7 * * *
```
Prompt:
> Usa la skill panel-crecimiento para cargar el día de ayer (hora de Lima) en la hoja "Sistema integrado Aliv Perú". Después usa la skill director-crecimiento para escribir la lectura del día y las propuestas. No actives, pauses ni cambies presupuestos: solo propones en Aprobaciones. Si una fuente falla, sigue con las demás y anótalo en Registro.

### 2. Optimizador — lunes, miércoles y viernes 7:37
```
CRON_TZ=America/Lima 37 7 * * 1,3,5
```
Prompt:
> Usa la skill optimizador-presupuesto con los últimos 7 días de la hoja "Sistema integrado Aliv Perú". Solo escribe propuestas en Aprobaciones y una línea en Registro. No cambies nada en Meta.

### 3. Radar de competencia — lunes 8:07
```
CRON_TZ=America/Lima 7 8 * * 1
```
Prompt:
> Usa la skill radar-competencia para la semana. Registra en la pestaña Competencia y deja el resumen en Registro.

**Uso:** 7 + 3 + 1 = 11 corridas por semana. Si una se corta por límite de uso, márcalo en *Decisiones_pago* (fila "Plan superior de Claude").

## Lo que sigue en tu PC (no en la nube)

- Crear y editar videos e imágenes (Flow, Gemini, Remotion, CapCut): necesitan tus sesiones de Google y la PC.
- Aplicar propuestas aprobadas: en una conversación, con tu "sí" en el chat.
- WhatsApp Web y el admin de Shopify por Chrome.
