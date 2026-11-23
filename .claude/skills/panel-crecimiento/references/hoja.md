# Estructura de la hoja "Sistema integrado Aliv Perú"

La crea `scripts/hoja_inicial.py`. Regla de diseño: **datos crudos a la izquierda** (los escribe el panel), **fórmulas a la derecha** (`ARRAYFORMULA` en la fila 2, crecen solas) y **umbrales en Config** (celdas azules). Si cambias un umbral en Config, todas las pestañas se recalculan; no hay umbrales escondidos en scripts.

| Pestaña | Quién escribe | Columnas de datos | Columnas de fórmula |
|---|---|---|---|
| **Resumen** | fórmulas + director (B20) | — | Último día y últimos 7 días: gasto, pedidos web/chat, ingresos, CPA real, ROAS, conversaciones, derivados, comentarios de compra. Conteos de aprobaciones pendientes, servicios en PAGAR y anuncios en rojo |
| **Diario** | panel | A:O fecha … actualizado | P ctr · Q cpm · R pedidos_total · S ingresos_total · T cpa_real · U roas |
| **Anuncios** | panel | A:L fecha, ad_id … ingresos | M ctr · N pedidos_reales · O cpa_real · P cpa_escalar · Q cpa_pausar · R semaforo_del_dia |
| **Pedidos** | panel | A:I (sin nombres ni teléfonos) | — |
| **Salud_CRM** | panel | A:O demoras, errores, comentarios, chats sin respuesta | — |
| **Decisiones_pago** | panel (D, H, I) + tú (G en filas 6–8) | D valor de 7 días | E/F umbrales (de Config) · G estado |
| **Aprobaciones** | director y optimizador proponen; tú decides | A:I; G = pendiente / aprobado / rechazado / aplicado | — |
| **Competencia** | radar | A:L | — |
| **Embudo** | panel (7 días que terminan en la fecha) | A:N fecha, fuente (anuncio, mensaje_web, directo, confirmacion_web, total), chats … entregados; en la fila total, pedidos_bot / equipo / web y pct_bot_chats_nuevos | O conversion |
| **Rescate** | panel (7 días) | A:D fecha, valor ofrecido, enviados, respondieron | E respuesta |
| **Operacion** | panel (reemplaza las últimas 8 semanas en cada corrida) | A:M semana (lunes), producto, tipo AG / CE / TOTAL, recibidos, confirmados, entregados, desc_confirmacion, desc_entrega, en_curso, ingresos_entregados, unidades_entregadas, flete_shalom_real, actualizado | N tasa_confirmacion · O tasa_entrega · P tasa_exito · Q gasto_meta (de Anuncios, repartido por recibidos) · R cpa_entregado · S costo_producto · T logistica · U utilidad · V utilidad_por_entregado · W semaforo |
| **Registro** | todas las tareas | fecha_hora, tarea, resultado, detalle | — |
| **Config** | tú | B2:B9 umbrales y tope semanal · A12:C13 CPA por producto | — |

Resumen B24:B26 (auditoría del bot 21/11): pedidos del bot sobre chats nuevos (meta 10 %), pedidos de 7 días por quién cerró (bot / equipo / web) y conversión de chats nuevos. Leen la última fila `total` de Embudo.

## Config (filas fijas, las fórmulas apuntan a ellas)

| Celda | Parámetro | Valor inicial |
|---|---|---|
| B2 | Gasto mínimo por anuncio para dar veredicto (S/) | 10 |
| B3 / B4 | Render: demoras > 60 s en 7 días para PAGAR / Revisar | 3 / 1 |
| B5 | Gemini: errores 429 en 7 días para PAGAR | 1 |
| B6 / B7 | Plantillas: % de pedidos web por confirmar para PAGAR / Revisar | 50 / 25 |
| B8 | Zernio: comentarios de compra en 7 días para Revisar | 20 |
| B9 | Tope de gasto semanal en Meta (S/) para el optimizador | 210 |
| A12:C13 | CPA para escalar / pausar: NAC600 8 / 16 · TERMIX 9 / 13 | de `rentabilidad.py` |
| B18 / B19 | Costo unitario NAC600 / TERMIX (S/) | 18 / 38,42 (Gerardo, 22/11) |
| B20 | Flete Shalom por envío si no se registró (S/) | 10 |
| B21 | Empaque + traslado AliClik por envío a agencia (S/) | 5 |
| B22 | Costo logístico por entrega contra entrega (S/) | 16,5 |
| B23:B26 | Metas: confirmación AG / entrega AG / confirmación CE / entrega CE | 40 % / 90 % / 80 % / 65 % (clase CRM Driven) |

## Operacion (matriz AG / CE)

- **AG** = agencia Shalom (con adelanto); **CE** = contra entrega a domicilio (AliClik o motorizado). Lo decide el CRM por la modalidad de pago y la transportadora.
- **Confirmados** incluye los cancelados ya despachados; **desc_confirmacion** son cancelados antes de despachar y **desc_entrega** cancelados después.
- **Semáforo (W)**: «Confirmación baja» si la tasa de confirmación está bajo la meta de su tipo; «En curso» si quedan pedidos sin resolver (la tasa de entrega todavía no es final); si no, «Entrega baja» u «OK».
- **Utilidad (U)** = ingresos de entregados − costo de producto − logística − gasto de Meta asignado. Es utilidad bruta: no incluye gastos fijos ni devoluciones de flete.

## Semáforo del día (Anuncios!R)

- Gasto < Config!B2 → **Sin datos**.
- Producto sin fila en Config → **Sin umbral**.
- Sin pedidos reales: gasto > CPA para pausar → **Rojo (sin pedidos)**; si no, **Amarillo**.
- Con pedidos: CPA real ≤ escalar → **Verde**; ≤ pausar → **Amarillo**; si no → **Rojo**.

Es del **día**. Las decisiones usan 3–7 días (`optimizador-presupuesto`).

## Cuidado al escribir

- La hoja usa la región **es_MX** (coma entre argumentos, punto decimal). Con `es_ES` las fórmulas escritas con coma dan `#ERROR!`; Google no acepta `es_PE`.

- Los IDs de Meta (18 dígitos) van con apóstrofo delante (`'1202…`). `consolidar.py` ya lo hace; si escribes uno a mano, agrégalo, o Sheets lo redondea.
- Escribe solo en el rango exacto de columnas de datos (`Diario!A:O`, `Anuncios!A:L`…). Un `append_values` sobre la pestaña entera puede pisar las fórmulas.
- Las fechas van como `YYYY-MM-DD`: Sheets las convierte en fecha y las fórmulas del Resumen las comparan como fechas.
