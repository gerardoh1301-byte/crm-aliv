"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, UserCheck, KeyRound, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Perfil {
  id: string;
  nombre: string;
  email: string;
  role: string;
}

export function LocalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [perfilSeleccionado, setPerfilSeleccionado] = useState<Perfil | null>(null);
  const [pin, setPin] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/local/perfiles")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.perfiles)) {
          setPerfiles(data.perfiles);
          // Seleccionar Admin por defecto
          const admin = data.perfiles.find((p: Perfil) => p.role === "admin") || data.perfiles[0];
          if (admin) setPerfilSeleccionado(admin);
        }
      })
      .catch(() => {
        // Fallback
        setPerfiles([
          { id: "00000000-0000-4000-8000-000000000001", nombre: "Administrador Aliv", email: "admin@alivstore.shop", role: "admin" },
          { id: "00000000-0000-4000-8000-000000000002", nombre: "Vendedor Aliv", email: "vendedor@alivstore.shop", role: "asesor" },
        ]);
      });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!perfilSeleccionado) return;
    if (!pin) {
      setError("Por favor ingresa el PIN de acceso");
      return;
    }

    setCargando(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: perfilSeleccionado.id,
          role: perfilSeleccionado.role,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "PIN incorrecto");
      }

      // Redirigir a la app
      router.push(redirectUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto border-border/60 shadow-xl bg-card">
      <CardHeader className="text-center pb-4">
        <div className="flex justify-center mb-2">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>
        <CardTitle className="text-xl font-bold font-heading">
          Acceso al Equipo Aliv Store
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Selecciona tu perfil de trabajo e ingresa tu PIN de acceso
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleLogin}>
        <CardContent className="space-y-5">
          {/* Selector de perfiles */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              1. Selecciona tu perfil
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {perfiles.map((p) => {
                const esAdmin = p.role === "admin";
                const isSelected = perfilSeleccionado?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPerfilSeleccionado(p);
                      setError(null);
                    }}
                    className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border/60 hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      {esAdmin ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <UserCheck className="w-4 h-4 text-blue-500" />
                      )}
                      <Badge variant={esAdmin ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                        {esAdmin ? "Admin" : "Ventas"}
                      </Badge>
                    </div>
                    <span className="font-medium text-sm text-foreground truncate w-full">
                      {p.nombre}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate w-full">
                      {esAdmin ? "Acceso Total" : "Ventas y Pedidos"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input de PIN */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                2. PIN de acceso
              </label>
              <span className="text-[11px] text-muted-foreground">
                {perfilSeleccionado?.role === "admin" ? "PIN por defecto: aliv2026" : "PIN por defecto: 1234"}
              </span>
            </div>
            <Input
              type="password"
              placeholder={perfilSeleccionado?.role === "admin" ? "PIN de Administrador" : "PIN de Vendedor"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center font-mono text-base tracking-widest h-11"
              autoFocus
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs text-center font-medium">
              {error}
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-2">
          <Button
            type="submit"
            className="w-full h-11 font-medium gap-2"
            disabled={cargando}
          >
            {cargando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Iniciando sesión...
              </>
            ) : (
              <>
                Ingresar al CRM
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
