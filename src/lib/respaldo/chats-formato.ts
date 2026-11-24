/**
 * Respaldo de chats (24/11/2026): al mover el número del bot a otro teléfono, Meta lo dejó en
 * una WABA nueva y por un rato los chats viejos no se veían. Desde entonces el CRM guarda una
 * copia diaria en Drive. Aquí solo va el formato, sin base ni red, para poder probarlo.
 */

export interface ContactoRespaldo {
  id: string;
  name: string;
  phone: string | null;
}

export interface ConversacionRespaldo {
  id: string;
  contactId: string | null;
  channel: string;
  participantName: string | null;
  participantId: string | null;
  lastMessageAt: Date | string | null;
}

export interface MensajeRespaldo {
  conversationId: string | null;
  contactId: string | null;
  direction: string;
  origin: string | null;
  type: string;
  body: string | null;
  templateName: string | null;
  createdAt: Date | string;
}

/** Fecha y hora de Lima (UTC-5, sin horario de verano) en formato AAAA-MM-DD HH:MM. */
export function horaLima(fecha: Date | string): string {
  const d = new Date(fecha);
  return new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

export function fechaLima(ahora = new Date()): string {
  return horaLima(ahora).slice(0, 10);
}

export function nombresArchivoRespaldo(fecha: string): { json: string; texto: string } {
  return { json: `chats-${fecha}.json.gz`, texto: `chats-${fecha}.txt` };
}

function quienHabla(m: MensajeRespaldo): string {
  if (m.direction === "in" || m.direction === "inbound") return "Cliente";
  if (m.origin === "agent") return "Aliv (bot)";
  if (m.origin === "template" || m.templateName) return `Aliv (plantilla ${m.templateName ?? ""})`.replace(" )", ")");
  if (m.origin === "human") return "Aliv (asesor)";
  return "Aliv";
}

function contenido(m: MensajeRespaldo): string {
  const texto = (m.body ?? "").trim();
  if (texto) return texto.replace(/\r?\n/g, "\n    ");
  return `[${m.type}]`;
}

/**
 * Texto legible para abrir en el celular si el CRM no está: un bloque por chat, del más
 * reciente al más antiguo, con los mensajes en orden y la hora de Lima.
 */
export function textoLegibleChats(datos: {
  contactos: ContactoRespaldo[];
  conversaciones: ConversacionRespaldo[];
  mensajes: MensajeRespaldo[];
  generadoEn?: Date;
}): string {
  const contactos = new Map(datos.contactos.map((c) => [c.id, c]));
  const porConv = new Map<string, MensajeRespaldo[]>();
  for (const m of datos.mensajes) {
    const clave = m.conversationId ?? `contacto:${m.contactId ?? "?"}`;
    const lista = porConv.get(clave) ?? [];
    lista.push(m);
    porConv.set(clave, lista);
  }

  const orden = [...datos.conversaciones].sort(
    (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()
  );
  const vistas = new Set<string>();
  const bloques: string[] = [];

  const bloque = (titulo: string, mensajes: MensajeRespaldo[]) => {
    const lineas = [...mensajes]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((m) => `[${horaLima(m.createdAt)}] ${quienHabla(m)}: ${contenido(m)}`);
    bloques.push(`=== ${titulo} · ${mensajes.length} mensajes ===\n${lineas.join("\n")}`);
  };

  for (const c of orden) {
    vistas.add(c.id);
    const contacto = c.contactId ? contactos.get(c.contactId) : undefined;
    const nombre = contacto?.name || c.participantName || "Sin nombre";
    const telefono = contacto?.phone || c.participantId || "";
    bloque(`${nombre}${telefono ? ` (${telefono})` : ""} · ${c.channel}`, porConv.get(c.id) ?? []);
  }
  for (const [clave, mensajes] of porConv) {
    if (vistas.has(clave)) continue;
    const contacto = mensajes[0]?.contactId ? contactos.get(mensajes[0].contactId) : undefined;
    bloque(`${contacto?.name ?? "Mensajes sin chat"}${contacto?.phone ? ` (${contacto.phone})` : ""}`, mensajes);
  }

  const cabecera = `Respaldo de chats del CRM Aliv Perú · generado ${horaLima(datos.generadoEn ?? new Date())} (hora de Lima)\n${datos.conversaciones.length} chats · ${datos.mensajes.length} mensajes\n`;
  return `${cabecera}\n${bloques.join("\n\n")}\n`;
}

/** Archivos de respaldo que ya pasaron los días a conservar (por la fecha del nombre). */
export function respaldosVencidos(nombres: string[], hoy: string, diasConservar: number): string[] {
  const limite = new Date(`${hoy}T00:00:00Z`).getTime() - diasConservar * 86_400_000;
  return nombres.filter((n) => {
    const f = /^chats-(\d{4}-\d{2}-\d{2})\./.exec(n)?.[1];
    return f ? new Date(`${f}T00:00:00Z`).getTime() < limite : false;
  });
}
