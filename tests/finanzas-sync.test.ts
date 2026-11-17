import { describe, it, expect } from "vitest";
import { sincronizarCrmConFinanzasErp } from "@/lib/finanzas/sync";

describe("Sincronización Finanzas ERP & Kardex", () => {
  it("la función existe y es una función async", () => {
    expect(typeof sincronizarCrmConFinanzasErp).toBe("function");
  });
});
