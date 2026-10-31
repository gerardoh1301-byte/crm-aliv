---
name: optimizador-presupuesto
description: Revisa cada 48–72 h el rendimiento acumulado de los anuncios de Aliv Perú (CPA real con pedidos de Shopify y del chat, no solo el píxel) y propone cómo repartir el presupuesto de Meta dentro del tope semanal de la pestaña Config — escalar ganadores +20 %, mantener, pausar perdedores o pedir variantes del ganador. Úsala cuando el usuario pregunte a qué anuncio darle más presupuesto, qué pausar, cómo repartir el presupuesto, si puede escalar, o cuando la ejecute la tarea programada de lunes, miércoles y viernes. Solo propone en la pestaña Aprobaciones — nunca cambia presupuestos sola.
---

# Optimizador de presupuesto

> **Documentos del sistema** (`reglas-comerciales.md`, `decisiones-pago.md`, `tareas-nube.md`, `configuracion.md`): en la nube, carpeta `sistema-integrado/` en la raíz del repo `crm-aliv`; en la PC, `C:/Users/USER/Desktop/ECOOMERCE/SKILLS CLAUDE/sistema integrado/`.

Hace con datos de 3–7 días lo que el video llama "el cerebro mueve el presupuesto a los ganadores sin pasarse del límite". La diferencia, por regla de Gerardo: **propone y él aprueba**.

Lee primero `aliv-peru-ecommerce/references/rentabilidad.md` (semáforo, estructura según presupuesto, ritmo de escalado) y `reglas-comerciales.md`.

## Flujo

**1. Datos acumulados.** De la hoja (`1N8XO47szW0mtOKA5fOHUKzaKsJz1wMXwrX-GpysVbkE`), pestaña `Anuncios`, toma las filas de los **últimos 7 días** (si hay menos de 3 días con gasto, dilo y no propongas cambios de presupuesto). Suma por `ad_id`: gasto (F), pedidos web (J), pedidos chat (K) e ingresos (L). Umbrales: `Config!A12:C13` (CPA para escalar / pausar por producto), `Config!B2` (gasto mínimo) y `Config!B9` (tope semanal).

**2. Estado actual en Meta.** `ads_get_ad_entities` con `level=adset` y campos `id, name, campaign_name, daily_budget, effective_status` (verifica los campos con `ads_get_field_context`). Con presupuesto de campaña (CBO), toma `daily_budget` de `level=campaign`. Los montos de Meta vienen en céntimos.

**3. Clasificar cada anuncio** con lo acumulado:
- **Ganador:** CPA real ≤ CPA para escalar, con 3 o más pedidos reales → subir su conjunto **+20 %**, como máximo una vez cada 48–72 h.
- **Prometedor:** entre escalar y pausar → mantener; si lleva 5 o más días así, pedir una variante (un solo cambio: gancho, primeros 3 s, texto o miniatura) a la skill de videos o creativos.
- **Perdedor:** CPA real > CPA para pausar, o gasto > CPA para pausar sin pedidos → pausar. Antes cruza con los pedidos de Shopify de las últimas 24 h, porque el píxel atribuye tarde.
- **Sin datos:** gasto acumulado < `Config!B2` → esperar.

**4. Respetar el tope.** Suma los presupuestos diarios activos × 7 después de los cambios. Si pasa `Config!B9`, financia el aumento de los ganadores bajando o pausando perdedores; si aun así no alcanza, propone el aumento por separado como "requiere subir el tope".

**5. Proponer** en `Aprobaciones` (append en `A:I`), una fila por cambio, sin repetir propuestas que ya estén pendientes:
`[fecha, "O-AAAAMMDD-n", "presupuesto"|"pausa"|"variante", "Subir C.A-5 de S/30 a S/36/día", "AD-05: 7 pedidos reales en 7 días, CPA S/9,10 (escalar ≤ S/8 → amarillo alto)", "+S/42/semana", "pendiente", "", ""]`.
Máximo 2–3 cambios de presupuesto por tanda, para no reiniciar el aprendizaje de Meta.

**6. Registro:** `[fecha_hora, "optimizador", "ok", "N propuestas; gasto semanal propuesto S/X de S/tope"]`.

## Lo que nunca hace

- Cambiar presupuestos, activar o pausar desde una tarea programada. Las propuestas aprobadas las aplica `director-crecimiento` en una conversación, con el "sí" de Gerardo en el chat.
- Decidir con un solo día de datos ni solo con el píxel.
- Proponer gasto por encima del tope sin marcarlo como tal.
