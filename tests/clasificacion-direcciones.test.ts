import { describe, it, expect } from "vitest";
import { extraerDatosFormularioShopify } from "../src/lib/shopify/form-extractor";

describe("Clasificación de direcciones Lima vs Provincia (16 casos de auditoría)", () => {
  it("1. San Martín de Porres / Lima -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "San Martín de Porres", province: "Lima", address1: "Av. Perú 123" },
    });
    expect(res.esProvincia).toBe(false);
    expect(res.ciudad).toBe("Lima");
  });

  it("2. San Martin de Porres sin tilde / Lima -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "San Martin de Porres", province: "Lima", address1: "Av. Habich 456" },
    });
    expect(res.esProvincia).toBe(false);
    expect(res.ciudad).toBe("Lima");
  });

  it("3. San Martín de Porres por EasySell (note_attributes) -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Lima", address1: "Jr. Huandoy 789" },
      note_attributes: [{ name: "distrito", value: "San Martín de Porres" }],
    });
    expect(res.esProvincia).toBe(false);
    expect(res.distrito).toBe("San Martín de Porres");
  });

  it("4. SMP abreviado -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "SMP", province: "Lima", address1: "Av. Canta Callao 100" },
    });
    expect(res.esProvincia).toBe(false);
  });

  it("5. Miraflores / Lima -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Miraflores", province: "Lima", address1: "Av. Larco 500" },
    });
    expect(res.esProvincia).toBe(false);
    expect(res.ciudad).toBe("Lima");
    expect(res.distrito).toBe("Miraflores");
  });

  it("6. Bellavista / Callao -> Lima (Región Lima y Callao)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Bellavista", province: "Callao", address1: "Av. Faucett 1200" },
    });
    expect(res.esProvincia).toBe(false);
  });

  it("7. Arequipa / Arequipa (calle 'Av. Lima 123') -> Provincia", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Arequipa", province: "Arequipa", address1: "Av. Lima 123" },
    });
    expect(res.esProvincia).toBe(true);
    expect(res.ciudad).toBe("Arequipa");
  });

  it("8. Iquitos / Loreto -> Provincia", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Iquitos", province: "Loreto", address1: "Calle Prospero 321" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("9. Tarapoto / San Martín -> Provincia", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Tarapoto", province: "San Martín", address1: "Jr. San Martin 200" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("10. Moyobamba / San Martín -> Provincia", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Moyobamba", province: "San Martín", address1: "Jr. 25 de Mayo 10" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("11. Castilla / Piura -> Provincia", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Castilla", province: "Piura", address1: "Av. Guardia Civil 50" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("12. Miraflores / Arequipa (distrito homónimo) -> Provincia (B2b)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Miraflores", province: "Arequipa", address1: "Av. Progreso 300" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("13. Miraflores / Arequipa por EasySell (note_attributes) -> Provincia (B2b)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { address1: "Av. Progreso 300" },
      note_attributes: [
        { name: "departamento", value: "Arequipa" },
        { name: "distrito", value: "Miraflores" },
      ],
    });
    expect(res.esProvincia).toBe(true);
  });

  it("14. La Victoria / Lambayeque (Chiclayo - homónimo) -> Provincia (B2b)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "La Victoria", province: "Lambayeque", address1: "Av. Chinchaysuyo 100" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("15. Independencia / Áncash (Huaraz - homónimo) -> Provincia (B2b)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Independencia", province: "Áncash", address1: "Jr. Huascaran 40" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("16. Bellavista / San Martín (homónimo) -> Provincia (B2b)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Bellavista", province: "San Martín", address1: "Jr. Libertad 20" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("17. Marcona sin departamento (pedido real #1064 EasySell) -> Provincia (B2c)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Marcona", address1: "Calle Comercio 12" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("18. Abancay sin departamento -> Provincia (B2c)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Abancay", address1: "Av. Arenas 45" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("19. Jaén sin departamento -> Provincia (B2c)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Jaén", address1: "Jr. Mariscal Castilla 80" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("20. Nazca sin departamento -> Provincia (B2c)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Nazca", address1: "Calle Bolognesi 21" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("21. Tingo María sin departamento -> Provincia (B2c)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Tingo María", address1: "Av. Raimondi 100" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("22. SMP real, departamento Lima -> Lima (B2)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "San Martín de Porres", province: "Lima", address1: "Av. Habich 123" },
    });
    expect(res.esProvincia).toBe(false);
    expect(res.ciudad).toBe("Lima");
  });

  it("23. SMP sin departamento (genérico) -> Lima", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "San Martín de Porres", address1: "Av. Habich 123" },
    });
    expect(res.esProvincia).toBe(false);
    expect(res.ciudad).toBe("Lima");
  });

  // B6: Regresión de calles / AAHH 'San Martín de Porres' en provincia deben ser PROVINCIA
  it("24. Tarapoto, depto San Martín, Jr. San Martín de Porres 245 -> Provincia (B6)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Tarapoto", province: "San Martín", address1: "Jr. San Martín de Porres 245" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("25. Chiclayo, Lambayeque, Calle San Martín de Porres 110 -> Provincia (B6)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Chiclayo", province: "Lambayeque", address1: "Calle San Martín de Porres 110" },
    });
    expect(res.esProvincia).toBe(true);
  });

  it("26. Arequipa por EasySell, Av. San Martín de Porres 300 -> Provincia (B6)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Arequipa", address1: "Av. San Martín de Porres 300" },
      note_attributes: [{ name: "departamento", value: "Arequipa" }],
    });
    expect(res.esProvincia).toBe(true);
  });

  it("27. Piura por EasySell, AAHH San Martin de Porres Mz B lt 4 -> Provincia (B6)", () => {
    const res = extraerDatosFormularioShopify({
      shipping_address: { city: "Piura", address1: "AAHH San Martin de Porres Mz B lt 4" },
      note_attributes: [{ name: "departamento", value: "Piura" }],
    });
    expect(res.esProvincia).toBe(true);
  });
});
