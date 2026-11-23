#!/usr/bin/env python3
"""Genera los pasos para dejar lista la hoja "Sistema integrado Aliv Peru" desde una hoja vacia.

Uso:
    python hoja_inicial.py > pasos.json                    # hoja vacia, todo
    python hoja_inicial.py --agregar-embudo > pasos.json   # hoja ya armada: solo Embudo y Rescate
    python hoja_inicial.py --agregar-operacion > pasos.json  # hoja ya armada: pestana Operacion + costos en Config

Salida: {"update_spreadsheet": [requests...], "update_values": [{range, values}...]}
  1. Enviar "update_spreadsheet" en UNA llamada (crea pestanas, congela encabezados, formatos).
  2. Enviar cada elemento de "update_values" con update_values (encabezados, Config y formulas).
Solo se corre una vez, sobre la hoja vacia. La estructura esta explicada en references/hoja.md.

Diseno: las pestanas de datos tienen columnas crudas (las llena consolidar.py) y a la
derecha columnas con ARRAYFORMULA en la fila 2 (CTR, CPA real, ROAS, semaforo). Los
umbrales viven en la pestana Config, en celdas de entrada marcadas en azul.
"""
import json
import sys

TITULO = "Sistema integrado Aliv Perú"
IDS = {"Resumen": 0, "Diario": 101, "Anuncios": 102, "Pedidos": 103, "Salud_CRM": 104,
       "Decisiones_pago": 105, "Aprobaciones": 106, "Competencia": 107, "Registro": 108, "Config": 109,
       "Embudo": 110, "Rescate": 111, "Operacion": 112}
FILAS = 1000  # filas de cada pestana; los rangos no pueden pasarse del tamano
AZUL = {"red": 0.0, "green": 0.0, "blue": 1.0}
GRIS = {"red": 0.93, "green": 0.93, "blue": 0.93}

ENCABEZADOS = {
    "Diario": ["fecha", "gasto_meta", "impresiones", "clics", "compras_pixel", "pedidos_web", "ingresos_web",
               "pedidos_chat", "ingresos_chat", "conversaciones", "mensajes_entrantes", "respuestas_bot",
               "derivados_humano", "comentarios_compra", "actualizado",
               "ctr", "cpm", "pedidos_total", "ingresos_total", "cpa_real", "roas"],
    "Anuncios": ["fecha", "ad_id", "anuncio", "campana", "producto", "gasto", "impresiones", "clics",
                 "compras_pixel", "pedidos_web", "pedidos_chat", "ingresos",
                 "ctr", "pedidos_reales", "cpa_real", "cpa_escalar", "cpa_pausar", "semaforo_del_dia"],
    "Pedidos": ["fecha", "numero", "origen", "producto", "unidades", "total", "ciudad", "estado", "ad_id"],
    "Salud_CRM": ["fecha", "demora_webhook_p50_s", "demora_webhook_p95_s", "demora_webhook_max_s",
                  "mensajes_demora_60s", "respuesta_bot_p50_s", "respuesta_bot_p95_s", "trabajos_fallidos",
                  "errores_429", "trabajos_atascados", "mensajes_fallidos", "comentarios", "comentarios_compra",
                  "comentarios_queja", "chats_sin_respuesta"],
    "Decisiones_pago": ["servicio", "costo_aprox", "medida_7_dias", "valor", "umbral_pagar", "umbral_revisar",
                        "estado", "evaluado", "nota"],
    "Aprobaciones": ["fecha", "id", "tipo", "propuesta", "detalle", "impacto_estimado", "estado", "decidido_el", "nota"],
    "Competencia": ["fecha", "pagina", "id_biblioteca", "dias_activo", "formato", "gancho", "oferta", "cta",
                    "destino", "angulo", "link", "nota"],
    "Registro": ["fecha_hora", "tarea", "resultado", "detalle"],
    # Auditoria del bot 21/11 (V6): ventana de 7 dias que termina en la fecha; fila "total" al final.
    "Embudo": ["fecha", "fuente", "chats", "bot_respondio", "siguio", "cotizado", "pidio_datos", "pedidos",
               "confirmados", "entregados", "pedidos_bot", "pedidos_equipo", "pedidos_web", "pct_bot_chats_nuevos",
               "conversion"],
    "Rescate": ["fecha", "valor", "enviados", "respondieron", "respuesta"],
    # Matriz operativa (clase CRM Driven, 22/11): por semana (lunes), producto y tipo AG / CE / TOTAL.
    "Operacion": ["semana", "producto", "tipo", "recibidos", "confirmados", "entregados", "desc_confirmacion",
                  "desc_entrega", "en_curso", "ingresos_entregados", "unidades_entregadas", "flete_shalom_real",
                  "actualizado",
                  "tasa_confirmacion", "tasa_entrega", "tasa_exito", "gasto_meta", "cpa_entregado",
                  "costo_producto", "logistica", "utilidad", "utilidad_por_entregado", "semaforo"],
}

