import { describe, expect, it } from "vitest";
import { resolverUrlMediaZernio } from "@/lib/audio/transcribe";

describe("resolverUrlMediaZernio (24/11: imágenes con ruta relativa)", () => {
  it("completa la ruta relativa con el dominio de Zernio", () => {
    expect(resolverUrlMediaZernio("/api/v1/whatsapp/media/976625018532708?accountId=abc")).toBe(
      "https://zernio.com/api/v1/whatsapp/media/976625018532708?accountId=abc"
    );
  });

  it("deja igual una URL completa", () => {
    const u = "https://cdn.example.com/a.jpg?x=1";
    expect(resolverUrlMediaZernio(u)).toBe(u);
  });

  it("acepta rutas sin barra inicial y con //", () => {
    expect(resolverUrlMediaZernio("api/v1/x")).toBe("https://zernio.com/api/v1/x");
    expect(resolverUrlMediaZernio("//zernio.com/api/v1/x")).toBe("https://zernio.com/api/v1/x");
  });
});
