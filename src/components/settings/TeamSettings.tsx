"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Mail,
  ShieldCheck,
  UserPlus,
  UserX,
  UserCheck,
  Trash2,
  KeyRound,
  Sparkles,
  Check,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { avatarBg, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "asesor";
  active: boolean;
}

const MASTER_EMAIL = "gerardoh1301@gmail.com";

const ROLE_ITEMS = [
  { value: "admin", label: "Administrador" },
  { value: "asesor", label: "Vendedor (Asesor)" },
];

function label(m: Member) {
  return m.name?.trim() || m.email.split("@")[0];
}

/**
 * Gestión de Cuentas Google del Equipo:
 * - Muestra el Login Maestro Google (gerardoh1301@gmail.com).
 * - Permite al Administrador Maestro agregar cuentas de Google (@gmail.com) para el perfil de Vendedor (asesor) o Administrador.
 * - Permite activar/pausar, cambiar rol, definir PIN individual o global, y eliminar cuentas de vendedores.
 */
export function TeamSettings() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // Formulario rápido inline para agregar cuenta Google de vendedor
  const [quickEmail, setQuickEmail] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickPin, setQuickPin] = useState("");
  const [addingQuick, setAddingQuick] = useState(false);

  // Ajustes de claves / Google OAuth Client ID
  const [adminPin, setAdminPin] = useState("");
  const [vendedorPin, setVendedorPin] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Asignación automática de conversaciones
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
  const [autoAssignMemberId, setAutoAssignMemberId] = useState<string>("");
  const [autoAssignMode, setAutoAssignMode] = useState<"all_inbound" | "unassigned_only">("all_inbound");
  const [savingAutoAssign, setSavingAutoAssign] = useState(false);
  // Mejora 10: reparto por turnos con pesos (round-robin) además del asesor fijo.
  const [autoAssignStrategy, setAutoAssignStrategy] = useState<"fixed" | "round_robin">("fixed");
  const [autoAssignWeights, setAutoAssignWeights] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const [list, current, autoAssignRes] = await Promise.all([
      fetch("/api/team").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/team/me").then((r) => (r.ok ? r.json() : { member: null })),
      fetch("/api/team/auto-assign").then((r) => (r.ok ? r.json() : null)),
    ]);
    return {
      list,
      me: current.member as Member | null,
      autoAssign: autoAssignRes?.config as {
        enabled: boolean;
        memberId: string | null;
        mode: "all_inbound" | "unassigned_only";
        strategy?: "fixed" | "round_robin";
        weights?: Record<string, number>;
      } | null,
    };
  }, []);

  const apply = useCallback(
    (data: {
      list: Member[];
      me: Member | null;
      autoAssign?: {
        enabled: boolean;
        memberId: string | null;
        mode: "all_inbound" | "unassigned_only";
        strategy?: "fixed" | "round_robin";
        weights?: Record<string, number>;
      } | null;
    }) => {
      setMembers(data.list);
      setMe(data.me);
      if (data.autoAssign) {
        setAutoAssignEnabled(Boolean(data.autoAssign.enabled));
        if (data.autoAssign.memberId) {
          setAutoAssignMemberId(data.autoAssign.memberId);
        } else if (data.list.length > 0) {
          const primerVendedor =
            data.list.find((m) => m.role === "asesor" && m.active) || data.list[0];
          if (primerVendedor) setAutoAssignMemberId(primerVendedor.id);
        }
        if (data.autoAssign.mode) {
          setAutoAssignMode(data.autoAssign.mode);
        }
        setAutoAssignStrategy(data.autoAssign.strategy === "round_robin" ? "round_robin" : "fixed");
        setAutoAssignWeights(data.autoAssign.weights ?? {});
      } else if (data.list.length > 0 && !autoAssignMemberId) {
        const primerVendedor =
          data.list.find((m) => m.role === "asesor" && m.active) || data.list[0];
        if (primerVendedor) setAutoAssignMemberId(primerVendedor.id);
      }
      setLoading(false);
    },
    [autoAssignMemberId]
  );

  useEffect(() => {
    let alive = true;
    load().then((data) => {
      if (alive) apply(data);
    });
    return () => {
      alive = false;
    };
  }, [load, apply]);

  const isAdmin = me?.role === "admin";

  const update = async (id: string, patch: Partial<Member>) => {
    const res = await fetch(`/api/team/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "No se pudo actualizar");
      return;
    }
    toast.success("Cuenta actualizada");
    apply(await load());
  };

  const eliminarMiembro = async (m: Member) => {
    if (m.email.toLowerCase() === MASTER_EMAIL) {
      toast.error("La cuenta Google Maestra no se puede eliminar.");
      return;
    }
    const res = await fetch(`/api/team/${m.id}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "No se pudo eliminar la cuenta");
      return;
    }
    toast.success(`Cuenta ${m.email} eliminada del equipo`);
    apply(await load());
  };

  const handleQuickAddVendedor = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailClean = quickEmail.trim().toLowerCase();
    if (!emailClean) {
      toast.error("Ingresa el correo de Google del vendedor");
      return;
    }
    setAddingQuick(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailClean,
          name: quickName.trim() || emailClean.split("@")[0],
          role: "asesor",
          pin: quickPin.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "No se pudo agregar la cuenta Google");
        return;
      }
      toast.success(
        `Cuenta Google ${emailClean} autorizada como Vendedor (Asesor)`
      );
      setQuickEmail("");
      setQuickName("");
      setQuickPin("");
      apply(await load());
    } finally {
      setAddingQuick(false);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await fetch("/api/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminPin: adminPin.trim() || undefined,
          vendedorPin: vendedorPin.trim() || undefined,
          googleClientId: googleClientId.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "No se pudieron guardar los ajustes");
        return;
      }
      toast.success("Ajustes de acceso Google y claves actualizados");
      setAdminPin("");
      setVendedorPin("");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAutoAssign = async (
    newEnabled: boolean,
    targetMemberId = autoAssignMemberId,
    targetMode = autoAssignMode,
    targetStrategy = autoAssignStrategy,
    targetWeights = autoAssignWeights
  ) => {
    const porTurnos = targetStrategy === "round_robin";
    if (newEnabled && porTurnos && !Object.values(targetWeights).some((w) => w > 0)) {
      toast.error("Dale peso a al menos un asesor para repartir por turnos");
      return;
    }
    if (newEnabled && !porTurnos && !targetMemberId) {
      toast.error("Selecciona un asesor de venta antes de activar la asignación automática");
      return;
    }
    setSavingAutoAssign(true);
    try {
      const res = await fetch("/api/team/auto-assign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: newEnabled,
          memberId: targetMemberId || null,
          mode: targetMode,
          strategy: targetStrategy,
          weights: targetWeights,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "No se pudo actualizar la asignación automática");
        return;
      }
      setAutoAssignEnabled(newEnabled);
      if (newEnabled && porTurnos) {
        toast.success("Asignación automática por turnos activada");
      } else if (newEnabled) {
        const asesorNombre =
          members.find((m) => m.id === targetMemberId)?.name ||
          members.find((m) => m.id === targetMemberId)?.email ||
          "el asesor seleccionado";
        toast.success(`Asignación automática activada: nuevas conversaciones se asignarán a ${asesorNombre}`);
      } else {
        toast.success("Asignación automática desactivada");
      }
    } catch {
      toast.error("Error al conectar con el servidor");
    } finally {
      setSavingAutoAssign(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando cuentas del equipo...</p>;
  }

  return (
    <div id="equipo" className="space-y-5">
      {/* Banner de Cuenta Maestra */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">
                Login Maestro Google: {MASTER_EMAIL}
              </p>
              <Badge className="bg-emerald-600 text-white text-[10px] px-2 py-0">
                Propietario / Admin Total
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Esta cuenta tiene acceso total garantizado y puede autorizar o revocar las cuentas Google de los vendedores.
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            className="cursor-pointer shrink-0"
          >
            <UserPlus className="h-4 w-4 mr-1.5" />
            Agregar cuenta avanzada
          </Button>
        )}
      </div>

      {/* Alta rápida de Cuenta Google para Perfil de Vendedor */}
      {isAdmin && (
        <form
          onSubmit={handleQuickAddVendedor}
          className="rounded-xl border bg-muted/30 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-primary" />
              Agregar Cuenta de Google para Perfil de Vendedor
            </p>
            <span className="text-[11px] text-muted-foreground">
              Solo verá ventas, contactos asignados y pedidos COD
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Input
              type="email"
              required
              placeholder="Correo Google (ej. vendedor1@gmail.com)"
              value={quickEmail}
              onChange={(e) => setQuickEmail(e.target.value)}
              className="bg-background"
            />
            <Input
              type="text"
              placeholder="Nombre del vendedor (ej. Ana Ventas)"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              className="bg-background"
            />
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="PIN opcional (def: 1234)"
                value={quickPin}
                onChange={(e) => setQuickPin(e.target.value)}
                className="bg-background"
              />
              <Button
                type="submit"
                disabled={addingQuick}
                className="cursor-pointer shrink-0"
              >
                <UserPlus className="h-4 w-4 mr-1" />
                {addingQuick ? "..." : "Autorizar"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Asignación Automática de Conversaciones Entrantes (Admin Total) */}
      {isAdmin && (
        <div
          className={cn(
            "rounded-xl border p-4 sm:p-5 transition-all space-y-4",
            autoAssignEnabled
              ? "border-emerald-500/40 bg-emerald-500/5 shadow-sm"
              : "border-border bg-muted/20"
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                    autoAssignEnabled
                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <UserCheck className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-semibold tracking-tight">
                  Asignación Automática de Nuevas Conversaciones
                </h3>
                {autoAssignEnabled ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] px-2 py-0.5">
                    ● Función Activa
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground text-[11px] px-2 py-0.5"
                  >
                    Función Desactivada
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl">
                Al activar esta opción, todas las conversaciones y mensajes de clientes que ingresen al CRM desde este momento se asignarán automáticamente al asesor de venta que elijas para su atención inmediata.
              </p>
            </div>

            {/* Botón de 1 clic para Activar / Desactivar la función */}
            <div className="shrink-0 flex items-center gap-2">
              {autoAssignEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingAutoAssign}
                  onClick={() => handleToggleAutoAssign(false)}
                  className="border-rose-500/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer font-medium text-xs h-9 px-3"
                >
                  <Power className="h-3.5 w-3.5 mr-1.5" />
                  {savingAutoAssign ? "Guardando..." : "Desactivar función"}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={savingAutoAssign || (autoAssignStrategy === "fixed" && !autoAssignMemberId)}
                  onClick={() => handleToggleAutoAssign(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer font-medium text-xs h-9 px-3.5 shadow-sm"
                >
                  <UserCheck className="h-4 w-4 mr-1.5" />
                  {savingAutoAssign ? "Activando..." : "Activar asignación automática"}
                </Button>
              )}
            </div>
          </div>

          {/* Forma de repartir: asesor fijo o por turnos con pesos (mejora 10) */}
          <div className="space-y-2 pt-2 border-t border-border/60">
            <Label className="text-xs font-semibold text-foreground/90">Forma de repartir:</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["fixed", "Todo a un asesor"],
                  ["round_robin", "Por turnos con pesos"],
                ] as const
              ).map(([valor, texto]) => (
                <Button
                  key={valor}
                  type="button"
                  size="sm"
                  variant={autoAssignStrategy === valor ? "default" : "outline"}
                  className="h-8 text-xs cursor-pointer"
                  disabled={savingAutoAssign}
                  onClick={() => {
                    setAutoAssignStrategy(valor);
                    if (autoAssignEnabled) handleToggleAutoAssign(true, autoAssignMemberId, autoAssignMode, valor);
                  }}
                >
                  {texto}
                </Button>
              ))}
            </div>
            {autoAssignStrategy === "round_robin" && (
              <div className="rounded-lg border bg-background p-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Peso de 0 a 10 por asesor: con 2 y 1, el primero recibe dos chats nuevos por cada uno del segundo. 0 = fuera
                  de la rueda. Un cliente que ya tiene asesor de la rueda se queda con él.
                </p>
                {members
                  .filter((m) => m.active)
                  .map((m) => (
                    <div key={m.id} className="flex items-center gap-3">
                      <span className="text-xs flex-1 min-w-0 truncate">
                        {label(m)} <span className="text-muted-foreground">({m.role === "admin" ? "Admin" : "Vendedor"})</span>
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        className="h-8 w-20 text-xs"
                        value={autoAssignWeights[m.id] ?? 0}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0)));
                          setAutoAssignWeights((prev) => ({ ...prev, [m.id]: n }));
                        }}
                      />
                    </div>
                  ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs cursor-pointer"
                  disabled={savingAutoAssign}
                  onClick={() => handleToggleAutoAssign(autoAssignEnabled)}
                >
                  Guardar pesos
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-border/60">
            {/* Selector de Asesor de Venta */}
            <div className={cn("space-y-1.5", autoAssignStrategy === "round_robin" && "hidden")}>
              <Label className="text-xs font-semibold text-foreground/90">
                Asesor de venta a quien asignar las conversaciones:
              </Label>
              <Select
                value={autoAssignMemberId}
                onValueChange={(val) => {
                  const id = val || "";
                  setAutoAssignMemberId(id);
                  if (autoAssignEnabled && id) {
                    handleToggleAutoAssign(true, id);
                  }
                }}
              >
                <SelectTrigger className="w-full bg-background text-xs h-9">
                  <SelectValue placeholder="Selecciona un asesor del equipo" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.active)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        {label(m)} ({m.email}) — {m.role === "admin" ? "Administrador" : "Vendedor (Asesor)"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selector de Alcance */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground/90">
                Alcance de la asignación entrante:
              </Label>
              <Select
                value={autoAssignMode}
                onValueChange={(val) => {
                  if (val === "all_inbound" || val === "unassigned_only") {
                    setAutoAssignMode(val);
                    if (autoAssignEnabled) {
                      handleToggleAutoAssign(true, autoAssignMemberId, val);
                    }
                  }
                }}
              >
                <SelectTrigger className="w-full bg-background text-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_inbound" className="text-xs">
                    Todas las conversaciones entrantes (Recomendado para turnos)
                  </SelectItem>
                  <SelectItem value="unassigned_only" className="text-xs">
                    Solo nuevos contactos y conversaciones sin asesor previo
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {autoAssignEnabled && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {autoAssignStrategy === "round_robin" ? (
                  <>Asignación activa por turnos entre los asesores con peso.</>
                ) : (
                  <>
                Asignación activa: Desde este momento, toda conversación o mensaje entrante se asigna a{" "}
                <strong>
                  {members.find((m) => m.id === autoAssignMemberId)?.name ||
                    members.find((m) => m.id === autoAssignMemberId)?.email ||
                    "el asesor seleccionado"}
                </strong>
                .
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Lista de cuentas autorizadas */}
      <div className="rounded-lg border divide-y">
        {members.map((m) => {
          const esMaestro = m.email.toLowerCase() === MASTER_EMAIL;
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-wrap sm:flex-nowrap items-center gap-3 p-3",
                !m.active && "opacity-50"
              )}
            >
              <div
                className={cn(
                  "h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold",
                  avatarBg(label(m))
                )}
              >
                {getInitials(label(m))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">
                    {label(m)}
                    {me?.id === m.id && (
                      <span className="text-xs text-muted-foreground font-normal">
                        {" "}
                        (tú)
                      </span>
                    )}
                  </p>
                  {esMaestro && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/40 text-emerald-600"
                    >
                      Maestro Google
                    </Badge>
                  )}
                  {!m.active && (
                    <Badge variant="destructive" className="text-[10px]">
                      Desactivado
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {m.email}
                </p>
              </div>

              {isAdmin && !esMaestro ? (
                <Select
                  value={m.role}
                  items={ROLE_ITEMS}
                  onValueChange={(v) =>
                    v &&
                    v !== m.role &&
                    update(m.id, { role: v as Member["role"] })
                  }
                >
                  <SelectTrigger className="h-8 w-[155px] text-xs cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="asesor">Vendedor (Asesor)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge
                  variant={m.role === "admin" ? "default" : "outline"}
                  className="text-xs"
                >
                  {m.role === "admin" ? (
                    <>
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      Admin Maestro
                    </>
                  ) : (
                    "Vendedor (Asesor)"
                  )}
                </Badge>
              )}

              {isAdmin && !esMaestro && me?.id !== m.id && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update(m.id, { active: !m.active })}
                    className="cursor-pointer h-8 px-2"
                    title={
                      m.active
                        ? "Pausar acceso de esta cuenta Google"
                        : "Reactivar acceso"
                    }
                  >
                    {m.active ? (
                      <UserX className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <UserCheck className="h-4 w-4 text-primary" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => eliminarMiembro(m)}
                    className="cursor-pointer h-8 px-2 text-destructive hover:text-destructive"
                    title="Eliminar cuenta Google del equipo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Configuración de Claves / Google OAuth Client ID */}
      {isAdmin && (
        <form
          onSubmit={handleSaveSecurity}
          className="rounded-xl border p-4 space-y-3 bg-card"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" />
            Claves de Acceso y Botón Google OAuth (Opcional)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nueva Clave Maestra (Admin)</Label>
              <Input
                type="password"
                placeholder="Nueva clave de administrador"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nueva Clave General Vendedores</Label>
              <Input
                type="password"
                placeholder="Nuevo PIN de vendedores"
                value={vendedorPin}
                onChange={(e) => setVendedorPin(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Google OAuth Client ID (1-Click)</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="xxx.apps.googleusercontent.com"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  className="h-9 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={savingConfig}
                  className="h-9 cursor-pointer shrink-0"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}

      {isAdmin && (
        <AddMemberDialog
          open={open}
          onClose={() => setOpen(false)}
          onCreated={async () => apply(await load())}
        />
      )}
    </div>
  );
}

function AddMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("asesor");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, pin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "No se pudo agregar");
        return;
      }
      toast.success(
        `Cuenta Google ${email} autorizada con perfil de ${
          role === "admin" ? "Administrador" : "Vendedor"
        }.`
      );
      setName("");
      setEmail("");
      setPin("");
      setRole("asesor");
      onClose();
      await onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Autorizar Cuenta de Google</DialogTitle>
          <DialogDescription>
            Agrega el correo de Google del vendedor o administrador. Quedará habilitado de inmediato para iniciar sesión en el CRM.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tm-name">Nombre del integrante</Label>
            <Input
              id="tm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Carlos Ventas"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tm-email">Correo de Google (@gmail.com) *</Label>
            <Input
              id="tm-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vendedor@gmail.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Perfil de Acceso</Label>
              <Select
                value={role}
                items={ROLE_ITEMS}
                onValueChange={(v) => v && setRole(v as Member["role"])}
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asesor">Vendedor (Asesor)</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tm-pin">Clave / PIN individual</Label>
              <Input
                id="tm-pin"
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Opcional (def: 1234)"
                autoComplete="off"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {role === "asesor"
              ? "El perfil Vendedor solo puede gestionar conversaciones, contactos asignados y pedidos COD."
              : "El perfil Administrador tiene acceso completo a configuración, equipo y reportes."}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving} className="cursor-pointer">
              {saving ? "Guardando..." : "Autorizar Cuenta Google"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