# Formulas de fila 2 (ARRAYFORMULA): crecen solas con cada fila de datos nueva.
FORMULAS_DIARIO = [  # P2:U2
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C=0,,D2:D/C2:C),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C=0,,B2:B/C2:C*1000),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),F2:F+H2:H,))",
    "=ARRAYFORMULA(IF(LEN(A2:A),G2:G+I2:I,))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(R2:R=0,,B2:B/R2:R),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(B2:B=0,,S2:S/B2:B),))",
]
FORMULAS_ANUNCIOS = [  # M2:R2
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(G2:G=0,,H2:H/G2:G),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),J2:J+K2:K,))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(N2:N=0,,F2:F/N2:N),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IFERROR(VLOOKUP(E2:E,Config!$A$12:$C$13,2,FALSE),),))",
    "=ARRAYFORMULA(IF(LEN(A2:A),IFERROR(VLOOKUP(E2:E,Config!$A$12:$C$13,3,FALSE),),))",
    '=ARRAYFORMULA(IF(LEN(A2:A),IF(F2:F<Config!$B$2,"Sin datos",IF(P2:P="","Sin umbral",'
    'IF(N2:N=0,IF(F2:F>Q2:Q,"Rojo (sin pedidos)","Amarillo"),'
    'IF(O2:O<=P2:P,"Verde",IF(O2:O<=Q2:Q,"Amarillo","Rojo"))))),))',
]

# Operacion N2:W2. Config B18:B26 = costos y metas (filas fijas, ver CONFIG_OPERACION).
_AG = 'SUMIFS(F2:F,A2:A,A2:A,B2:B,B2:B,C2:C,"AG")'
_CE = 'SUMIFS(F2:F,A2:A,A2:A,B2:B,B2:B,C2:C,"CE")'
FORMULAS_OPERACION = [
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(D2:D=0,,E2:E/D2:D),))",   # N tasa_confirmacion
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(E2:E=0,,F2:F/E2:E),))",   # O tasa_entrega
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(D2:D=0,,F2:F/D2:D),))",   # P tasa_exito
    # Q gasto de Meta del producto en la semana, repartido por pedidos recibidos (TOTAL = todo).
    '=ARRAYFORMULA(IF(LEN(A2:A),IFERROR(SUMIFS(Anuncios!F:F,Anuncios!E:E,B2:B,Anuncios!A:A,">="&A2:A,'
    'Anuncios!A:A,"<"&(A2:A+7))*D2:D/SUMIFS(D2:D,A2:A,A2:A,B2:B,B2:B,C2:C,"<>TOTAL"),0),))',
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(F2:F=0,,Q2:Q/F2:F),))",   # R cpa_entregado
    '=ARRAYFORMULA(IF(LEN(A2:A),K2:K*IF(B2:B="NAC600",Config!$B$18,IF(B2:B="TERMIX",Config!$B$19,0)),))',  # S
    # T logistica: AG = flete Shalom real (o el de Config si falta) + S/5 AliClik; CE = costo por entrega.
    '=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C="AG",IF(L2:L>F2:F*Config!$B$20,L2:L,F2:F*Config!$B$20)+F2:F*Config!$B$21,'
    'IF(C2:C="CE",F2:F*Config!$B$22,'
    f'IF(L2:L>{_AG}*Config!$B$20,L2:L,{_AG}*Config!$B$20)+{_AG}*Config!$B$21+{_CE}*Config!$B$22)),))',
    "=ARRAYFORMULA(IF(LEN(A2:A),J2:J-S2:S-T2:T-Q2:Q,))",      # U utilidad
    "=ARRAYFORMULA(IF(LEN(A2:A),IF(F2:F=0,,U2:U/F2:F),))",   # V utilidad_por_entregado
    '=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C="TOTAL","",IF(D2:D=0,"Sin datos",'
    'IF(N2:N<IF(C2:C="AG",Config!$B$23,Config!$B$25),"Confirmación baja",IF(I2:I>0,"En curso",'
    'IF(O2:O<IF(C2:C="AG",Config!$B$24,Config!$B$26),"Entrega baja","OK"))))),))',  # W semaforo
]

