import { PackageSearch } from "lucide-react";
import type { ManifiestoModulo } from "@/lib/modules/types";

/**
 * Modulo catalogo: gestiona los productos de Aliv Store (https://alivstore.shop/) con
 * sincronizacion directa en 1 clic desde Shopify (/products.json sin requerir API de pago),
 * control de stock, precios en Soles (S/) y tools deterministas para que el agente IA
 * consulte productos sin alucinar.
 */
const manifiesto: ManifiestoModulo = {
  nombre: "catalogo",
  titulo: "Catálogo Aliv",
  descripcion: "Catálogo de productos de Aliv Store (alivstore.shop) con sincronización Shopify gratuita y control de stock.",
  version: "1.0.0",
  nav: [{ etiqueta: "Catálogo", icono: PackageSearch, seccion: "Operaciones" }],
};

export default manifiesto;
