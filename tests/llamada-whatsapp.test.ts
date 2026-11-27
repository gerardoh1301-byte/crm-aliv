import { describe, it, expect } from "vitest";
import { enlaceLlamadaWhatsApp, telefonoParaWhatsApp } from "../src/lib/llamada-whatsapp";

describe("enlace de llamada por WhatsApp Web", () => {
  it("normaliza celulares peruanos con o sin 51", () => {
    expect(telefonoParaWhatsApp("+51 951 365 418")).toBe("51951365418");
    expect(telefonoParaWhatsApp("951365418")).toBe("51951365418");
    expect(telefonoParaWhatsApp("51-977-126-462")).toBe("51977126462");
  });
  it("abre el chat en WhatsApp Web", () => {
    expect(enlaceLlamadaWhatsApp("+51951365418")).toBe("https://web.whatsapp.com/send?phone=51951365418");
  });
});

import { descripcionLlamadaWhatsApp, quienLlamo } from "../src/lib/llamada-whatsapp";
describe("registro de llamadas", () => {
  it("recupera quién llamó desde la descripción", () => {
    expect(quienLlamo(descripcionLlamadaWhatsApp("Rossana Barco"))).toBe("Rossana Barco");
    expect(quienLlamo("otra cosa")).toBe("—");
  });
});
