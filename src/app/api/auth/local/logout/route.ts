import { NextResponse } from "next/server";
import { COOKIE_SESION_LOCAL } from "@/lib/modo-local";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  // Si además había sesión de Supabase, también se cierra: si no, al cambiar de cuenta
  // seguiría entrando la anterior.
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("supabase.co")) {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }
  } catch {
    // sin Supabase configurado no hay nada que cerrar
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_SESION_LOCAL, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
