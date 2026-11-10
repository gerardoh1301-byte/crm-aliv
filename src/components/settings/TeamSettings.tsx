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

  const load = useCallback(async () => {
    const [list, current] = await Promise.all([
      fetch("/api/team").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/team/me").then((r) => (r.ok ? r.json() : { member: null })),
    ]);
    return { list, me: current.member as Member | null };
  }, []);

  const apply = useCallback((data: { list: Member[]; me: Member | null }) => {
    setMembers(data.list);
    setMe(data.me);
    setLoading(false);
  }, []);

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
                placeholder="Actual: aliv2026"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nueva Clave General Vendedores</Label>
              <Input
                type="password"
                placeholder="Actual: 1234"
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
