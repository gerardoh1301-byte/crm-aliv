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
| **Registro** | todas las tareas | fecha_hora, tarea, resultado, detalle | — |
| **Config** | tú | B2:B9 umbrales y tope semanal · A12:C13 CPA por producto | — |

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

## Semáforo del día (Anuncios!R)

- Gasto < Config!B2 → **Sin datos**.
- Producto sin fila en Config → **Sin umbral**.
- Sin pedidos reales: gasto > CPA para pausar → **Rojo (sin pedidos)**; si no, **Amarillo**.
- Con pedidos: CPA real ≤ escalar → **Verde**; ≤ pausar → **Amarillo**; si no → **Rojo**.

Es del **día**. Las decisiones usan 3–7 días (`optimizador-presupuesto`).

## Cuidado al escribir

- Los IDs de Meta (18 dígitos) van con apóstrofo delante (`'1202…`). `consolidar.py` ya lo hace; si escribes uno a mano, agrégalo, o Sheets lo redondea.
- Escribe solo en el rango exacto de columnas de datos (`Diario!A:O`, `Anuncios!A:L`…). Un `append_values` sobre la pestaña entera puede pisar las fórmulas.
- Las fechas van como `YYYY-MM-DD`: Sheets las convierte en fecha y las fórmulas del Resumen las comparan como fechas.
