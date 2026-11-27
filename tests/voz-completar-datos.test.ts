import { describe, expect, it } from "vitest";
import { construirVariablesLlamadaPedido, tieneNumeroDeCasa } from "@/lib/voice/llamar-pedido-reglas";

describe("tieneNumeroDeCasa", () => {
  it("acepta calle con número, Mz/Lt y Nro", () => {
    for (const d of ["Av. Tomas valle 917", "Mz D lt 18 chaclacayo", "Av los laureles NRO 121", "Calle zela 778; Galería Zela C8", "Jr. Fernando Faustor 361-1A Surco"]) {
      expect(tieneNumeroDeCasa(d)).toBe(true);
    }
  });
  it("rechaza direcciones sin número de casa", () => {
    for (const d of ["Calle 11 san", "agua rey", "Jr la mosqueta con Psj San Juan de Dios", "Av ucayali", "Gloria grande"]) {
      expect(tieneNumeroDeCasa(d)).toBe(false);
    }
  });
});

const base = {
  pedidoId: "p1", numeroOrden: "CHAT-0003", contactId: "c1", nombreCliente: "Laura", telefono: "+51993219399",
  productosTexto: "3x NAC600", totalSoles: 199, ciudad: "Lima", distrito: "Comas", direccion: "Calle 11 san",
  dni: null, esAgencia: false, modalidadEntregaTexto: "Contraentrega Domicilio",
};

describe("llamada para completar datos", () => {
  it("pedido confirmado: no vuelve a pedir confirmación y va al dato que falta", () => {
    const v = construirVariablesLlamadaPedido({ ...base, yaConfirmado: true, notas: "[UBICACION_GOOGLE] Sin pin del cliente." });
    expect(v.saludo_inicial).toContain("ya está confirmado");
    expect(v.saludo_inicial).toContain("un par de datos");
    expect(v.datos_faltantes_pedir).toContain("número de casa");
    expect(v.instrucciones_especificas).toContain("YA CONFIRMÓ");
    expect(v.datos_faltantes_pedir).toContain("ubicación por WhatsApp");
  });
  it("usa los pendientes y el contexto propios del pedido", () => {
    const v = construirVariablesLlamadaPedido({ ...base, yaConfirmado: true, pendientesExtra: ["el precio: 3 frascos son S/199"], contexto: "Pidió 3 por S/119." });
    expect(v.datos_faltantes_pedir.startsWith("el precio")).toBe(true);
    expect(v.instrucciones_especificas).toContain("CONTEXTO DEL CHAT: Pidió 3 por S/119.");
  });
  it("no repite la dirección si los pendientes propios ya la piden", () => {
    const v = construirVariablesLlamadaPedido({ ...base, yaConfirmado: true, pendientesExtra: ["el número de tu casa en la Calle 11"] });
    expect(v.datos_faltantes_pedir).not.toContain("la dirección exacta");
  });
  it("no pide horario si ya está en las notas", () => {
    const v = construirVariablesLlamadaPedido({ ...base, direccion: "Av. Tomas valle 917 (Ref: frente al parque)", notas: "Horario: mediodía" });
    expect(v.datos_faltantes_pedir).not.toContain("horario");
  });
  it("pedido sin confirmar mantiene el saludo de confirmación", () => {
    const v = construirVariablesLlamadaPedido(base);
    expect(v.saludo_inicial).toContain("¿Me confirmas");
  });
});
