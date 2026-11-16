import { NextResponse } from "next/server";
import {
  sincronizarTodosLosEnviosEnSheets,
  SPREADSHEET_URL,
  SPREADSHEET_ID,
} from "@/lib/sheets/envios-sync";
import { requireMember } from "@/lib/api-auth";

export async function GET() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  return NextResponse.json({
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    url: SPREADSHEET_URL,
  });
}

export async function POST() {
  const auth = await requireMember();
  if ("response" in auth) return auth.response;

  const resultado = await sincronizarTodosLosEnviosEnSheets();
  return NextResponse.json(resultado);
}
