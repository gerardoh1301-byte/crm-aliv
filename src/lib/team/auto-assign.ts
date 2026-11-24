import "server-only";
import { db } from "@/db";
import { contacts, crmSettings, teamMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assignContact } from "@/lib/contacts/assign";
import { debeRepartir, normalizarPesos, parsearJson, siguienteTurno, type Pesos } from "./round-robin";

export const AUTO_ASSIGN_ENABLED_KEY = "team.auto_assign_enabled";
export const AUTO_ASSIGN_MEMBER_ID_KEY = "team.auto_assign_member_id";
export const AUTO_ASSIGN_MODE_KEY = "team.auto_assign_mode";
/** "fixed" = todo a un asesor; "round_robin" = por turnos con pesos (mejora 10). */
export const AUTO_ASSIGN_STRATEGY_KEY = "team.auto_assign_strategy";
export const AUTO_ASSIGN_WEIGHTS_KEY = "team.auto_assign_weights";
export const AUTO_ASSIGN_RR_STATE_KEY = "team.auto_assign_rr_state";

export type AutoAssignStrategy = "fixed" | "round_robin";

export interface AutoAssignConfig {
  enabled: boolean;
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  mode: "all_inbound" | "unassigned_only";
  strategy: AutoAssignStrategy;
  /** memberId → peso 1–10 (solo asesores activos). */
  weights: Pesos;
}

async function leerSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(crmSettings).where(eq(crmSettings.key, key)).limit(1);
  return row?.value ?? null;
}

async function guardarSetting(key: string, value: string): Promise<void> {
  await db.insert(crmSettings).values({ key, value }).onConflictDoUpdate({ target: crmSettings.key, set: { value } });
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

    const strategy: AutoAssignStrategy = (await leerSetting(AUTO_ASSIGN_STRATEGY_KEY)) === "round_robin" ? "round_robin" : "fixed";
    const activos = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.active, true));
    const weights = normalizarPesos(
      parsearJson(await leerSetting(AUTO_ASSIGN_WEIGHTS_KEY), {}),
      activos.map((a) => a.id)
    );

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
      strategy,
      weights,
    };
  } catch (err) {
    console.warn("[auto-assign] Error leyendo configuración:", err);
    return {
      enabled: false,
      memberId: null,
      memberName: null,
      memberEmail: null,
      mode: "all_inbound",
      strategy: "fixed",
      weights: {},
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
  strategy?: AutoAssignStrategy;
  weights?: Pesos;
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

  if (input.strategy !== undefined) {
    await guardarSetting(AUTO_ASSIGN_STRATEGY_KEY, input.strategy === "round_robin" ? "round_robin" : "fixed");
  }
  if (input.weights !== undefined) {
    await guardarSetting(AUTO_ASSIGN_WEIGHTS_KEY, JSON.stringify(input.weights));
  }

  return getAutoAssignConfig();
}

/** Siguiente asesor de la rueda; guarda el estado para el próximo turno. */
async function siguienteAsesorPorTurno(weights: Pesos): Promise<string | null> {
  const estado = parsearJson<Record<string, number>>(await leerSetting(AUTO_ASSIGN_RR_STATE_KEY), {});
  const r = siguienteTurno(weights, estado);
  if (r.memberId) await guardarSetting(AUTO_ASSIGN_RR_STATE_KEY, JSON.stringify(r.estado));
  return r.memberId;
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
    if (!config.enabled) return false;
    const porTurnos = config.strategy === "round_robin" && Object.keys(config.weights).length > 0;
    if (!porTurnos && !config.memberId) {
      return false;
    }

    const [contact] = await db
      .select({ id: contacts.id, ownerId: contacts.ownerId, name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact) return false;

    // Por turnos: solo se reparte quien no tiene asesor de la rueda (ver debeRepartir).
    if (porTurnos) {
      if (!debeRepartir(contact.ownerId, config.weights)) return false;
      if (config.mode === "unassigned_only" && contact.ownerId && !options?.forceReassign) return false;
      const ownerId = await siguienteAsesorPorTurno(config.weights);
      if (!ownerId) return false;
      const res = await assignContact({
        contactId,
        ownerId,
        by: { type: "automation" },
        reason: "Asignación automática por turnos (round-robin con pesos)",
      });
      return res.ok;
    }

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
