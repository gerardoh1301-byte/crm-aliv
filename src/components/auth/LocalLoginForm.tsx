"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  UserCheck,
  KeyRound,
  Loader2,
  ArrowRight,
  Mail,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Perfil {
  id: string;
  nombre: string;
  email: string;
  role: string;
  esMaestro?: boolean;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>
          ) => void;
        };
      };
    };
  }
}

export function LocalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/";

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [perfilSeleccionado, setPerfilSeleccionado] = useState<Perfil | null>(
    null
  );
  const [emailGoogle, setEmailGoogle] = useState("gerardoh1301@gmail.com");
  const [pin, setPin] = useState("");
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/auth/local/perfiles")
      .then((res) => res.json())
      .then((data) => {
        if (data.googleClientId) {
          setGoogleClientId(data.googleClientId);
        }
        if (data.ok && Array.isArray(data.perfiles)) {
          setPerfiles(data.perfiles);
          const maestro =
            data.perfiles.find((p: Perfil) => p.esMaestro) ||
            data.perfiles.find((p: Perfil) => p.role === "admin") ||
            data.perfiles[0];
          if (maestro) {
            setPerfilSeleccionado(maestro);
            setEmailGoogle(maestro.email);
          }
        }
      })
      .catch(() => {
        const fallback: Perfil[] = [
          {
            id: "00000000-0000-4000-8000-000000000001",
            nombre: "Gerardo Huaynalaya (Maestro)",
            email: "gerardoh1301@gmail.com",
            role: "admin",
            esMaestro: true,
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            nombre: "Vendedor Aliv",
            email: "vendedor@alivstore.shop",
            role: "asesor",
          },
        ];
        setPerfiles(fallback);
        setPerfilSeleccionado(fallback[0]);
        setEmailGoogle(fallback[0].email);
      });
  }, []);

  // Si hay Google OAuth Client ID configurado, montar el boton oficial de Google Sign-In
  useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;

    const handleGoogleCredential = async (response: {
      credential?: string;
    }) => {
      if (!response.credential) return;
      setCargando(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/local/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleCredential: response.credential }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error || "Cuenta de Google no autorizada en el equipo"
          );
        }
        window.location.href = redirectUrl;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Error al iniciar sesión con Google"
        );
        setCargando(false);
      }
    };

    const initGoogle = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCredential,
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: 340,
          text: "continue_with",
          shape: "rectangular",
        });
      }
    };

    if (window.google?.accounts?.id) {
      initGoogle();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);
  }, [googleClientId, redirectUrl]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const correoLimpio = emailGoogle.trim().toLowerCase();
    if (!correoLimpio) {
      setError("Ingresa tu cuenta de Google (@gmail.com)");
      return;
    }
    if (!pin) {
      setError("Por favor ingresa tu clave o PIN de acceso");
      return;
    }

    setCargando(true);
    setError(null);

    try {
      const coincidencia = perfiles.find(
        (p) => p.email.toLowerCase() === correoLimpio
      );

      const res = await fetch("/api/auth/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: correoLimpio,
          memberId: coincidencia?.id,
          role: coincidencia?.role,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Clave o PIN incorrecto");
      }

      window.location.href = redirectUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al iniciar sesión"
      );
      setCargando(false);
    }
  }

  const esCuentaMaestra =
    emailGoogle.trim().toLowerCase() === "gerardoh1301@gmail.com" ||
    perfilSeleccionado?.role === "admin";

  return (
    <Card className="w-full max-w-md mx-auto border-border/60 shadow-xl bg-card">
      <CardHeader className="text-center pb-4">
        <div className="flex justify-center mb-2">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>
        <CardTitle className="text-xl font-bold font-heading">
          Login Maestro y Equipo Google
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Inicia sesión con tu cuenta de Google autorizada (Administrador Maestro o Vendedor)
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          {googleClientId && (
            <div className="flex flex-col items-center gap-2 pb-2 border-b border-border/60">
              <div ref={googleBtnRef} className="min-h-[40px]" />
              <span className="text-[10px] text-muted-foreground">
                o selecciona tu cuenta Google abajo
              </span>
            </div>
          )}

          {/* Selector rapido de cuentas Google autorizadas */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              1. Cuentas Google Autorizadas
            </label>
            <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1">
              {perfiles.map((p) => {
                const esAdmin = p.role === "admin";
                const isSelected =
                  emailGoogle.trim().toLowerCase() === p.email.toLowerCase();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPerfilSeleccionado(p);
                      setEmailGoogle(p.email);
                      setError(null);
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border/60 hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          esAdmin
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-blue-500/15 text-blue-600"
                        }`}
                      >
                        {esAdmin ? (
                          <ShieldCheck className="w-4 h-4" />
                        ) : (
                          <UserCheck className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-sm text-foreground truncate">
                            {p.nombre}
                          </span>
                          {p.esMaestro && (
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          )}
                        </div>
                        <span className="text-[11px] text-muted-foreground truncate block">
                          {p.email}
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant={esAdmin ? "default" : "secondary"}
                      className="text-[10px] px-2 py-0.5 shrink-0 ml-2"
                    >
                      {p.esMaestro
                        ? "Maestro Google"
                        : esAdmin
                        ? "Admin"
                        : "Vendedor"}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input de Correo Google (para escribir otra cuenta Google de vendedor si fue agregada) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              2. Cuenta de Google
            </label>
            <Input
              type="email"
              placeholder="tucorreo@gmail.com"
              value={emailGoogle}
              onChange={(e) => {
                const val = e.target.value;
                setEmailGoogle(val);
                const match = perfiles.find(
                  (p) => p.email.toLowerCase() === val.trim().toLowerCase()
                );
                if (match) setPerfilSeleccionado(match);
              }}
              className="h-10 text-sm"
            />
          </div>

          {/* Input de Clave / PIN */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                3. Clave / PIN de acceso
              </label>
              <span className="text-[11px] text-muted-foreground">
                {esCuentaMaestra
                  ? "Maestro: aliv2026"
                  : "Vendedor: 1234"}
              </span>
            </div>
            <Input
              type="password"
              placeholder={
                esCuentaMaestra
                  ? "Clave Maestra (aliv2026)"
                  : "Clave de Vendedor (1234)"
              }
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

        <CardFooter className="pt-2 flex flex-col gap-2">
          <Button
            type="submit"
            className="w-full h-11 font-medium gap-2 cursor-pointer"
            disabled={cargando}
          >
            {cargando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verificando cuenta Google...
              </>
            ) : (
              <>
                Ingresar con{" "}
                {esCuentaMaestra ? "Cuenta Maestra" : "Perfil Vendedor"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            El Administrador Maestro (<strong>gerardoh1301@gmail.com</strong>) puede agregar o quitar cuentas Google de vendedores en{" "}
            <strong>Configuración → Equipo</strong>.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
