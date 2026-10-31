#!/usr/bin/env python3
"""Genera los pasos para dejar lista la hoja "Sistema integrado Aliv Peru" desde una hoja vacia.

Uso:
    python hoja_inicial.py > pasos.json

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
       "Decisiones_pago": 105, "Aprobaciones": 106, "Competencia": 107, "Registro": 108, "Config": 109}
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
]


def rango(hoja, fila0, fila1, col0, col1):
    return {"sheetId": IDS[hoja], "startRowIndex": fila0, "endRowIndex": fila1,
            "startColumnIndex": col0, "endColumnIndex": col1}


def formato_numero(hoja, col0, col1, patron, tipo="NUMBER"):
    return {"repeatCell": {"range": rango(hoja, 1, 5000, col0, col1),
                           "cell": {"userEnteredFormat": {"numberFormat": {"type": tipo, "pattern": patron}}},
                           "fields": "userEnteredFormat.numberFormat"}}


def pasos():
    req = [
        {"updateSpreadsheetProperties": {"properties": {"title": TITULO, "locale": "es_PE", "timeZone": "America/Lima"},
                                         "fields": "title,locale,timeZone"}},
        {"updateSheetProperties": {"properties": {"sheetId": 0, "title": "Resumen"}, "fields": "title"}},
    ]
    for hoja, sid in IDS.items():
        if sid == 0:
            continue
        columnas = len(ENCABEZADOS.get(hoja, CONFIG[0])) + (0 if hoja != "Config" else 1)
        req.append({"addSheet": {"properties": {"sheetId": sid, "title": hoja,
                                                "gridProperties": {"rowCount": 1000, "columnCount": max(columnas, 4),
                                                                   "frozenRowCount": 1}}}})
    for hoja in list(ENCABEZADOS) + ["Config"]:
        req.append({"repeatCell": {"range": rango(hoja, 0, 1, 0, 30),
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

    valores = [{"range": f"{hoja}!A1", "values": [cols]} for hoja, cols in ENCABEZADOS.items()]
    valores += [
        {"range": "Config!A1", "values": CONFIG},
        {"range": "Diario!P2", "values": [FORMULAS_DIARIO]},
        {"range": "Anuncios!M2", "values": [FORMULAS_ANUNCIOS]},
        {"range": "Decisiones_pago!A2", "values": DECISIONES},
        {"range": "Resumen!A1", "values": RESUMEN},
    ]
    return {"update_spreadsheet": req, "update_values": valores}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # en Windows la consola no es UTF-8
    print(json.dumps(pasos(), ensure_ascii=False, indent=1))