CONFIG_OPERACION = [  # Config!A17:C26
    ["Costos y metas de la pestaña Operacion", "", ""],
    ["Costo unitario NAC600 (S/ por frasco)", 18, "Dato de Gerardo, 22/11/2026"],
    ["Costo unitario TERMIX (S/ por unidad)", 38.42, "Dato de Gerardo, 22/11/2026"],
    ["Flete Shalom por envío si no se registró (S/)", 10, "Estimado; el real sale de [SHALOM_FLETE] en el CRM"],
    ["Empaque + traslado AliClik por envío a agencia (S/)", 5, "ERP: S/3 empaque + S/2 traslado"],
    ["Costo logístico por entrega contra entrega (S/)", 16.5, "ERP: envío 13,50 + fulfillment 3,00"],
    ["Meta de confirmación AG (agencia)", 0.40, "Clase CRM Driven: > 40 %"],
    ["Meta de entrega AG (agencia)", 0.90, "Clase CRM Driven: > 90 %"],
    ["Meta de confirmación CE (contra entrega)", 0.80, "Clase CRM Driven: > 80 %"],
    ["Meta de entrega CE (contra entrega)", 0.65, "Clase CRM Driven: > 65 %"],
]

FORMULA_EMBUDO = "=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C=0,,H2:H/C2:C),))"  # O2
FORMULA_RESCATE = "=ARRAYFORMULA(IF(LEN(A2:A),IF(C2:C=0,,D2:D/C2:C),))"  # E2

