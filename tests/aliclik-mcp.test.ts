import { describe, it, expect } from "vitest";
import { AliclikMcpClient } from "@/lib/aliclik/mcp-client";

describe("Aliclik MCP Client", () => {
  it("instancia el cliente con URL y token por defecto", () => {
    const client = new AliclikMcpClient({
      token: "test-token"
    });
    expect(client).toBeDefined();
  });

  it("agrega prefijo Bearer si no lo tiene", () => {
    const client = new AliclikMcpClient({
      token: "jwt-token-123"
    });
    // @ts-expect-error test private token
    expect(client.token).toBe("Bearer jwt-token-123");
  });

  it("conserva prefijo Bearer si ya lo tiene", () => {
    const client = new AliclikMcpClient({
      token: "Bearer jwt-token-123"
    });
    // @ts-expect-error test private token
    expect(client.token).toBe("Bearer jwt-token-123");
  });
});
