import "server-only";
import { db } from "@/db";
import { contacts, teamMembers } from "@/db/schema";
import { asc, eq, and, isNull, or, type SQL } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { COOKIE_SESION_LOCAL, ID_MIEMBRO_LOCAL, modoLocal } from "@/lib/modo-local";

export type TeamRole = "admin" | "asesor";

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  role: TeamRole;
  active: boolean;
}

function toMember(row: typeof teamMembers.$inferSelect): TeamMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "asesor",
    active: row.active,
  };
}

export function displayName(member: TeamMember | null | undefined): string {
  if (!member) return "Sin asignar";
  return member.name?.trim() || member.email.split("@")[0];
}

/**
 * Miembro del equipo de la sesion actual, o null si no hay sesion.
 */
export async function getCurrentMember(): Promise<TeamMember | null> {
  // Autenticacion por perfil/PIN (local o en la nube sin Supabase Auth)
  if (modoLocal() || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("supabase.co")) {
    let memberId: string | undefined;
    try {
      const cookieStore = await cookies();
      memberId = cookieStore.get(COOKIE_SESION_LOCAL)?.value;
    } catch {
      // Fuera de contexto HTTP
    }

    if (memberId) {
      const [row] = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, memberId), eq(teamMembers.active, true)))
        .limit(1);
      if (row) return toMember(row);
    }
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [row] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, user.id))
    .limit(1);

  if (!row || !row.active) return null;
  return toMember(row);
}

export async function listMembers(opts?: {
  onlyActive?: boolean;
}): Promise<TeamMember[]> {
  const rows = await db.select().from(teamMembers).orderBy(asc(teamMembers.createdAt));
  return rows
    .filter((r) => !opts?.onlyActive || r.active)
    .map(toMember);
}

export async function getMember(id: string): Promise<TeamMember | null> {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);
  return row ? toMember(row) : null;
}

/**
 * Condicion SQL de visibilidad sobre `contacts`. `undefined` = sin filtro (admin).
 */
export function ownerFilter(member: TeamMember): SQL | undefined {
  if (member.role === "admin") return undefined;
  return or(eq(contacts.ownerId, member.id), isNull(contacts.ownerId));
}

export function visibleOwnerId(member: TeamMember): string | undefined {
  return member.role === "admin" ? undefined : member.id;
}

export function canAccessContact(
  member: TeamMember,
  contact: { ownerId: string | null }
): boolean {
  return member.role === "admin" || contact.ownerId === member.id || contact.ownerId === null;
}

export async function canAccessContactId(
  member: TeamMember,
  contactId: string
): Promise<boolean> {
  if (member.role === "admin") return true;
  const [row] = await db
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  return Boolean(row) && (row.ownerId === member.id || row.ownerId === null);
}

export async function hayMiembros(): Promise<boolean> {
  const [row] = await db.select({ id: teamMembers.id }).from(teamMembers).limit(1);
  return Boolean(row);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export async function findMemberByName(
  query: string
): Promise<
  | { status: "found"; member: TeamMember }
  | { status: "ambiguous"; candidates: TeamMember[] }
  | { status: "not_found"; available: TeamMember[] }
> {
  const members = await listMembers({ onlyActive: true });
  const q = normalize(query);
  if (!q) return { status: "not_found", available: members };

  const exact = members.filter(
    (m) => normalize(m.name ?? "") === q || normalize(m.email) === q
  );
  if (exact.length === 1) return { status: "found", member: exact[0] };

  const partial = members.filter((m) => {
    const name = normalize(m.name ?? "");
    const emailUser = normalize(m.email.split("@")[0]);
    return (
      name.includes(q) ||
      (q.includes(name) && name.length > 2) ||
      emailUser === q ||
      name.split(" ").some((part) => part === q)
    );
  });

  if (partial.length === 1) return { status: "found", member: partial[0] };
  if (partial.length > 1) return { status: "ambiguous", candidates: partial };
  return { status: "not_found", available: members };
}
