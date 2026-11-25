/**
 * Guía PDF de Shalom (reglas puras, sin red ni base de datos).
 *
 * El PDF del rótulo se guarda en Drive como «Nombre - #orden - fecha.pdf» (sin la clave de
 * retiro: el nombre del archivo no debe revelarla) y una imagen de la primera página se le
 * envía al cliente con una pregunta, para que responda y la ventana de 24 h siga abierta.
 */

export const MARCA_GUIA_PDF = "[GUIA_PDF:";
export const MARCA_GUIA_ENVIADA = "[GUIA_IMAGEN_ENVIADA:";

export interface DatosGuiaPdf {
  pdfId: string;
  imagenId: string;
  token: string;
}

function limpiar(t: string, max: number): string {
  return t
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * "Manuel Vertiz - 2026-11-21 - #LEG-1153.pdf": cliente, FECHA DEL PEDIDO (Lima) y orden.
 * Así en Drive quedan ordenadas por cliente y se distinguen dos pedidos del mismo cliente.
 */
export function nombreArchivoGuia(params: { cliente: string | null; numeroOrden: string; fecha?: Date | null }): string {
  const nombre = limpiar(params.cliente || "Cliente", 60) || "Cliente";
  const orden = limpiar(params.numeroOrden.replace(/^#+/, ""), 30) || "SIN-ORDEN";
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(params.fecha ?? new Date());
  return `${nombre} - ${fecha} - #${orden}.pdf`;
}

export function marcaGuiaPdf(d: DatosGuiaPdf): string {
  return `${MARCA_GUIA_PDF}${d.pdfId}|img:${d.imagenId}|t:${d.token}]`;
}

/** La última guía subida (si se resube, gana la más reciente). */
export function leerGuiaPdf(notas: string | null | undefined): DatosGuiaPdf | null {
  const re = /\[GUIA_PDF:([\w-]+)\|img:([\w-]+)\|t:([a-f0-9]{32,})\]/g;
  let m: RegExpExecArray | null;
  let ultimo: DatosGuiaPdf | null = null;
  while ((m = re.exec(notas ?? ""))) ultimo = { pdfId: m[1], imagenId: m[2], token: m[3] };
  return ultimo;
}

/** Reemplaza una marca anterior (resubida) por la nueva. */
export function notasConGuia(notas: string | null | undefined, d: DatosGuiaPdf): string {
  const sinAnterior = (notas ?? "").replace(/\n?\[GUIA_PDF:[^\]]*\]/g, "").trim();
  return `${sinAnterior ? `${sinAnterior}\n` : ""}${marcaGuiaPdf(d)}`;
}

export function guiaYaEnviada(notas: string | null | undefined, imagenId: string): boolean {
  return (notas ?? "").includes(`${MARCA_GUIA_ENVIADA}${imagenId}`);
}

/**
 * Mensaje que acompaña la imagen. Nunca lleva la clave de retiro. Termina en una pregunta
 * fácil para que el cliente conteste (eso reabre la ventana de 24 h).
 */
export function mensajeGuia(params: {
  nombre: string | null;
  numeroGuia: string | null;
  codigo: string | null;
  agencia: string | null;
}): string {
  const nombre = (params.nombre || "").trim().split(/\s+/)[0] || "";
  const lineas = [
    `¡Hola${nombre ? `, ${nombre}` : ""}! 📦 Ya está lista la guía de Shalom de tu pedido. Te dejo la foto.`,
  ];
  const datos: string[] = [];
  if (params.numeroGuia) datos.push(`• N° de orden: ${params.numeroGuia}`);
  if (params.codigo) datos.push(`• Código de orden: ${params.codigo}`);
  if (params.agencia) datos.push(`• Agencia: ${params.agencia}`);
  if (datos.length) lineas.push("", ...datos);
  lineas.push(
    "",
    "Cuando llegue a la agencia te aviso por aquí con el saldo y tu clave de retiro.",
    "",
    "¿Lo vas a recoger tú o alguien más? Si es otra persona, pásame su nombre y DNI 🙌"
  );
  return lineas.join("\n");
}

/** Revisa que el archivo sea un PDF de verdad (cabecera %PDF) y de tamaño razonable. */
export function validarPdf(datos: Uint8Array, maxBytes = 8 * 1024 * 1024): string | null {
  if (datos.length === 0) return "El archivo está vacío.";
  if (datos.length > maxBytes) return "El PDF pesa más de 8 MB.";
  const cabecera = Buffer.from(datos.subarray(0, 5)).toString("latin1");
  if (cabecera !== "%PDF-") return "El archivo no es un PDF.";
  return null;
}

export interface DatosRotulo {
  numeroOrden: string | null;
  codigo: string | null;
}

/**
 * Valida lo que la IA leyó del rótulo de Shalom: el N° de orden son 8 a 10 dígitos
 * (105410411) y el código 4 letras/números (HMNJ). Lo que no calza queda en null.
 */
export function datosDeRotulo(respuesta: string): DatosRotulo | null {
  let crudo: Record<string, unknown> = {};
  try {
    const json = respuesta.match(/\{[\s\S]*\}/)?.[0];
    crudo = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
  const numero = String(crudo.numeroOrden ?? "").replace(/\D/g, "");
  const codigo = String(crudo.codigo ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const r: DatosRotulo = {
    numeroOrden: /^\d{8,10}$/.test(numero) ? numero : null,
    codigo: /^[A-Z0-9]{4}$/.test(codigo) ? codigo : null,
  };
  return r.numeroOrden || r.codigo ? r : null;
}
