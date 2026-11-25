/**
 * PDF del resumen diario (25/11/2026). Pedido de Gerardo: «documento amigable y fácil de
 * entender». Por eso: números grandes arriba, qué hacer en 3 pasos, un color por tipo de
 * pendiente, tarjetas por cliente con lo justo y un botón «Abrir chat» en vez de enlaces largos.
 *
 * Usa las fuentes estándar de PDF (sin archivos): el texto se limpia a lo que esas fuentes
 * pueden dibujar (WinAnsi): tildes y ñ sí, emojis no.
 */
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { hace, type ActividadDia, type Pendiente, type TipoPendiente } from "./formato";

const BASE_CHAT = "https://crm-aliv.onrender.com/conversations/";

const TIPOS: Record<TipoPendiente, { titulo: string; corto: string; ayuda: string; color: RGB; suave: RGB }> = {
  esperando: {
    titulo: "Esperan tu respuesta",
    corto: "Esperan respuesta",
    ayuda: "El cliente escribió y nadie le contestó. Respóndeles primero.",
    color: rgb(0.13, 0.4, 0.8),
    suave: rgb(0.91, 0.95, 1),
  },
  asesor: {
    titulo: "Pidieron hablar con una persona",
    corto: "Piden una persona",
    ayuda: "El bot los pasó a una persona: escríbeles o llámalos.",
    color: rgb(0.85, 0.45, 0.05),
    suave: rgb(1, 0.95, 0.88),
  },
  por_cerrar: {
    titulo: "Por cerrar la venta",
    corto: "Por cerrar",
    ayuda: "Mostraron intención de compra en la última semana. Haz seguimiento.",
    color: rgb(0.1, 0.55, 0.3),
    suave: rgb(0.9, 0.97, 0.92),
  },
  postulante: {
    titulo: "Postulantes por contactar",
    corto: "Postulantes",
    ayuda: "Respondieron al anuncio de empleo.",
    color: rgb(0.45, 0.3, 0.7),
    suave: rgb(0.95, 0.92, 1),
  },
};
const ORDEN: TipoPendiente[] = ["esperando", "asesor", "por_cerrar", "postulante"];

const NEGRO = rgb(0.12, 0.12, 0.14);
const GRIS = rgb(0.45, 0.45, 0.5);
const LINEA = rgb(0.88, 0.88, 0.9);
const MARCA = rgb(0.04, 0.42, 0.33);
const BLANCO = rgb(1, 1, 1);

// Caracteres que WinAnsi sí tiene (Latin-1 imprimible + comillas y guiones tipográficos).
const PERMITIDOS = /[ -~ -ÿ–—‘’“”•…€]/;

