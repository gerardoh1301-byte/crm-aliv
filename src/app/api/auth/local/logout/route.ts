import { NextResponse } from "next/server";
import { COOKIE_SESION_LOCAL } from "@/lib/modo-local";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_SESION_LOCAL, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
