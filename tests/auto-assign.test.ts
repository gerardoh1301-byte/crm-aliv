import { describe, it, expect, vi } from "vitest";

const fakeSettings = new Map<string, string>();

vi.mock("@/db", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (cond: any) => ({
            limit: () => {
              // Buscar en fakeSettings
              for (const [key, val] of fakeSettings.entries()) {
                return [{ key, value: val }];
              }
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (val: any) => {
          fakeSettings.set(val.key, val.value);
          return {
            onConflictDoUpdate: () => Promise.resolve(),
          };
        },
      }),
    },
  };
});

describe("Asignación Automática de Conversaciones a Asesor", () => {
  it("constantes de claves crmSettings están definidas", async () => {
    const {
      AUTO_ASSIGN_ENABLED_KEY,
      AUTO_ASSIGN_MEMBER_ID_KEY,
      AUTO_ASSIGN_MODE_KEY,
    } = await import("@/lib/team/auto-assign");

    expect(AUTO_ASSIGN_ENABLED_KEY).toBe("team.auto_assign_enabled");
    expect(AUTO_ASSIGN_MEMBER_ID_KEY).toBe("team.auto_assign_member_id");
    expect(AUTO_ASSIGN_MODE_KEY).toBe("team.auto_assign_mode");
  });

  it("permite guardar y cambiar estado de la función", async () => {
    const { saveAutoAssignConfig } = await import("@/lib/team/auto-assign");

    const memberId = "test-member-123";
    await saveAutoAssignConfig({
      enabled: true,
      memberId,
      mode: "all_inbound",
    });

    expect(fakeSettings.get("team.auto_assign_enabled")).toBe("true");
    expect(fakeSettings.get("team.auto_assign_member_id")).toBe(memberId);
    expect(fakeSettings.get("team.auto_assign_mode")).toBe("all_inbound");

    await saveAutoAssignConfig({
      enabled: false,
    });
    expect(fakeSettings.get("team.auto_assign_enabled")).toBe("false");
  });
});
