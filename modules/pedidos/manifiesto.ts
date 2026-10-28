import { ShoppingBag } from "lucide-react";
import type { ManifiestoModulo } from "@/lib/modules/types";

/**
 * Modulo pedidos: gestion de ordenes Contraentrega (COD) de Aliv Store, despacho por
 * Motorizado Lima / Shalom / Olva Courier, notificacion automatica de numero de guia
 * por WhatsApp y tools para que el agente cree y consulte pedidos en el chat.
 */
const manifiesto: ManifiestoModulo = {
  nombre: "pedidos",
  titulo: "Pedidos COD",
  descripcion: "Gestión de pedidos contraentrega (COD), guías Shalom/Olva/Motorizado y seguimiento por IA.",
  version: "1.0.0",
  nav: [{ etiqueta: "Pedidos COD", icono: ShoppingBag, seccion: "Operaciones" }],
};

export default manifiesto;
