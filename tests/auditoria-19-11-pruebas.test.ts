import { describe, it, expect, vi } from "vitest";
import { resolveAliclikToken } from "@/lib/aliclik/api-client";
import { buscarAgenciaShalomCercana } from "@/lib/agencias/shalom-directorio";
import { normalizarNombreEtiqueta } from "@/lib/agent/etiquetado";
import { cleanStr } from "@/lib/tags";

describe("Auditoría 19/11 - Pruebas CRM y bot fixes", () => {
  it("B4: resolveAliclikToken no contiene token hardcodeado en repositorio", async () => {
    // Si no hay variables de entorno ni DB, debe lanzar error descriptivo en vez de usar un fallback JWT escrito en código
    const envOriginal = process.env.ALICLIK_TOKEN_INTEGRATION;
    const mcpOriginal = process.env.ALICLIK_MCP_TOKEN;
    delete process.env.ALICLIK_TOKEN_INTEGRATION;
    delete process.env.ALICLIK_MCP_TOKEN;

    await expect(resolveAliclikToken()).rejects.toThrow(/No se ha configurado el token/i);

    // Si se pasa por env, lo resuelve correctamente
    process.env.ALICLIK_TOKEN_INTEGRATION = "token_de_prueba_seguro";
    const res = await resolveAliclikToken();
    expect(res).toBe("token_de_prueba_seguro");

    if (envOriginal) process.env.ALICLIK_TOKEN_INTEGRATION = envOriginal;
    else delete process.env.ALICLIK_TOKEN_INTEGRATION;
    if (mcpOriginal) process.env.ALICLIK_MCP_TOKEN = mcpOriginal;
  });

  it("B2: normalizarNombreEtiqueta reconoce 'adelanto por verificar' diferenciándolo de 'adelanto pagado'", () => {
    expect(normalizarNombreEtiqueta("adelanto por verificar")).toBe("adelanto por verificar");
    expect(normalizarNombreEtiqueta("comprobante por verificar")).toBe("adelanto por verificar");
    expect(cleanStr("adelanto por verificar")).not.toBe(cleanStr("adelanto pagado"));
  });

  it("B5: no debe inventar Sullana si la ciudad no fue brindada", () => {
    const res = buscarAgenciaShalomCercana({
      ciudad: undefined,
      distrito: undefined,
      direccion: "Calle Los Pinos 123",
    });
    // Sin ciudad válida, no debe forzar Sullana
    if (res.mejorOpcion) {
      expect(res.mejorOpcion.nombre.toLowerCase()).not.toContain("sullana");
    }
  });
});
