import { describe, it, expect } from "vitest";
import {
  construirNombreArchivoPreguia,
  elegirClave4DigitosUnica,
  SHALOM_PREGUIAS_DRIVE_FOLDER_ID,
  SHALOM_PRO_ORIGEN_FIJO,
  validarDatosIndispensablesShalomPro,
} from "@/lib/shalom-pro/clave-retiro";

describe("Flujo automático Shalom PRO + Drive + AliClik WANKLIC GROUP 2", () => {
  it("genera claves de 4 dígitos evitando claves recientes y triviales", () => {
    const usadasAyer = ["4829", "1938", "7741", "5502"];
    for (let i = 0; i < 30; i++) {
      const clave = elegirClave4DigitosUnica(usadasAyer);
      expect(clave).toMatch(/^\d{4}$/);
      expect(usadasAyer).not.toContain(clave);
      expect(clave).not.toBe("0000");
      expect(clave).not.toBe("1234");
    }
  });

  it("construye el nombre oficial del PDF con nombre, orden, fecha y 4 dígitos de clave", () => {
    const nombre = construirNombreArchivoPreguia({
      clienteNombre: "Carlos Huaynalaya / Test*",
      numeroOrden: "#1142",
      clave4Digitos: "4829",
      fechaRegistro: "2026-11-18",
    });
    expect(nombre).toBe("Carlos Huaynalaya Test - #1142 - 2026-11-18 - Clave 4829.pdf");
  });

  it("valida datos indispensables (nombre, DNI 8 dígitos y agencia localizada)", () => {
    expect(
      validarDatosIndispensablesShalomPro({
        clienteNombre: "Carlos Huaynalaya",
        dni: "20085469",
        agenciaShalom: "Shalom Jr. Ica - Huancayo",
      }).completo
    ).toBe(true);

    const faltante = validarDatosIndispensablesShalomPro({
      clienteNombre: "Cliente",
      dni: "123",
      agenciaShalom: "",
    });
    expect(faltante.completo).toBe(false);
    expect(faltante.faltantes.length).toBe(3);
  });

  it("mantiene configurados la carpeta Drive oficial y el origen fijo Raymondi", () => {
    expect(SHALOM_PREGUIAS_DRIVE_FOLDER_ID).toBe("1nh0aCCxClBGBaB4Z1NNEmBQVp-hKa1nH");
    expect(SHALOM_PRO_ORIGEN_FIJO.etiquetaCompleta).toBe("Lima, Lima, La Victoria, Raymondi");
  });
});