CONFIG = [
    ["Parámetro", "Valor", "Fuente"],
    ["Gasto mínimo por anuncio para dar veredicto (S/)", 10, "Fuente: aliv-peru-ecommerce/references/meta-ads.md, ciclo de creativos"],
    ["Render: mensajes con demora > 60 s en 7 días para PAGAR", 3, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Render: mensajes con demora > 60 s en 7 días para Revisar", 1, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Gemini: errores 429 en 7 días para PAGAR", 1, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Plantillas: % de pedidos web por confirmar para PAGAR", 50, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Plantillas: % de pedidos web por confirmar para Revisar", 25, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Zernio: comentarios con intención de compra en 7 días para Revisar", 20, "Fuente: sistema integrado/decisiones-pago.md"],
    ["Tope de gasto semanal en Meta (S/) para el optimizador", 210, "Fuente: aliv-peru-ecommerce/references/rentabilidad.md (S/30 diarios). Cámbialo tú"],
    ["Umbrales de CPA real por producto (S/ por pedido real)", "", ""],
    ["Producto", "CPA para escalar", "CPA para pausar"],
    ["NAC600", 8, 16],
    ["TERMIX", 9, 13],
    ["", "", ""],
    ["Fuente de los CPA: aliv-peru-ecommerce/scripts/rentabilidad.py, escenario base, 26/10/2026. "
     "Celdas en azul = datos de entrada: cámbialos aquí y la hoja se recalcula.", "", ""],
]


def fila_decision(fila, servicio, costo, medida, pagar, revisar):
    estado = (f'=IF(D{fila}="","Sin datos",IF(AND(E{fila}<>"",D{fila}>=E{fila}),"PAGAR",'
              f'IF(AND(F{fila}<>"",D{fila}>=F{fila}),"Revisar","No hace falta")))')
    return [servicio, costo, medida, "", pagar, revisar, estado, "", ""]


DECISIONES = [
    fila_decision(2, "Render Starter", "~US$7/mes", "mensajes con demora > 60 s", "=Config!B3", "=Config!B4"),
    fila_decision(3, "Gemini con facturación y tope", "~US$3–10/mes", "errores por límite (429)", "=Config!B5", ""),
    fila_decision(4, "Plantillas WhatsApp (confirmación)", "~S/0,10 c/u", "% pedidos web por confirmar", "=Config!B6", "=Config!B7"),
    fila_decision(5, "Zernio: cuentas extra (FB/TikTok)", "según Zernio", "comentarios con intención de compra", "", "=Config!B8"),
    ["ElevenLabs Starter", "US$6/mes", "prueba de voces de AI Studio en 3 anuncios", "", "", "", "Pendiente de prueba", "", "Lo marcas tú"],
    ["Plan superior de Claude", "US$100/mes", "tareas cortadas por límite de uso", "", "", "", "Revisar a mano", "", "claude.ai/settings/usage"],
    ["Privacidad: Gemini gratis entrena con los chats", "—", "decisión, no medida", "", "", "", "Pendiente de decidir", "", "Ver decisiones-pago.md"],
]


def suma(columna, ultimos_7):
    rango = f"Diario!${columna}:${columna}"
    if ultimos_7:
        return f'=SUMIFS({rango},Diario!$A:$A,">="&($B$4-6),Diario!$A:$A,"<="&$B$4)'
    return f"=SUMIFS({rango},Diario!$A:$A,$B$4)"


INDICADORES = [("Gasto en Meta (S/)", "B"), ("Pedidos web", "F"), ("Pedidos por chat", "H"),
               ("Ingresos web (S/)", "G"), ("Ingresos por chat (S/)", "I")]

# Filas 24-26 del Resumen (auditoria del bot 21/11): ultima fila "total" de Embudo.
ULTIMO_TOTAL = 'IFERROR(INDEX(FILTER(Embudo!{c}2:{c},Embudo!B2:B="total"),COUNTIF(Embudo!B2:B,"total")),"")'
RESUMEN_EMBUDO = [
    ["Pedidos del bot / chats nuevos, 7 días (meta 10 %)", "=" + ULTIMO_TOTAL.format(c="N"), ""],
    ["Pedidos de 7 días: bot / equipo / web",
     "=" + ULTIMO_TOTAL.format(c="K") + '&" / "&' + ULTIMO_TOTAL.format(c="L") + '&" / "&' + ULTIMO_TOTAL.format(c="M"), ""],
    ["Chats nuevos de 7 días que terminaron en pedido", "=" + ULTIMO_TOTAL.format(c="O"), ""],
]

RESUMEN = [
    ["Panel de crecimiento — Aliv Perú", "", ""],
    ["Lo llenan las tareas de Claude cada mañana. Los umbrales están en la pestaña Config.", "", ""],
    ["", "", ""],
    ["Último día con datos", "=MAX(Diario!A2:A)", ""],
    ["", "", ""],
    ["Indicador", "Último día", "Últimos 7 días"],
    *[[nombre, suma(col, False), suma(col, True)] for nombre, col in INDICADORES],   # filas 7-11
    ["Pedidos totales", "=B8+B9", "=C8+C9"],                                         # 12
    ["Ingresos totales (S/)", "=B10+B11", "=C10+C11"],                               # 13
    ["CPA real (S/ por pedido)", "=IF(B12=0,0,B7/B12)", "=IF(C12=0,0,C7/C12)"],      # 14
    ["ROAS (ingresos / gasto)", "=IF(B7=0,0,B13/B7)", "=IF(C7=0,0,C13/C7)"],         # 15
    ["Conversaciones nuevas en el CRM", suma("J", False), suma("J", True)],          # 16
    ["Chats derivados a una persona", suma("M", False), suma("M", True)],            # 17
    ["Comentarios con intención de compra", suma("N", False), suma("N", True)],      # 18
    ["", "", ""],
    ["Lectura del día (la escribe el director)", "", ""],                            # 20
    ["Propuestas pendientes de aprobación", '=COUNTIF(Aprobaciones!G:G,"pendiente")', ""],
    ["Servicios marcados PAGAR", '=COUNTIF(Decisiones_pago!G:G,"PAGAR")', ""],
    ["Anuncios en rojo el último día", '=COUNTIFS(Anuncios!A:A,$B$4,Anuncios!R:R,"Rojo*")', ""],
] + RESUMEN_EMBUDO


def rango(hoja, fila0, fila1, col0, col1):
    return {"sheetId": IDS[hoja], "startRowIndex": fila0, "endRowIndex": fila1,
            "startColumnIndex": col0, "endColumnIndex": col1}


def formato_numero(hoja, col0, col1, patron, tipo="NUMBER"):
    return {"repeatCell": {"range": rango(hoja, 1, FILAS, col0, col1),
                           "cell": {"userEnteredFormat": {"numberFormat": {"type": tipo, "pattern": patron}}},
                           "fields": "userEnteredFormat.numberFormat"}}


def pasos():
    req = [
        {"updateSpreadsheetProperties": {"properties": {"title": TITULO, "locale": "es_MX", "timeZone": "America/Lima"},
                                         "fields": "title,locale,timeZone"}},
        {"updateSheetProperties": {"properties": {"sheetId": 0, "title": "Resumen"}, "fields": "title"}},
    ]
    for hoja, sid in IDS.items():
        if sid == 0:
            continue
        columnas = len(ENCABEZADOS.get(hoja, CONFIG[0])) + (0 if hoja != "Config" else 1)
        req.append({"addSheet": {"properties": {"sheetId": sid, "title": hoja,
                                                "gridProperties": {"rowCount": FILAS, "columnCount": max(columnas, 4),
                                                                   "frozenRowCount": 1}}}})
    for hoja in list(ENCABEZADOS) + ["Config"]:
        ancho = len(ENCABEZADOS[hoja]) if hoja in ENCABEZADOS else 4
        req.append({"repeatCell": {"range": rango(hoja, 0, 1, 0, ancho),
                                   "cell": {"userEnteredFormat": {"textFormat": {"bold": True},
                                                                  "backgroundColorStyle": {"rgbColor": GRIS}}},
                                   "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle"}})
    # Entradas en azul: valores de Config y estados manuales de Decisiones_pago.
    for r in (rango("Config", 1, 9, 1, 2), rango("Config", 11, 13, 1, 3), rango("Decisiones_pago", 5, 8, 6, 7)):
        req.append({"repeatCell": {"range": r, "cell": {"userEnteredFormat": {"textFormat": {"foregroundColorStyle": {"rgbColor": AZUL}}}},
                                   "fields": "userEnteredFormat.textFormat.foregroundColorStyle"}})
    req += [
        formato_numero("Diario", 0, 1, "yyyy-mm-dd", "DATE"),
        formato_numero("Diario", 1, 2, "#,##0.00"),
        formato_numero("Diario", 15, 16, "0.00%", "PERCENT"),
        formato_numero("Diario", 16, 21, "#,##0.00"),
        formato_numero("Anuncios", 0, 1, "yyyy-mm-dd", "DATE"),
        formato_numero("Anuncios", 12, 13, "0.00%", "PERCENT"),
        formato_numero("Anuncios", 14, 17, "#,##0.00"),
        formato_numero("Pedidos", 0, 1, "yyyy-mm-dd", "DATE"),
        formato_numero("Salud_CRM", 0, 1, "yyyy-mm-dd", "DATE"),
        {"repeatCell": {"range": {"sheetId": 0, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 1, "endColumnIndex": 2},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "yyyy-mm-dd"}}},
                        "fields": "userEnteredFormat.numberFormat"}},
        {"repeatCell": {"range": {"sheetId": 0, "startRowIndex": 6, "endRowIndex": 15, "startColumnIndex": 1, "endColumnIndex": 3},
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": "#,##0.00"}}},
                        "fields": "userEnteredFormat.numberFormat"}},
        # Conteos sin decimales: pedidos web/chat (filas 8-9), pedidos totales (12) y Diario!R.
        *[{"repeatCell": {"range": {"sheetId": 0, "startRowIndex": f0, "endRowIndex": f1, "startColumnIndex": 1, "endColumnIndex": 3},
                          "cell": {"userEnteredFormat": {"numberFormat": {"type": "NUMBER", "pattern": "0"}}},
                          "fields": "userEnteredFormat.numberFormat"}} for f0, f1 in ((7, 9), (11, 12))],
        formato_numero("Diario", 17, 18, "0"),
        {"repeatCell": {"range": {"sheetId": 0, "startRowIndex": 19, "endRowIndex": 20, "startColumnIndex": 1, "endColumnIndex": 2},
                        "cell": {"userEnteredFormat": {"wrapStrategy": "WRAP"}}, "fields": "userEnteredFormat.wrapStrategy"}},
        {"repeatCell": {"range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 1},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True, "fontSize": 14}}},
                        "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize"}},
        {"repeatCell": {"range": {"sheetId": 0, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 0, "endColumnIndex": 3},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat.bold"}},
        {"setDataValidation": {"range": rango("Aprobaciones", 1, 1000, 6, 7),
                               "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
                                   {"userEnteredValue": v} for v in ("pendiente", "aprobado", "rechazado", "aplicado")]},
                                   "strict": True, "showCustomUi": True}}},
        {"updateDimensionProperties": {"range": {"sheetId": 0, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1},
                                       "properties": {"pixelSize": 320}, "fields": "pixelSize"}},
        {"updateDimensionProperties": {"range": {"sheetId": IDS["Config"], "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1},
                                       "properties": {"pixelSize": 420}, "fields": "pixelSize"}},
    ]

    req += formatos_embudo()
    valores = [{"range": f"{hoja}!A1", "values": [cols]} for hoja, cols in ENCABEZADOS.items()]
    valores += [
        {"range": "Config!A1", "values": CONFIG},
        {"range": "Diario!P2", "values": [FORMULAS_DIARIO]},
        {"range": "Anuncios!M2", "values": [FORMULAS_ANUNCIOS]},
        {"range": "Decisiones_pago!A2", "values": DECISIONES},
        {"range": "Resumen!A1", "values": RESUMEN},
        {"range": "Embudo!O2", "values": [[FORMULA_EMBUDO]]},
        {"range": "Rescate!E2", "values": [[FORMULA_RESCATE]]},
    ]
    return {"update_spreadsheet": req, "update_values": valores}


