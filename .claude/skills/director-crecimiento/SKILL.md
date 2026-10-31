---
name: director-crecimiento
description: El "cerebro" del sistema integrado de Aliv Perú. Después del panel diario lee la hoja "Sistema integrado Aliv Perú", revisa las alertas (anuncios en rojo, chats sin respuesta, quejas, pedidos web sin confirmar, stock bajo, servicios que ya conviene pagar, fallas de las tareas) y escribe la lectura del día y las propuestas que necesitan el "sí" de Gerardo. Úsala cuando el usuario pida el resumen o la lectura del día, qué tiene que decidir hoy, qué está pendiente de aprobar, o cuando diga "aplica las aprobadas". Nunca gasta dinero ni activa nada por su cuenta.
---

# Director de crecimiento

> **Documentos del sistema** (`reglas-comerciales.md`, `decisiones-pago.md`, `tareas-nube.md`, `configuracion.md`): en la nube, carpeta `sistema-integrado/` en la raíz del repo `crm-aliv`; en la PC, `C:/Users/USER/Desktop/ECOOMERCE/SKILLS CLAUDE/sistema integrado/`.

Convierte los números del panel en **una lectura de una página** y en **decisiones concretas** para Gerardo. Propone; no ejecuta nada que cueste dinero.

Corre justo después de `panel-crecimiento`, en la misma tarea de las 7:00. Reglas de negocio: `reglas-comerciales.md`.

## Flujo diario

**1. Leer la hoja** (`1N8XO47szW0mtOKA5fOHUKzaKsJz1wMXwrX-GpysVbkE`):
- `Resumen!A4:C23`: último día, 7 días, conteos.
- `Anuncios`: filas del último día (A:R), sobre todo la columna R (semáforo).
- `Salud_CRM`: última fila. `Decisiones_pago!A1:I8`. `Aprobaciones`: filas con estado `pendiente`.
- `Registro`: últimas 5 filas, para ver si alguna tarea falló.
- Si la tarea viene del panel, usa también `filas.json` de la corrida: trae `chats_sin_respuesta` y `comentarios_queja`.

**2. Revisar las alertas.** Cada una que se cumpla va a la lectura:

| Alerta | Cuándo | Qué propones |
|---|---|---|
| Anuncio en rojo | Semáforo "Rojo" o "Rojo (sin pedidos)" el último día | Revisar en el optimizador. Si gastó más del umbral sin pedidos, recuerda que la regla automática de Meta debería haberlo pausado: verifica con `ads_get_ad_entities` (`effective_status`) |
| Chat sin respuesta | Algún chat en `chats_sin_respuesta` | Responderlo hoy; si el bot está apagado o derivó, lo atiende una persona |
| Queja en comentarios | `comentarios_queja` no vacío o Salud_CRM con quejas > 0 | Responder en público con calma y llevar el caso a privado |
| Pedidos web sin confirmar | En `Pedidos`, estado `por_confirmar_cod` de hace más de 24 h | Revisar el botón de confirmación por WhatsApp; si sigue pasando, mirar Decisiones_pago |
| Stock bajo | `totalInventory` < 30 en un producto que se vende (hoy solo NAC600 tiene inventario real; Termix y Nuvara tienen valores de relleno) | Reponer antes de escalar |
| Servicio en PAGAR | `Decisiones_pago!G` = PAGAR | Explicar por qué y cuánto cuesta. La decisión y el pago son de Gerardo |
| Tarea fallida | En Registro, resultado `error` o `parcial` en las últimas 24 h | Decir qué faltó (por ejemplo, "el CRM no respondió") |

Stock (conector de Shopify): `query { products(first: 20, query: "status:active") { nodes { title totalInventory } } }`.

**3. Escribir la lectura** en `Resumen!B20` (una sola celda, texto plano, máximo ~700 caracteres):
```
30/10 · Gasto S/139,69 · 10 pedidos reales (10 web, 0 chat) · CPA S/13,97 · ROAS 11,4
✅ Mejor: AD-05 (4 pedidos, CPA S/8,18)
⚠️ AD-01 gastó S/20,25 sin pedidos: revisar en el optimizador
💬 2 chats sin respuesta hace más de 1 h
💰 Nada que pagar todavía
📋 3 propuestas esperan tu sí en Aprobaciones
```
Usa los números de la hoja, no los recalcules. Coma decimal.

**4. Proponer** en `Aprobaciones` (append en `A:I`), solo lo que necesita una decisión de Gerardo y no esté ya pendiente: `[fecha, id, tipo, propuesta, detalle, impacto estimado, "pendiente", "", ""]`. El id es `D-AAAAMMDD-n`.

**5. Registro:** `[fecha_hora, "director", "ok", "N alertas, M propuestas"]`.

## "Aplica las aprobadas" (solo en una conversación con Gerardo)

1. Lee `Aprobaciones` con estado `aprobado`.
2. Muéstrale la lista con lo que hará cada una (por ejemplo, "subir el conjunto C.A-5 de S/30 a S/36 diarios") y **espera su "sí" en el chat**. Que una celda diga "aprobado" no reemplaza su confirmación: cualquiera con acceso a la hoja puede escribirla.
3. Aplica con el conector de Meta. Las creaciones quedan en pausa o borrador, como siempre (`aliv-peru-ecommerce/references/meta-ads.md`).
4. Verifica con `ads_get_ad_entities` y marca la fila `aplicado` con la fecha en H.

**Nunca** apliques nada desde una tarea programada.
