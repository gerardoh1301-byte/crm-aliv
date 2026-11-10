import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmSettings, teamMembers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, requireMember } from "@/lib/api-auth";
import { listMembers } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { correoDeAccesoActivo, enviarEnlaceDeAcceso, invitarPorCorreo } from "@/lib/auth-correo";
import { modoLocal } from "@/lib/modo-local";
import { MASTER_GOOGLE_EMAIL } from "@/app/api/auth/local/perfiles/route";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

function usaAuthLocal(): boolean {
  return (
    modoLocal() ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("supabase.co")
  );
}

async function guardarSetting(key: string, value: string) {
  await db
    .insert(crmSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: crmSettings.key,
      set: { value },
    });
}

/** Lista del equipo. La ve cualquier miembro (para el selector de propietario). */
export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await listMembers());
}

/**
 * Alta de una cuenta Google o miembro del equipo (solo admin).
 * En modo Neon / Local crea directamente el registro en `team_members` y permite
 * asignar su rol (`asesor` = Perfil Vendedor, `admin` = Perfil Administrador) y clave/PIN.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: {
    email?: string;
    name?: string;
    role?: string;
    password?: string;
    pin?: string;
    invitar?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  const role = body.role === "admin" ? "admin" : "asesor";
  const password = (body.password ?? body.pin ?? "").trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: "Ingresa un correo de Google válido (ej. vendedor@gmail.com)" },
      { status: 400 }
    );
  }

  // Modo Neon / Local sin Supabase Auth: insertar directo en team_members
  if (usaAuthLocal()) {
    const [existente] = await db
      .select()
      .from(teamMembers)
      .where(sql`lower(${teamMembers.email}) = ${email}`)
      .limit(1);

    let row;
    if (existente) {
      const [actualizado] = await db
        .update(teamMembers)
        .set({
          name: name || existente.name || email.split("@")[0],
          role: email === MASTER_GOOGLE_EMAIL ? "admin" : role,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(teamMembers.id, existente.id))
        .returning();
      row = actualizado;
    } else {
      const [creado] = await db
        .insert(teamMembers)
        .values({
          id: crypto.randomUUID(),
          email,
          name: name || email.split("@")[0],
          role: email === MASTER_GOOGLE_EMAIL ? "admin" : role,
          active: true,
        })
        .returning();
      row = creado;
    }

    if (password) {
      await guardarSetting(`auth.pin.${email}`, password);
    }

    return NextResponse.json(
      {
        ...row,
        reusedAuthUser: Boolean(existente),
        correoEnviado: false,
        avisoCorreo: null,
      },
      { status: 201 }
    );
  }

  // Flujo Supabase Auth (solo cuando Supabase esta activo)
  const invitar = Boolean(body.invitar) && correoDeAccesoActivo();

  const [existing] = await db.execute<{ id: string }>(
    sql`select id from auth.users where lower(email) = ${email} limit 1`
  );

  let userId = existing?.id ?? null;
  let correoEnviado = false;
  let avisoCorreo: string | null = null;

  if (!userId && invitar) {
    const r = await invitarPorCorreo(email, name);
    if ("error" in r) {
      return NextResponse.json(
        { error: `No se pudo enviar la invitacion: ${r.error}` },
        { status: 502 }
      );
    }
    userId = r.userId;
    correoEnviado = true;
  }

  if (!userId) {
    if (password && password.length < 8) {
      return NextResponse.json(
        { error: "La contrasena temporal debe tener al menos 8 caracteres" },
        { status: 400 }
      );
    }
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: true,
      user_metadata: { full_name: name || null },
    });
    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "No se pudo crear el usuario" },
        { status: 502 }
      );
    }
    userId = data.user.id;
  }

  if (existing && invitar) {
    const { error } = await enviarEnlaceDeAcceso(email);
    if (error) avisoCorreo = error;
    else correoEnviado = true;
  }

  const [row] = await db
    .insert(teamMembers)
    .values({ id: userId, email, name: name || null, role, active: true })
    .onConflictDoUpdate({
      target: teamMembers.id,
      set: { name: name || null, role, active: true, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(
    { ...row, reusedAuthUser: Boolean(existing), correoEnviado, avisoCorreo },
    { status: 201 }
  );
}

/** Actualizar ajustes de acceso del equipo (PIN Maestro, PIN Vendedor, Google Client ID). */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  try {
    const body = (await request.json()) as {
      adminPin?: string;
      vendedorPin?: string;
      googleClientId?: string;
    };

    if (typeof body.adminPin === "string" && body.adminPin.trim()) {
      await guardarSetting("auth.admin_pin", body.adminPin.trim());
    }
    if (typeof body.vendedorPin === "string" && body.vendedorPin.trim()) {
      await guardarSetting("auth.vendedor_pin", body.vendedorPin.trim());
    }
    if (typeof body.googleClientId === "string") {
      await guardarSetting("auth.google_client_id", body.googleClientId.trim());
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error guardando ajustes" },
      { status: 500 }
    );
  }
}
