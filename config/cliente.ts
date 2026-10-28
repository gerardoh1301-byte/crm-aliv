import { definirConfig } from "@/lib/config/schema";
import { plantillaEcommerce } from "./plantillas/ecommerce";
import modulos from "./modulos.json";

/**
 * CONFIGURACION DEL CLIENTE — Aliv Store (https://alivstore.shop/)
 *
 * Basada en la plantilla de nicho E-commerce con Pago Contraentrega (COD) en Peru,
 * moneda PEN (Soles Peruanos) y zona horaria America/Lima.
 */
export default definirConfig({
  ...plantillaEcommerce,
  modulos: {
    ...plantillaEcommerce.modulos,
    activos: modulos.activos,
  },
});
