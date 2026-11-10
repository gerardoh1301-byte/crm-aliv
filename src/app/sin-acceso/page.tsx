"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Pantalla de recuperación rápida cuando la sesión expiró o el usuario no está en el equipo.
 * Permite entrar directamente al Login Maestro Google o limpiar la cookie de sesión en 1 clic.
 */
export default function SinAccesoPage() {
  const [cargando, setCargando] = useState(false);

  async function irAlLoginMaestro() {
    setCargando(true);
    try {
      await fetch("/api/auth/local/logout", { method: "POST" });
    } catch {
      // ignorar
    }
    window.location.href = "/login?cambiar=1";
  }

  return (
    <div className="min-h-[65vh] flex flex-col items-center justify-center text-center gap-4 px-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card shadow-sm">
        <ShieldOff className="h-5 w-5 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-semibold">
        Sesión finalizada o cuenta pendiente de autorización
      </h1>
      <p className="text-sm text-muted-foreground max-w-md">
        Inicia sesión con tu <strong>Cuenta Google Maestra (gerardoh1301@gmail.com)</strong> o con una cuenta de Google autorizada en el perfil de Vendedor.
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
        <Button
          onClick={irAlLoginMaestro}
          disabled={cargando}
          className="cursor-pointer gap-2"
        >
          {cargando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Iniciar sesión con Cuenta Google
        </Button>
        <Button
          variant="outline"
          onClick={irAlLoginMaestro}
          disabled={cargando}
          className="cursor-pointer gap-2"
        >
          <LogIn className="h-4 w-4" />
          Cambiar de cuenta
        </Button>
      </div>
    </div>
  );
}
