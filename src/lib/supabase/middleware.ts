import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION_LOCAL, modoLocal } from "@/lib/modo-local";
import { opcionesDeCookie } from "@/lib/supabase/cookies";

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/sin-acceso", "/correo"];

const PUBLIC_API_PREFIXES = [
  "/api/health",
  "/api/webhooks",
  "/api/agent",
  "/api/automations/process",
  "/api/simulador",
  "/api/seed",
  "/api/drive-sync",
  // Sistema integrado: cada ruta exige su propio Bearer (METRICAS_TOKEN / worker).
  "/api/metricas",
  "/api/alertas",
];

export async function updateSession(request: NextRequest) {
  // Modo PIN (local o autoalojado sin Supabase Auth)
  if (modoLocal() || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("supabase.co")) {
    const sessionCookie = request.cookies.get(COOKIE_SESION_LOCAL)?.value;
    const { pathname } = request.nextUrl;
    const isPublicPath = PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
    const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    );
    const isAuthLocal = pathname.startsWith("/api/auth/local");

    if (!sessionCookie && !isPublicPath && !isPublicApi && !isAuthLocal) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      if (pathname !== "/") {
        url.searchParams.set("redirect", pathname);
      }
      return NextResponse.redirect(url);
    }

    if (sessionCookie && (pathname === "/login" || pathname === "/signup")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.delete("redirect");
      return NextResponse.redirect(url);
    }

    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: opcionesDeCookie(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!user && !isPublicPath && !isPublicApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
