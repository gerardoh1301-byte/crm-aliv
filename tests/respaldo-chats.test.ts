import { describe, expect, it } from "vitest";
import { fechaLima, horaLima, respaldosVencidos, textoLegibleChats } from "@/lib/respaldo/chats-formato";

describe("respaldo diario de chats", () => {
  it("usa la hora de Lima", () => {
    expect(horaLima("2026-11-25T03:30:00Z")).toBe("2026-11-24 22:30");
    expect(fechaLima(new Date("2026-11-25T04:59:00Z"))).toBe("2026-11-24");
  });

  it("arma un bloque legible por chat, el más reciente primero", () => {
    const txt = textoLegibleChats({
      contactos: [
        { id: "c1", name: "Ana", phone: "+51911111111" },
        { id: "c2", name: "Luis", phone: "+51922222222" },
      ],
      conversaciones: [
        { id: "v1", contactId: "c1", channel: "whatsapp", participantName: null, participantId: null, lastMessageAt: "2026-11-20T15:00:00Z" },
        { id: "v2", contactId: "c2", channel: "whatsapp", participantName: null, participantId: null, lastMessageAt: "2026-11-24T15:00:00Z" },
      ],
      mensajes: [
        { conversationId: "v1", contactId: "c1", direction: "out", origin: "agent", type: "text", body: "Hola Ana", templateName: null, createdAt: "2026-11-20T15:01:00Z" },
        { conversationId: "v1", contactId: "c1", direction: "in", origin: null, type: "text", body: "precio?", templateName: null, createdAt: "2026-11-20T15:00:00Z" },
        { conversationId: "v2", contactId: "c2", direction: "in", origin: null, type: "image", body: null, templateName: null, createdAt: "2026-11-24T15:00:00Z" },
        { conversationId: "v2", contactId: "c2", direction: "out", origin: "template", type: "template", body: "Tu pedido llegó", templateName: "aliv_aviso_agencia_shalom", createdAt: "2026-11-24T15:05:00Z" },
      ],
      generadoEn: new Date("2026-11-25T00:00:00Z"),
    });
    expect(txt).toContain("2 chats · 4 mensajes");
    expect(txt.indexOf("Luis (+51922222222)")).toBeLessThan(txt.indexOf("Ana (+51911111111)"));
    expect(txt).toMatch(/\[2026-11-20 10:00\] Cliente: precio\?\n\[2026-11-20 10:01\] Aliv \(bot\): Hola Ana/);
    expect(txt).toContain("Cliente: [image]");
    expect(txt).toContain("Aliv (plantilla aliv_aviso_agencia_shalom): Tu pedido llegó");
  });

  it("borra solo los respaldos más viejos que los días a conservar", () => {
    const nombres = ["chats-2026-09-20.txt", "chats-2026-09-26.json.gz", "chats-2026-11-24.txt", "otro.txt"];
    expect(respaldosVencidos(nombres, "2026-11-24", 60)).toEqual(["chats-2026-09-20.txt"]);
  });
});
