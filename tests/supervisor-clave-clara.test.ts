import { describe, expect, it } from "vitest";
import fs from "node:fs";

const comandos = fs.readFileSync("src/lib/supervisor/comandos.ts", "utf8");
const deliver = fs.readFileSync("src/lib/channels/deliver.ts", "utf8");

describe("clave de retiro clara y respuestas al supervisor sin filtro de duplicados", () => {
  it("la clave sale en su propia línea, destacada", () => {
    expect(comandos).toContain("🔐 *CLAVE SECRETA DE RETIRO: ${p.claveRecojo}*");
  });
  it("el código de Shalom se llama código de rastreo y aclara que no es la clave", () => {
    expect(comandos).toContain("código de rastreo ${p.codigoRastreo} (no es la clave)");
    expect(comandos).not.toMatch(/` · código \$\{p\.codigoRastreo\}`/);
  });
  it("las respuestas al supervisor se saltan el filtro A7", () => {
    expect(comandos).toMatch(/deliverMessage\(conversationId, \{ text: texto \}, "human", \{ permitirRepetido: true \}\)/);
    expect(deliver).toContain("opts.permitirRepetido ? undefined : recentOutboundMemory.get(conversationId)");
    expect(deliver).toContain("opts.permitirRepetido ? [] : await db");
  });
});