def formatos_embudo():
    req = []
    for hoja in ("Embudo", "Rescate"):
        req.append({"repeatCell": {"range": rango(hoja, 0, 1, 0, len(ENCABEZADOS[hoja])),
                                   "cell": {"userEnteredFormat": {"textFormat": {"bold": True},
                                                                  "backgroundColorStyle": {"rgbColor": GRIS}}},
                                   "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle"}})
        req.append(formato_numero(hoja, 0, 1, "yyyy-mm-dd", "DATE"))
    req += [formato_numero("Embudo", 13, 15, "0.0%", "PERCENT"), formato_numero("Rescate", 4, 5, "0.0%", "PERCENT")]
    for fila in (23, 25):  # Resumen B24 y B26 en porcentaje
        req.append({"repeatCell": {"range": {"sheetId": 0, "startRowIndex": fila, "endRowIndex": fila + 1, "startColumnIndex": 1, "endColumnIndex": 2},
                                   "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0.0%"}}},
                                   "fields": "userEnteredFormat.numberFormat"}})
    return req


def pasos_embudo():
    """Para la hoja ya armada: agrega Embudo y Rescate y las filas 24-26 del Resumen."""
    req = [{"addSheet": {"properties": {"sheetId": IDS[h], "title": h,
                                        "gridProperties": {"rowCount": FILAS, "columnCount": len(ENCABEZADOS[h]),
                                                           "frozenRowCount": 1}}}}
           for h in ("Embudo", "Rescate")]
    req += formatos_embudo()
    valores = [
        {"range": "Embudo!A1", "values": [ENCABEZADOS["Embudo"]]},
        {"range": "Rescate!A1", "values": [ENCABEZADOS["Rescate"]]},
        {"range": "Embudo!O2", "values": [[FORMULA_EMBUDO]]},
        {"range": "Rescate!E2", "values": [[FORMULA_RESCATE]]},
        {"range": "Resumen!A24", "values": RESUMEN_EMBUDO},
    ]
    return {"update_spreadsheet": req, "update_values": valores}