/** Deja solo lo que la fuente estándar puede dibujar (quita emojis y símbolos raros). */
export function textoPdf(t: string | null | undefined): string {
  return [...(t ?? "").normalize("NFC")]
    .map((c) => (c === "\n" || c === "\t" ? " " : PERMITIDOS.test(c) ? c : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recorta en la última palabra completa. */
function resumir(t: string, max: number): string {
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), max - 20))}…`;
}

function telefono(tel: string | null): string {
  const d = (tel ?? "").replace(/\D/g, "").slice(-9);
  return d ? d.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : "sin número";
}

export interface DatosPdf {
  titulo: string;
  subtitulo: string;
  pendientes: Pendiente[];
  ahora?: Date;
  /** Solo en el del administrador. */
  actividad?: ActividadDia;
  porVendedor?: { nombre: string; esperando: number; asesor: number; porCerrar: number }[];
  nombreDueno?: (ownerId: string | null) => string;
}

const ANCHO = 595.28; // A4
const ALTO = 841.89;
const M = 36; // margen
const UTIL = ANCHO - 2 * M;

class Hoja {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    readonly f: PDFFont,
    readonly fb: PDFFont
  ) {
    this.nueva();
  }
  nueva() {
    this.page = this.doc.addPage([ANCHO, ALTO]);
    this.y = ALTO - M;
  }
  /** Si no caben `alto` puntos, pasa a otra página. */
  cabe(alto: number) {
    if (this.y - alto < M + 14) this.nueva();
  }
  ancho(t: string, tam: number, negrita = false) {
    return (negrita ? this.fb : this.f).widthOfTextAtSize(textoPdf(t), tam);
  }
  lineas(texto: string, tam: number, ancho: number, negrita = false): string[] {
    const out: string[] = [];
    let actual = "";
    for (const p of textoPdf(texto).split(" ")) {
      const prueba = actual ? `${actual} ${p}` : p;
      if (this.ancho(prueba, tam, negrita) <= ancho || !actual) actual = prueba;
      else {
        out.push(actual);
        actual = p;
      }
    }
    if (actual) out.push(actual);
    return out;
  }
  escribir(t: string, x: number, y: number, tam: number, opts: { negrita?: boolean; color?: RGB } = {}) {
    this.page.drawText(textoPdf(t), { x, y, size: tam, font: opts.negrita ? this.fb : this.f, color: opts.color ?? NEGRO });
  }
  caja(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }
  enlace(x: number, y: number, w: number, h: number, url: string) {
    const ref = this.doc.context.register(
      this.doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, y, x + w, y + h],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
      })
    );
    this.page.node.addAnnot(ref);
  }
}

function encabezado(h: Hoja, d: DatosPdf) {
  h.caja(0, ALTO - 92, ANCHO, 92, MARCA);
  h.escribir(d.titulo, M, ALTO - 48, 21, { negrita: true, color: BLANCO });
  h.escribir(d.subtitulo, M, ALTO - 70, 10, { color: rgb(0.85, 0.95, 0.9) });
  h.y = ALTO - 92 - 22;
}

function titulo(h: Hoja, t: string) {
  h.cabe(40);
  h.y -= 14;
  h.escribir(t, M, h.y, 13, { negrita: true });
  h.y -= 12;
}

/** Fila de tarjetas con un número grande y su etiqueta. */
function tarjetas(h: Hoja, items: { valor: number; etiqueta: string; color: RGB; suave: RGB }[]) {
  if (!items.length) return;
  const sep = 10;
  const w = (UTIL - sep * (items.length - 1)) / items.length;
  const alto = 58;
  h.cabe(alto + 6);
  const y = h.y - alto;
  items.forEach((it, i) => {
    const x = M + i * (w + sep);
    h.caja(x, y, w, alto, it.suave);
    h.caja(x, y, 4, alto, it.color);
    h.escribir(String(it.valor), x + 14, y + 26, 24, { negrita: true, color: it.color });
    h.escribir(it.etiqueta, x + 14, y + 11, 9, { color: NEGRO });
  });
  h.y = y - 8;
}

function pasos(h: Hoja, cuenta: (t: TipoPendiente) => number) {
  const e = cuenta("esperando");
  const a = cuenta("asesor");
  const c = cuenta("por_cerrar");
  const lista = [
    e === 1 ? "Contesta al cliente que espera respuesta." : e ? `Contesta a los ${e} clientes que esperan respuesta (los más antiguos primero).` : "",
    a === 1 ? "Escribe o llama al cliente que pidió hablar con una persona." : a ? `Escribe o llama a los ${a} que pidieron hablar con una persona.` : "",
    c === 1 ? "Haz seguimiento al cliente que está por cerrar la venta." : c ? `Haz seguimiento a los ${c} que están por cerrar la venta.` : "",
  ].filter(Boolean);
  if (!lista.length) return;
  titulo(h, "Qué hacer mañana");
  lista.forEach((t, i) => {
    const ls = h.lineas(t, 10.5, UTIL - 30);
    h.cabe(ls.length * 14 + 6);
    h.page.drawCircle({ x: M + 9, y: h.y - 9, size: 9, color: MARCA });
    h.escribir(String(i + 1), M + 6, h.y - 12.5, 10, { negrita: true, color: BLANCO });
    ls.forEach((l, j) => h.escribir(l, M + 26, h.y - 12 - j * 14, 10.5));
    h.y -= ls.length * 14 + 8;
  });
}

function tablaVendedores(h: Hoja, filas: NonNullable<DatosPdf["porVendedor"]>) {
  if (!filas.length) return;
  titulo(h, "Pendientes por vendedor");
  const cols = [
    { t: "Vendedor", x: M + 8 },
    { t: "Esperan respuesta", x: M + 170 },
    { t: "Piden una persona", x: M + 290 },
    { t: "Por cerrar", x: M + 410 },
  ];
  h.cabe(22 * (filas.length + 1));
  h.caja(M, h.y - 20, UTIL, 20, rgb(0.95, 0.95, 0.96));
  cols.forEach((c) => h.escribir(c.t, c.x, h.y - 14, 9, { negrita: true, color: GRIS }));
  h.y -= 20;
  for (const f of filas) {
    h.page.drawLine({ start: { x: M, y: h.y }, end: { x: M + UTIL, y: h.y }, thickness: 0.5, color: LINEA });
    h.escribir(f.nombre, cols[0].x, h.y - 15, 10.5, { negrita: true });
    [f.esperando, f.asesor, f.porCerrar].forEach((n, i) =>
      h.escribir(String(n), cols[i + 1].x, h.y - 15, 10.5, { color: n ? NEGRO : GRIS })
    );
    h.y -= 22;
  }
  h.y -= 4;
}

function seccion(h: Hoja, tipo: TipoPendiente, lista: Pendiente[], ahora: Date, nombreDueno?: DatosPdf["nombreDueno"]) {
  const t = TIPOS[tipo];
  h.cabe(110);
  h.y -= 16;
  h.caja(M, h.y - 24, UTIL, 24, t.color);
  h.escribir(`${t.titulo} (${lista.length})`, M + 10, h.y - 16.5, 12, { negrita: true, color: BLANCO });
  h.y -= 24 + 14;
  h.escribir(t.ayuda, M, h.y, 9.5, { color: GRIS });
  h.y -= 8;

  for (const p of lista) {
    const detalle = p.detalle ? resumir(textoPdf(p.detalle), 170) : "";
    const ls = detalle ? h.lineas(detalle, 9.5, UTIL - 24) : [];
    const alto = 40 + ls.length * 12.5;
    h.cabe(alto + 6);
    const y0 = h.y - alto;
    h.caja(M, y0, UTIL, alto, t.suave);
    h.caja(M, y0, 3, alto, t.color);

    h.escribir(textoPdf(p.nombre) || "Sin nombre", M + 12, h.y - 16, 11, { negrita: true });
    const tel = telefono(p.telefono);
    h.escribir(tel, M + UTIL - 10 - h.ancho(tel, 10.5, true), h.y - 16, 10.5, { negrita: true, color: t.color });

    ls.forEach((l, i) => h.escribir(l, M + 12, h.y - 31 - i * 12.5, 9.5));

    const pie = [hace(p.desde, ahora), nombreDueno ? nombreDueno(p.ownerId) : ""].filter(Boolean).join("  ·  ");
    h.escribir(pie, M + 12, y0 + 8, 8.5, { color: GRIS });
    if (p.conversationId) {
      const txt = "Abrir chat >";
      const w = h.ancho(txt, 9, true);
      const x = M + UTIL - 10 - w;
      h.escribir(txt, x, y0 + 8, 9, { negrita: true, color: rgb(0.1, 0.35, 0.8) });
      h.enlace(x - 2, y0 + 4, w + 4, 14, BASE_CHAT + p.conversationId);
    }
    h.y = y0 - 6;
  }
}

/** Genera el PDF completo (sin recortar la lista) del resumen. */
export async function generarPdfResumen(d: DatosPdf): Promise<Uint8Array> {
  const ahora = d.ahora ?? new Date();
  const doc = await PDFDocument.create();
  doc.setTitle(textoPdf(d.titulo));
  doc.setAuthor("CRM Aliv Perú");
  const h = new Hoja(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  const cuenta = (t: TipoPendiente) => d.pendientes.filter((p) => p.tipo === t).length;

  encabezado(h, d);

  if (d.actividad) {
    titulo(h, "Así fue el día");
    const neutro = { color: MARCA, suave: rgb(0.93, 0.97, 0.95) };
    tarjetas(h, [
      { valor: d.actividad.chatsNuevos, etiqueta: "chats nuevos", ...neutro },
      { valor: d.actividad.mensajesClientes, etiqueta: "mensajes de clientes", ...neutro },
      { valor: d.actividad.pedidosNuevos, etiqueta: "pedidos nuevos", ...neutro },
    ]);
    const enCurso = d.actividad.etapas.filter((e) => e.n > 0);
    if (enCurso.length) {
      h.cabe(16);
      h.escribir(`Pedidos en curso: ${enCurso.map((e) => `${e.nombre} ${e.n}`).join("   ·   ")}`, M, h.y - 10, 9.5, { color: GRIS });
      h.y -= 18;
    }
  }

  titulo(h, d.actividad ? "Pendientes" : "Tus pendientes");
  const tipos = ORDEN.filter((t) => cuenta(t) > 0);
  if (!tipos.length) {
    h.escribir("Todo al día: no hay pendientes.", M, h.y - 14, 12, { negrita: true, color: MARCA });
    h.y -= 24;
  }
  tarjetas(
    h,
    tipos.map((t) => ({ valor: cuenta(t), etiqueta: TIPOS[t].corto, color: TIPOS[t].color, suave: TIPOS[t].suave }))
  );

  pasos(h, cuenta);
  if (d.porVendedor) tablaVendedores(h, d.porVendedor);

  for (const tipo of tipos) seccion(h, tipo, d.pendientes.filter((p) => p.tipo === tipo), ahora, d.nombreDueno);

  // Pie con número de página.
  const paginas = doc.getPages();
  paginas.forEach((pg, i) =>
    pg.drawText(`CRM Aliv Perú  ·  página ${i + 1} de ${paginas.length}`, { x: M, y: 18, size: 8, font: h.f, color: GRIS })
  );
  return doc.save();
}
