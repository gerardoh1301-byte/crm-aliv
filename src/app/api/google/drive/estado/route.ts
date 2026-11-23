import { NextResponse } from "next/server";
import { requireMember } from "@/lib/api-auth";
import { estadoDrive } from "@/lib/google/drive";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ ...(await estadoDrive()), esAdmin: auth.member.role === "admin" });
}
