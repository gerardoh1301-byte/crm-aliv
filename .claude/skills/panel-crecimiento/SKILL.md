---
name: panel-crecimiento
description: Panel diario de Aliv Perú que cruza el gasto de Meta Ads, los pedidos reales de Shopify (por utm_content) y las métricas del CRM (chats, pedidos por chat, anuncio de origen, salud del bot) y los escribe en la hoja de Google Sheets "Sistema integrado Aliv Perú". Úsala cuando el usuario pida el panel, el resumen de la mañana, cómo le fue ayer, el CPA real, el ROAS, qué anuncio trajo ventas, cuánto vendió el bot, si conviene pagar Render, Gemini, plantillas de WhatsApp u otro servicio, o cuando la ejecute la tarea programada de las 7:00. También para dejar lista la hoja la primera vez.
---

# Panel de crecimiento

> **Documentos del sistema** (`reglas-comerciales.md`, `decisiones-pago.md`, `tareas-nube.md`, `configuracion.md`): en la nube, carpeta `sistema-integrado/` en la raíz del repo `crm-aliv`; en la PC, `C:/Users/USER/Desktop/ECOOMERCE/SKILLS CLAUDE/sistema integrado/`.

Junta tres fuentes en una hoja, sin datos personales, para que Gerardo vea cada mañana qué vendió, cuánto le costó cada pedido real y si algún servicio pagado ya vale la pena. Después de esta skill corre `director-crecimiento`, que escribe la lectura del día.

## Datos fijos

| Qué | Valor |
|---|---|
| Hoja | `1N8XO47szW0mtOKA5fOHUKzaKsJz1wMXwrX-GpysVbkE` ("Sistema integrado Aliv Perú") |
| Cuenta de Meta Ads | `1453744092152467` (PEN) |
| Tienda Shopify | alivstore.shop (zona horaria Lima, UTC−5) |
| Métricas del CRM | `https://crm-aliv.onrender.com/api/metricas` con `Authorization: Bearer <METRICAS_TOKEN>` |
| Reglas de negocio | `reglas-comerciales.md` y `decisiones-pago.md` |

## Flujo

**0. Fecha.** Por defecto, **ayer en hora de Lima**. Crea una carpeta de trabajo temporal para la corrida.

**1. Meta Ads → `meta.json`.** `ads_get_ad_entities` con `level=ad`, `time_range={"since":FECHA,"until":FECHA}`, campos `id, name, campaign_name, amount_spent, impressions, link_click, omni_purchase`, filtro `amount_spent GREATER_THAN 0`, `limit 200`. Sigue `pagination.next_cursor` si viene. Si es la primera llamada de la sesión, verifica los campos con `ads_get_field_context`. Formato en `references/entradas.md`.

**2. Shopify → `shopify.json`.** Consulta GraphQL de `references/entradas.md` (pedidos creados entre FECHA 05:00Z y FECHA+1 05:00Z). De `customAttributes` toma **solo** `utm_content`. **Nunca** guardes nombres, teléfonos ni direcciones en archivos, en la hoja ni en el resumen: el pedido trae esos datos y no se usan.

**3. CRM → `crm_dia.json` y `crm_7d.json`.**
```
curl -sS -H "Authorization: Bearer $METRICAS_TOKEN" "https://crm-aliv.onrender.com/api/metricas?desde=FECHA&hasta=FECHA" > crm_dia.json
curl -sS -H "Authorization: Bearer $METRICAS_TOKEN" "https://crm-aliv.onrender.com/api/metricas?desde=FECHA-6&hasta=FECHA" > crm_7d.json
```
En la nube el token llega como *network secret* o variable `METRICAS_TOKEN` (ver `tareas-nube.md`). El servidor gratis puede tardar ~1 min en despertar: usa `--max-time 120` y reintenta una vez. Si responde 401 o no responde, sigue sin el CRM y anótalo en *Registro*.

**4. Consolidar.**
```
python scripts/consolidar.py --fecha FECHA --dir <carpeta>
```
Produce `filas.json` con filas **crudas** por pestaña. CTR, CPM, CPA real, ROAS, semáforo y estado de las decisiones son **fórmulas de la hoja**: no los calcules ni los escribas tú.

**5. Escribir en la hoja** (conector de Google Sheets). Antes lee la guía del conector (`anthropic-skills:google-workspace`, `references/sheets.md`) si no la leíste en esta sesión.
- **Diario** (A:O): lee `Diario!A:A`; si FECHA ya existe, sobrescribe esa fila; si no, `append_values` en `Diario!A:O`.
- **Anuncios** (A:L), **Pedidos** (A:I), **Salud_CRM** (A:O): si FECHA ya aparece en la columna A, **no** vuelvas a agregar (avisa "ya cargado"); si no, `append_values` con el rango exacto de columnas. Nunca escribas en las columnas de fórmulas (a la derecha).
- **Decisiones_pago**: `filas.json["Decisiones_pago"]` trae 4 filas `[valor, evaluado, nota]` → escribe `D2:D5` (valor) y `H2:I5` (evaluado, nota). No toques E, F ni G.
- **Registro**: agrega `[fecha_hora, "panel", "ok"|"parcial"|"error", avisos]`.

**6. Verificar.** Lee `Resumen!A4:C18` y comprueba que el último día sea FECHA y que los números tengan sentido (gasto de Diario = suma de Anuncios del día). Reporta en 3 líneas: gasto, pedidos reales (web + chat), CPA real y avisos.

## Primera vez (hoja vacía)

```
python scripts/hoja_inicial.py > pasos.json
```
Envía `update_spreadsheet` en una sola llamada y luego cada elemento de `update_values`. Crea las 10 pestañas, los encabezados, las fórmulas, la pestaña **Config** (umbrales en azul) y los formatos. Estructura explicada en `references/hoja.md`.

## Reglas

- **Pedido real** = pedido de Shopify no cancelado (atribuido por `utm_content` = ID del anuncio) + pedido tomado por el bot en el chat (atribuido por el anuncio de origen del chat). El píxel de Meta va aparte y como referencia: registra menos que la realidad.
- **Un día no es veredicto.** El semáforo del día es orientativo; las decisiones de presupuesto las toma `optimizador-presupuesto` con 3–7 días.
- Si la hoja devuelve *Permission denied*, el conector de Sheets está vinculado a una cuenta sin acceso de edición: detente y avísale al usuario (ver `configuracion.md`).
