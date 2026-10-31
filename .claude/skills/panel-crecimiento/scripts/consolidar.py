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
}

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


def consolidar(fecha: str, carpeta: Path) -> dict:
    avisos: list[str] = []
    meta = leer(carpeta, "meta.json", avisos)
    shopify = leer(carpeta, "shopify.json", avisos)
    crm = leer(carpeta, "crm_dia.json", avisos)
    crm7 = leer(carpeta, "crm_7d.json", avisos)

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

    return {
        "fecha": fecha,
        "columnas": COLUMNAS,
        "Diario": [fila_diario],
        "Anuncios": filas_anuncios,
        "Pedidos": filas_pedidos,
        "Salud_CRM": [fila_salud] if crm else [],
        "Decisiones_pago": decisiones(crm7, fecha, avisos),
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
