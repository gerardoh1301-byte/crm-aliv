import "server-only";
import { db } from "@/db";
import { contacts, crmSettings, teamMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assignContact } from "@/lib/contacts/assign";

export const AUTO_ASSIGN_ENABLED_KEY = "team.auto_assign_enabled";
export const AUTO_ASSIGN_MEMBER_ID_KEY = "team.auto_assign_member_id";
export const AUTO_ASSIGN_MODE_KEY = "team.auto_assign_mode";

export interface AutoAssignConfig {
  enabled: boolean;
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  mode: "all_inbound" | "unassigned_only";
}

/**
 * Lee la configuración actual de asignación automática de conversaciones.
 */
export async function getAutoAssignConfig(): Promise<AutoAssignConfig> {
  try {
    const [rowEnabled] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, AUTO_ASSIGN_ENABLED_KEY))
      .limit(1);

    const [rowMember] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, AUTO_ASSIGN_MEMBER_ID_KEY))
      .limit(1);

    const [rowMode] = await db
      .select()
      .from(crmSettings)
      .where(eq(crmSettings.key, AUTO_ASSIGN_MODE_KEY))
      .limit(1);

    const enabled = rowEnabled?.value === "true";
    const memberId =
      typeof rowMember?.value === "string" && rowMember.value.trim()
        ? rowMember.value.trim()
        : null;
    const mode =
      rowMode?.value === "unassigned_only" ? "unassigned_only" : "all_inbound";

    let memberName: string | null = null;
    let memberEmail: string | null = null;

    if (memberId) {
      const [member] = await db
        .select({ name: teamMembers.name, email: teamMembers.email, active: teamMembers.active })
        .from(teamMembers)
        .where(eq(teamMembers.id, memberId))
        .limit(1);

      if (member) {
        memberName = member.name || (member.email ? member.email.split("@")[0] : null);
        memberEmail = member.email || null;
      }
    }

    return {
      enabled,
      memberId,
      memberName,
      memberEmail,
      mode,
    };
  } catch (err) {
    console.warn("[auto-assign] Error leyendo configuración:", err);
    return {
      enabled: false,
      memberId: null,
      memberName: null,
      memberEmail: null,
      mode: "all_inbound",
    };
  }
}

/**
 * Guarda o actualiza la configuración de asignación automática (solo admin).
 */
export async function saveAutoAssignConfig(input: {
  enabled: boolean;
  memberId?: string | null;
  mode?: "all_inbound" | "unassigned_only";
}): Promise<AutoAssignConfig> {
  const enabledStr = input.enabled ? "true" : "false";
  const memberIdStr = input.memberId ? input.memberId.trim() : "";
  const modeStr = input.mode === "unassigned_only" ? "unassigned_only" : "all_inbound";

  await db
    .insert(crmSettings)
    .values({ key: AUTO_ASSIGN_ENABLED_KEY, value: enabledStr })
    .onConflictDoUpdate({
      target: crmSettings.key,
      set: { value: enabledStr },
    });

  if (input.memberId !== undefined) {
    await db
      .insert(crmSettings)
      .values({ key: AUTO_ASSIGN_MEMBER_ID_KEY, value: memberIdStr })
      .onConflictDoUpdate({
        target: crmSettings.key,
        set: { value: memberIdStr },
      });
  }

  if (input.mode !== undefined) {
    await db
      .insert(crmSettings)
      .values({ key: AUTO_ASSIGN_MODE_KEY, value: modeStr })
      .onConflictDoUpdate({
        target: crmSettings.key,
        set: { value: modeStr },
      });
  }

  return getAutoAssignConfig();
}

/**
 * Aplica la asignación automática al contacto si la función está encendida.
 * Se ejecuta cada vez que entra un mensaje o conversación nueva.
 */
export async function applyAutoAssignToContact(
  contactId: string,
  options?: { forceReassign?: boolean }
): Promise<boolean> {
  try {
    const config = await getAutoAssignConfig();
    if (!config.enabled || !config.memberId) {
      return false;
    }

    const [contact] = await db
      .select({ id: contacts.id, ownerId: contacts.ownerId, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) return false;

    // Si ya está asignado a ese mismo asesor, no hacer nada
    if (contact.ownerId === config.memberId) {
      return false;
    }

    // Si el modo es solo no asignados y ya tiene un dueño diferente
    if (config.mode === "unassigned_only" && contact.ownerId && !options?.forceReassign) {
      return false;
    }

    // Realizar la asignación
    const res = await assignContact({
      contactId,
      ownerId: config.memberId,
      by: { type: "automation" },
      reason: `Asignación automática de conversaciones activada (Asesor: ${config.memberName || config.memberEmail || config.memberId})`,
    });

    return res.ok;
  } catch (err) {
    console.warn("[auto-assign] Error aplicando asignación automática:", err);
    return false;
  }
}
