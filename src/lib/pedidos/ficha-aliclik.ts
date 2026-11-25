import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { pedidosOrdenes } from "../../../modules/pedidos/tabla";
import { notificarSupervisoresCritico } from "@/lib/alerts/supervisor-alerts";
import { MARCA_FICHA_ALICLIK, debeAvisarFicha, textoFichaAliclik } from "./ficha-aliclik-reglas";

/** Manda la ficha a Gerardo si el pedido ya tiene todo para registrarlo en AliClik (una sola vez). */
export async function avisarFichaAliclik(p: typeof pedidosOrdenes.$inferSelect): Promise<void> {
  const [c] = await db
    .select({ name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, p.contactId))
    .limit(1);
  const datos = {
    numeroOrden: p.numeroOrden,
    transportadora: p.transportadora,
    modalidadPago: p.modalidadPago,
    numeroGuia: p.numeroGuia,
    codigo: p.codigoRastreo,
    clave: p.claveRecojo,
    dni: p.dniCliente,
    agencia: p.direccionEnvio,
    total: p.total,
    items: p.items,
    notas: p.notas,
    cliente: c?.name ?? null,
    telefono: c?.phone ?? null,
  };
  if (!debeAvisarFicha(datos)) return;
  // La marca va antes del envío: dos guardados seguidos no deben mandar dos fichas.
  await db
    .update(pedidosOrdenes)
    .set({ notas: `${p.notas ?? ""}
${MARCA_FICHA_ALICLIK}` })
    .where(eq(pedidosOrdenes.id, p.id));
  await notificarSupervisoresCritico({
    tipo: "shalom_preguia_pago_almacen",
    titulo: `Registrar ${p.numeroOrden} en AliClik`,
    detalle: textoFichaAliclik(datos),
    clienteNombre: c?.name,
    clienteTelefono: c?.phone,
    contactId: p.contactId,
  });
}