def pasos_operacion():
    """Para la hoja ya armada: pestana Operacion, sus formulas y los costos/metas en Config A17:C26."""
    h = "Operacion"
    req = [
        {"addSheet": {"properties": {"sheetId": IDS[h], "title": h,
                                     "gridProperties": {"rowCount": FILAS, "columnCount": len(ENCABEZADOS[h]),
                                                        "frozenRowCount": 1, "frozenColumnCount": 3}}}},
        {"repeatCell": {"range": rango(h, 0, 1, 0, len(ENCABEZADOS[h])),
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True},
                                                       "backgroundColorStyle": {"rgbColor": GRIS}}},
                        "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle"}},
        formato_numero(h, 0, 1, "yyyy-mm-dd", "DATE"),
        formato_numero(h, 9, 10, "#,##0.00"),
        formato_numero(h, 11, 12, "#,##0.00"),
        formato_numero(h, 13, 16, "0%", "PERCENT"),
        formato_numero(h, 16, 22, "#,##0.00"),
        {"repeatCell": {"range": rango("Config", 17, 26, 1, 2),
                        "cell": {"userEnteredFormat": {"textFormat": {"foregroundColorStyle": {"rgbColor": AZUL}}}},
                        "fields": "userEnteredFormat.textFormat.foregroundColorStyle"}},
        {"repeatCell": {"range": rango("Config", 22, 26, 1, 2),
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "PERCENT", "pattern": "0%"}}},
                        "fields": "userEnteredFormat.numberFormat"}},
        {"repeatCell": {"range": rango("Config", 16, 17, 0, 1),
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat.bold"}},
    ]
    valores = [
        {"range": "Operacion!A1", "values": [ENCABEZADOS[h]]},
        {"range": "Operacion!N2", "values": [FORMULAS_OPERACION]},
        {"range": "Config!A17", "values": CONFIG_OPERACION},
    ]
    return {"update_spreadsheet": req, "update_values": valores}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # en Windows la consola no es UTF-8
    if "--agregar-operacion" in sys.argv:
        salida = pasos_operacion()
    elif "--agregar-embudo" in sys.argv:
        salida = pasos_embudo()
    else:
        salida = pasos()
    print(json.dumps(salida, ensure_ascii=False, indent=1))
