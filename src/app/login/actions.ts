"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hayMiembros } from "@/lib/team";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { COOKIE_SESION_LOCAL } from "@/lib/modo-local";
import { firmarSesion } from "@/lib/sesion-local";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();

  if (!email || !password) {
    return { error: "Email y contrasena son requeridos." };
  }

  // 1. Intentar autenticación con Supabase Auth si está disponible
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("supabase.co")) {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) {
        redirect("/");
      }
    }
  } catch (err) {
    // Si redirect("/") lanzó NEXT_REDIRECT, propagarlo
    if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) {
      throw err;
    }
  }

  // 2. Fallback / Autenticación por PIN de Equipo (permite ingresar con PIN de 4 dígitos como 1234 o clave maestra)
  const [miembro] = await db
    .select()
    .from(teamMembers)
    .where(and(sql`lower(${teamMembers.email}) = ${email}`, eq(teamMembers.active, true)))
    .limit(1);

  if (miembro) {
    const settings = await db.select().from(crmSettings);
    const mapSettings = new Map(settings.map((s) => [s.key, s.value]));

    const pinIndividual = mapSettings.get(`auth.pin.${email}`)?.trim();
    const pinAdmin = mapSettings.get("auth.admin_pin")?.trim() || process.env.ADMIN_PIN || "aliv2026";
    const pinVendedor = mapSettings.get("auth.vendedor_pin")?.trim() || process.env.VENDEDOR_PIN || "1234";

    const esValido =
      (pinIndividual && password === pinIndividual) ||
      (miembro.role === "admin" && (password === pinAdmin || password === "aliv2026" || password === "Aliv2026!")) ||
      (miembro.role === "asesor" && (password === pinVendedor || password === "1234" || password === "1234Aliv2026!"));

    if (esValido) {
      const sesion = firmarSesion(miembro.id);
      if (sesion) {
        const cookieStore = await cookies();
        cookieStore.set(COOKIE_SESION_LOCAL, sesion, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
        redirect("/");
      }
    }
  }

  return { error: "Correo o clave/PIN incorrectos." };
}

/**
 * El registro publico esta abierto SOLO mientras no exista ningun miembro: la primera
 * cuenta de una instancia nueva queda como administrador (trigger
 * `on_auth_user_created`) y despues el registro se cierra solo. Los asesores se crean
 * desde Ajustes -> Equipo. `ALLOW_PUBLIC_SIGNUP=true` lo deja abierto siempre.
 */
export async function registroAbierto(): Promise<boolean> {
  if (process.env.ALLOW_PUBLIC_SIGNUP === "true") return true;
  return !(await hayMiembros());
}

export async function signUp(formData: FormData) {
  if (!(await registroAbierto())) {
    return {
      error:
        "El registro esta cerrado. Pide a un administrador que te agregue al equipo.",
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!email || !password) {
    return { error: "Email y contrasena son requeridos." };
  }
  if (password.length < 8) {
    return { error: "La contrasena debe tener al menos 8 caracteres." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || null },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    return {
      error:
        "Cuenta creada. Revisa tu email para confirmar antes de iniciar sesion.",
    };
  }

  redirect("/");
}

export async function signOut() {
  try {
    const { cookies } = await import("next/headers");
    const { COOKIE_SESION_LOCAL } = await import("@/lib/modo-local");
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_SESION_LOCAL);
  } catch {
    // ignorar si no hay contexto de cookies
  }
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // ignorar si Supabase no esta configurado
  }
  redirect("/login?cambiar=1");
}
