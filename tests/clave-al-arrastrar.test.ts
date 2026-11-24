import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LINEA_RECOMPRA,
  claveYaEnviada,
  esEtapaEntregado,
  motivoParaNoEnviar,
} from "@/lib/pedidos/clave-auto-reglas";

const leer = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const shalom = { modalidadPago: "adelanto_agencia", transportadora: "Shalom", notas: null, claveRecojo: "4821" };

describe("clave al arrastrar a Entregado (mejora 6)", () => {
  it("manda la clave si es Shalom, tiene clave y nunca salió", () => {
    expect(motivoParaNoEnviar(shalom, [])).toBeNull();
  });

  it("no manda nada a pedidos contra entrega, sin clave o ya enviados", () => {
    expect(motivoParaNoEnviar({ ...shalom, modalidadPago: "contraentrega", transportadora: "AliClik" }, [])).toBe("no_shalom");
    expect(motivoParaNoEnviar({ ...shalom, claveRecojo: " " }, [])).toBe("sin_clave");
    expect(motivoParaNoEnviar({ ...shalom, notas: "x\n[CLAVE_ENVIADA_WHATSAPP:2026-11-20T10:00:00Z]" }, [])).toBe("ya_enviada");
  });

  it("reconoce la clave ya enviada en el chat, pero no un número suelto", () => {
    expect(claveYaEnviada(shalom, ["🔑 Tu clave de retiro en Shalom es: *4821*"])).toBe(true);
    expect(claveYaEnviada(shalom, ["Tu pedido cuesta S/ 48210"])).toBe(false);
    expect(claveYaEnviada(shalom, ["Tu clave es 14821"])).toBe(false);
    expect(claveYaEnviada(shalom, ["Total 4821 soles"])).toBe(false);
  });

  it("detecta la etapa Entregado por clave o por nombre", () => {
    expect(esEtapaEntregado({ key: "entregado", name: "x" })).toBe(true);
    expect(esEtapaEntregado({ key: null, name: "Entregado y Cobrado" })).toBe(true);
    expect(esEtapaEntregado({ key: "en_reparto", name: "En reparto" })).toBe(false);
  });

  it("el mensaje de la clave cierra con la invitación a recomprar, sin descuento inventado", () => {
    const src = leer("src/lib/supervisor/comandos.ts");
    expect(src).toContain("LINEA_RECOMPRA,");
    expect(LINEA_RECOMPRA).not.toMatch(/S\/|%|descuento|cup[oó]n/i);
  });

  it("solo el arrastre y la edición del deal disparan el envío", () => {
    expect(leer("src/app/api/pipeline/route.ts")).toContain("moved.changed && moved.entregado");
    expect(leer("src/app/api/deals/[id]/route.ts")).toContain("moved.changed && moved.entregado");
    expect(leer("src/lib/deals/stage.ts")).not.toContain("enviarClaveAlArrastrar");
    expect(leer("src/components/pipeline/KanbanBoard.tsx")).toContain("avisarClaveAuto(");
  });

  it("entregar la clave a mano deja la marca para no repetirla al arrastrar", () => {
    const src = leer("src/lib/supervisor/comandos.ts");
    const registrar = src.slice(src.indexOf("export async function registrarClaveEntregada"));
    expect(registrar.slice(0, 900)).toContain("TAG_CLAVE_ENVIADA");
  });
});
