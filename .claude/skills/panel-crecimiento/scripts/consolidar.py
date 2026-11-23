#!/usr/bin/env python3
"""Arma las filas de datos de la hoja "Sistema integrado Aliv Peru" a partir de Meta Ads,
Shopify y el CRM.

Uso:
    python consolidar.py --fecha 2026-10-30 --dir <carpeta_de_la_corrida> [--salida filas.json]

Solo produce DATOS CRUDOS (lo que viene de afuera). Todo lo que se calcula -CTR, CPM,
CPA real, ROAS, semaforo por anuncio y estado de las decisiones de pago- son formulas
de la hoja que leen los umbrales de la pestana Config (ver references/hoja.md). Asi
cualquier numero se puede rastrear en la hoja y los umbrales viven en un solo lugar.

Entradas en --dir (formato en references/entradas.md); las que falten se avisan:
    meta.json       {"anuncios": [{ad_id, anuncio, campana, gasto, impresiones, clics,
                                   compras_pixel}]}
    shopify.json    {"pedidos": [{numero, creado, total, unidades, producto, ciudad,
                                  utm_content, cancelado}]}   (sin nombres ni telefonos)
    crm_dia.json    respuesta de GET /api/metricas?desde=FECHA&hasta=FECHA
    crm_7d.json     respuesta de GET /api/metricas de los 7 dias que terminan en FECHA
    crm_8s.json     respuesta de GET /api/metricas desde el lunes de hace 7 semanas hasta FECHA
                    (matriz Operacion: confirmacion y entrega AG / CE por semana y producto)

Solo libreria estandar.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

LIMA = timezone(timedelta(hours=-5))  # Peru no usa horario de verano

# Columnas de datos (las de formulas estan a la derecha y no se escriben desde aqui).
COLUMNAS = {
    "Diario": ["fecha", "gasto_meta", "impresiones", "clics", "compras_pixel", "pedidos_web",
               "ingresos_web", "pedidos_chat", "ingresos_chat", "conversaciones", "mensajes_entrantes",
               "respuestas_bot", "derivados_humano", "comentarios_compra", "actualizado"],
    "Anuncios": ["fecha", "ad_id", "anuncio", "campana", "producto", "gasto", "impresiones", "clics",
                 "compras_pixel", "pedidos_web", "pedidos_chat", "ingresos"],
    "Pedidos": ["fecha", "numero", "origen", "producto", "unidades", "total", "ciudad", "estado", "ad_id"],
    "Salud_CRM": ["fecha", "demora_webhook_p50_s", "demora_webhook_p95_s", "demora_webhook_max_s",
                  "mensajes_demora_60s", "respuesta_bot_p50_s", "respuesta_bot_p95_s", "trabajos_fallidos",
                  "errores_429", "trabajos_atascados", "mensajes_fallidos", "comentarios", "comentarios_compra",
                  "comentarios_queja", "chats_sin_respuesta"],
    # Ventana de 7 dias que termina en FECHA (crm_7d.json). Una fila por fuente + "total".
    "Embudo": ["fecha", "fuente", "chats", "bot_respondio", "siguio", "cotizado", "pidio_datos", "pedidos",
               "confirmados", "entregados", "pedidos_bot", "pedidos_equipo", "pedidos_web", "pct_bot_chats_nuevos"],
    "Rescate": ["fecha", "valor", "enviados", "respondieron"],
    # Semanas que se recalculan en cada corrida (los pedidos cambian de estado): se reemplazan.
    "Operacion": ["semana", "producto", "tipo", "recibidos", "confirmados", "entregados", "desc_confirmacion",
                  "desc_entrega", "en_curso", "ingresos_entregados", "unidades_entregadas", "flete_shalom_real",
                  "actualizado"],
}

SUMABLES_OPERACION = ["recibidos", "confirmados", "entregados", "desc_confirmacion", "desc_entrega", "en_curso",
                      "ingresos_entregados", "unidades_entregadas", "flete_shalom_real"]

FUENTES = ["anuncio", "mensaje_web", "directo", "confirmacion_web"]

# Filas fijas de Decisiones_pago (fila 2 a 5): el script llena valor (D), evaluado (H) y nota (I).
DECISIONES = ["Render Starter", "Gemini con facturación y tope", "Plantillas WhatsApp (confirmación)",
              "Zernio: cuentas extra (FB/TikTok)"]

# Para separar anuncios por producto (la hoja busca sus umbrales en Config).
PRODUCTOS = {"NAC600": ["NAC"], "TERMIX": ["TERMIX", "TOBILLERA", "HOMBRERA"]}


def leer(carpeta: Path, nombre: str, avisos: list[str]) -> dict:
    ruta = carpeta / nombre
    if not ruta.exists():
        avisos.append(f"falta {nombre}: sus columnas quedan vacias")
        return {}
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        avisos.append(f"{nombre} no es JSON valido ({err}): se ignora")
        return {}


def num(valor) -> float:
    try:
        return float(valor or 0)
    except (TypeError, ValueError):
        return 0.0


def fecha_lima(iso: str) -> str:
    """Fecha local de Lima de un timestamp ISO (Shopify lo da en UTC)."""
    momento = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return momento.astimezone(LIMA).strftime("%Y-%m-%d")


def producto_de(texto: str) -> str:
    texto = (texto or "").upper()
    for nombre, palabras in PRODUCTOS.items():
        if any(p in texto for p in palabras):
            return nombre
    return ""


def como_texto(valor) -> str:
    """Los ids de Meta tienen 18 digitos: Sheets los leeria como numero y perderia los
    ultimos (1,20250443877101E+17). El apostrofo los deja como texto."""
    valor = str(valor or "")
    return f"'{valor}" if valor else ""


def numero_corto(numero: str) -> str:
    """'#ALIV-1045' (espejo del CRM) y '#1045' (Shopify) -> '1045'."""
    return "".join(ch for ch in (numero or "") if ch.isdigit())


def decisiones(crm7: dict, fecha: str, avisos: list[str]) -> list[list]:
    """[valor, evaluado, nota] para las filas fijas, en el orden de DECISIONES."""
    if not crm7:
        avisos.append("sin crm_7d.json: las decisiones de pago no se actualizan")
        return []
    salud = crm7.get("salud", {})
    demora = salud.get("demora_webhook_seg", {})
    trabajos = salud.get("trabajos_agente", {})
    web = [p for p in crm7.get("pedidos", []) if p.get("origen") == "web"]
    pendientes = [p for p in web if p.get("estado") == "por_confirmar_cod"]
    return [
        [int(num(demora.get("mayores_60s"))) if demora.get("mensajes") else "", fecha,
         f"p95 {round(num(demora.get('p95')), 1)} s sobre {int(num(demora.get('mensajes')))} mensajes"],
        [int(num(trabajos.get("errores_limite"))), fecha,
         f"{int(num(trabajos.get('atascados')))} trabajos atascados · el plan gratis usa los chats para entrenar"],
        [round(100 * len(pendientes) / len(web)) if web else "", fecha,
         f"{len(pendientes)} de {len(web)} pedidos web siguen por confirmar"],
        [int(num(crm7.get("comentarios", {}).get("compra"))), fecha,
         "solo de las cuentas conectadas hoy (WhatsApp, Instagram)"],
    ]


def embudo(crm7: dict, fecha: str, avisos: list[str]) -> tuple[list[list], list[list]]:
    """Filas de Embudo y Rescate (7 dias). El CRM las da desde 046a711 (auditoria 21/11, V6)."""
    e = crm7.get("embudo_chat", {})
    por_fuente = e.get("por_fuente")
    if not por_fuente:
        if crm7:
            avisos.append("el CRM no devuelve embudo_chat.por_fuente: Embudo queda vacio")
        return [], []
    filas = []
    tot = {k: 0 for k in ["chats", "bot_respondio", "siguio", "cotizado", "pidio_datos", "pedido", "confirmado", "entregado"]}
    for fuente in FUENTES:
        c = por_fuente.get(fuente, {})
        for k in tot:
            tot[k] += int(num(c.get(k)))
        filas.append([fecha, fuente, *(int(num(c.get(k))) for k in tot), "", "", "", ""])
    quien = e.get("pedidos_por_quien_cerro", {})
    filas.append([fecha, "total", *tot.values(), int(num(quien.get("bot"))), int(num(quien.get("equipo"))),
                  int(num(quien.get("web"))), round(num(e.get("pedidos_bot_sobre_chats_nuevos_pct")) / 100, 4)])
    rescate = [[fecha, valor, int(num(c.get("enviados"))), int(num(c.get("respondieron")))]
               for valor, c in sorted(crm7.get("rescate_chats", {}).get("por_valor", {}).items())]
    return filas, rescate


def lunes(fecha: str) -> str:
    d = datetime.strptime(fecha, "%Y-%m-%d")
    return (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d")


def redondeo(campo: str, valor: float):
    """Conteos enteros; soles con 2 decimales."""
    return round(valor, 2) if campo in ("ingresos_entregados", "flete_shalom_real") else int(round(valor))


def operacion(crm8: dict, avisos: list[str]) -> tuple[list[list], str]:
    """Filas de Operacion (AG, CE y TOTAL por semana y producto) y la primera semana que cubren.
    El CRM las da desde la matriz operativa (22/11); sin ellas la pestana no se toca."""
    filas_crm = crm8.get("operacion")
    if filas_crm is None:
        if crm8:
            avisos.append("el CRM no devuelve 'operacion': la pestana Operacion no se actualiza")
        return [], ""
    desde = lunes(crm8.get("periodo", {}).get("desde", "")) if crm8.get("periodo", {}).get("desde") else ""
    ahora = datetime.now(LIMA).strftime("%Y-%m-%d %H:%M")
    filas, totales = [], {}
    for f in filas_crm:
        if desde and f.get("semana", "") < desde:
            continue  # semana incompleta al inicio del rango: no se pisa la fila completa que ya existe
        filas.append([f["semana"], f["producto"], f["tipo"], *(redondeo(k, num(f.get(k))) for k in SUMABLES_OPERACION), ahora])
        t = totales.setdefault((f["semana"], f["producto"]), {k: 0.0 for k in SUMABLES_OPERACION})
        for k in SUMABLES_OPERACION:
            t[k] += num(f.get(k))
    for (semana, producto), t in totales.items():
        filas.append([semana, producto, "TOTAL", *(redondeo(k, t[k]) for k in SUMABLES_OPERACION), ahora])
    orden_tipo = {"AG": 0, "CE": 1, "TOTAL": 2}
    filas.sort(key=lambda r: (r[0], r[1], orden_tipo.get(r[2], 9)))
    return filas, (filas[0][0] if filas else "")


def consolidar(fecha: str, carpeta: Path) -> dict:
    avisos: list[str] = []
    meta = leer(carpeta, "meta.json", avisos)
    shopify = leer(carpeta, "shopify.json", avisos)
    crm = leer(carpeta, "crm_dia.json", avisos)
    crm7 = leer(carpeta, "crm_7d.json", avisos)
    crm8 = leer(carpeta, "crm_8s.json", avisos)

    anuncios = meta.get("anuncios", [])
    pedidos_shop = [p for p in shopify.get("pedidos", []) if p.get("creado") and fecha_lima(p["creado"]) == fecha]
    otros = len(shopify.get("pedidos", [])) - len(pedidos_shop)
    if otros:
        avisos.append(f"{otros} pedidos de Shopify son de otra fecha (hora Lima): no se cuentan")
    validos_shop = [p for p in pedidos_shop if not p.get("cancelado")]

    pedidos_crm = crm.get("pedidos", [])
    estado_crm_web = {numero_corto(p.get("numero", "")): p.get("estado") for p in pedidos_crm if p.get("origen") == "web"}
    chat = [p for p in pedidos_crm if p.get("origen") == "chat" and p.get("estado") != "cancelado"]

    filas_anuncios = []
    for a in anuncios:
        ad_id = str(a.get("ad_id", ""))
        web_ad = [p for p in validos_shop if str(p.get("utm_content", "")) == ad_id]
        chat_ad = [p for p in chat if str(p.get("ad_id") or "") == ad_id]
        filas_anuncios.append([
            fecha, como_texto(ad_id), a.get("anuncio", ""), a.get("campana", ""),
            producto_de(f"{a.get('anuncio', '')} {a.get('campana', '')}"),
            round(num(a.get("gasto")), 2), int(num(a.get("impresiones"))), int(num(a.get("clics"))),
            int(num(a.get("compras_pixel"))), len(web_ad), len(chat_ad),
            round(sum(num(p.get("total")) for p in web_ad + chat_ad), 2),
        ])

    filas_pedidos = []
    for p in pedidos_shop:
        estado = "cancelado" if p.get("cancelado") else estado_crm_web.get(numero_corto(p.get("numero", "")), "sin dato CRM")
        filas_pedidos.append([fecha, p.get("numero", ""), "web", p.get("producto", ""), int(num(p.get("unidades"))),
                              round(num(p.get("total")), 2), p.get("ciudad", ""), estado,
                              como_texto(p.get("utm_content"))])
    for p in chat:
        filas_pedidos.append([fecha, p.get("numero", ""), "chat", p.get("producto", ""), int(num(p.get("unidades"))),
                              round(num(p.get("total")), 2), p.get("ciudad", ""), p.get("estado", ""),
                              como_texto(p.get("ad_id"))])

    dia = next((d for d in crm.get("por_dia", []) if d.get("fecha") == fecha), {})
    fila_diario = [
        fecha,
        round(sum(num(a.get("gasto")) for a in anuncios), 2),
        int(sum(num(a.get("impresiones")) for a in anuncios)),
        int(sum(num(a.get("clics")) for a in anuncios)),
        int(sum(num(a.get("compras_pixel")) for a in anuncios)),
        len(validos_shop), round(sum(num(p.get("total")) for p in validos_shop), 2),
        len(chat), round(sum(num(p.get("total")) for p in chat), 2),
        int(num(dia.get("conversaciones_nuevas"))), int(num(dia.get("mensajes_entrantes"))),
        int(num(dia.get("respuestas_agente"))), int(num(dia.get("derivados_humano"))),
        int(num(crm.get("comentarios", {}).get("compra"))),
        datetime.now(LIMA).strftime("%Y-%m-%d %H:%M"),
    ]

    s = crm.get("salud", {})
    d, r, t = s.get("demora_webhook_seg", {}), s.get("respuesta_agente_seg", {}), s.get("trabajos_agente", {})
    c = crm.get("comentarios", {})
    fila_salud = [
        fecha, round(num(d.get("p50")), 1), round(num(d.get("p95")), 1), round(num(d.get("maximo")), 1),
        int(num(d.get("mayores_60s"))), round(num(r.get("p50")), 1), round(num(r.get("p95")), 1),
        int(num(t.get("fallidos"))), int(num(t.get("errores_limite"))), int(num(t.get("atascados"))),
        int(num(s.get("mensajes_salientes_fallidos"))), int(num(c.get("total"))), int(num(c.get("compra"))),
        int(num(c.get("queja"))), len(crm.get("sin_respuesta", [])),
    ]

    filas_embudo, filas_rescate = embudo(crm7, fecha, avisos)
    filas_operacion, operacion_desde = operacion(crm8, avisos)

    return {
        "fecha": fecha,
        "columnas": COLUMNAS,
        "Diario": [fila_diario],
        "Anuncios": filas_anuncios,
        "Pedidos": filas_pedidos,
        "Salud_CRM": [fila_salud] if crm else [],
        "Decisiones_pago": decisiones(crm7, fecha, avisos),
        "Embudo": filas_embudo,
        "Rescate": filas_rescate,
        # Reemplaza en la hoja todas las filas con semana >= operacion_desde (ver SKILL.md, paso 5).
        "Operacion": filas_operacion,
        "operacion_desde": operacion_desde,
        # Revision de los lunes: 10 chats cotizados que no compraron (solo id y ultimo mensaje).
        "perdidos_para_revisar": crm7.get("embudo_chat", {}).get("perdidos_para_revisar", []),
        # Para el resumen del director: casos que piden atencion de una persona.
        "chats_sin_respuesta": crm.get("sin_respuesta", []),
        "comentarios_queja": c.get("ejemplos", []) if c.get("queja") else [],
        "avisos": avisos,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fecha", required=True, help="YYYY-MM-DD (hora de Lima)")
    parser.add_argument("--dir", required=True, type=Path, help="carpeta con meta.json, shopify.json, crm_*.json")
    parser.add_argument("--salida", type=Path, help="archivo de salida (por defecto <dir>/filas.json)")
    args = parser.parse_args()

    datetime.strptime(args.fecha, "%Y-%m-%d")
    resultado = consolidar(args.fecha, args.dir)
    salida = args.salida or args.dir / "filas.json"
    salida.write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.fecha}: {len(resultado['Anuncios'])} anuncios, {len(resultado['Pedidos'])} pedidos -> {salida}")
    for aviso in resultado["avisos"]:
        print(f"AVISO: {aviso}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
