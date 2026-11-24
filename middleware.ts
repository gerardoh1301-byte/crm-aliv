import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // manifest.json y sw.js tienen que ser publicos: si el middleware los manda a
    // /login, el navegador recibe HTML donde espera JSON/JS y la PWA nunca se instala.
    // js/ sirve el script de captura que carga la tienda (public/js/captura-formulario.js).
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|icons/|js/|videos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)",
  ],
};
