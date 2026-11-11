"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  UserCheck,
  UserCircle2,
  Check,
  Loader2,
  Shield,
  UserX,
  Search,
} from "lucide-react";
import { avatarBg, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface TeamMemberItem {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "asesor";
  active: boolean;
}

export interface AsignarVendedorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  clienteNombre: string;
  numeroOrden?: string | null;
  currentOwnerId?: string | null;
  currentOwnerName?: string | null;
  onAssigned?: (newOwnerId: string | null, newOwnerName: string | null) => void;
}

let cachedTeam: Promise<{ members: TeamMemberItem[]; me: TeamMemberItem | null }> | null = null;
function getTeamData() {
  if (!cachedTeam) {
    cachedTeam = Promise.all([
      fetch("/api/team").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/team/me").then((r) => (r.ok ? r.json() : { member: null })),
    ]).then(([members, me]) => ({ members, me: me.member }));
    setTimeout(() => {
      cachedTeam = null;
    }, 30_000);
  }
  return cachedTeam;
}

export function AsignarVendedorModal({
  open,
  onOpenChange,
  contactId,
  clienteNombre,
  numeroOrden,
  currentOwnerId,
  currentOwnerName,
  onAssigned,
}: AsignarVendedorModalProps) {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [me, setMe] = useState<TeamMemberItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getTeamData()
      .then(({ members, me }) => {
        if (!alive) return;
        setMembers(members);
        setMe(me);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const isAdmin = me?.role === "admin";

  const handleAssign = async (targetId: string | null, targetName: string | null) => {
    if (!isAdmin) {
      toast.error("Solo un administrador puede asignar o reasignar vendedores");
      return;
    }

    setSavingId(targetId ?? "__unassigned__");
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: targetId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al actualizar vendedor");
      }

      toast.success(
        targetName
          ? `Cliente asignado a ${targetName}`
          : "Asignación retirada (Sin asesor)",
      );
      onAssigned?.(targetId, targetName);
      onOpenChange(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "No se pudo asignar el vendedor");
    } finally {
      setSavingId(null);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!m.active && m.id !== currentOwnerId) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (m.name && m.name.toLowerCase().includes(q)) ||
      m.email.toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 rounded-2xl">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Asignar Vendedor
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {clienteNombre} {numeroOrden ? `(${numeroOrden})` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!isAdmin && me && (
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
            <Shield className="h-4 w-4 shrink-0" />
            <span>
              Solo el <strong>Administrador (Maestro)</strong> tiene permiso para cambiar el vendedor a cargo.
            </span>
          </div>
        )}

        <div className="space-y-3 pt-1">
          {/* Vendedor actual */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-lg text-xs">
            <span className="text-muted-foreground">Vendedor actual:</span>
            <span
              className={cn(
                "font-semibold",
                currentOwnerName
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              {currentOwnerName ? `(${currentOwnerName})` : "(Sin asignar)"}
            </span>
          </div>

          {/* Buscador de vendedores si hay más de 3 */}
          {members.length > 3 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Filtrar por nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Lista de miembros */}
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
            {/* Opción desasignar */}
            <button
              type="button"
              disabled={!isAdmin || savingId !== null}
              onClick={() => handleAssign(null, null)}
              className={cn(
                "w-full flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition-all",
                !currentOwnerId
                  ? "border-amber-500/40 bg-amber-500/5 shadow-2xs"
                  : "border-border/60 hover:border-border hover:bg-muted/30",
                !isAdmin && "opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                  <UserX className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    Sin asesor asignado
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    El cliente queda en bandeja general para el Administrador
                  </p>
                </div>
              </div>
              {savingId === "__unassigned__" ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              ) : !currentOwnerId ? (
                <Check className="h-4 w-4 text-amber-600 shrink-0 font-bold" />
              ) : null}
            </button>

            {loading ? (
              <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Cargando equipo de ventas...</span>
              </div>
            ) : (
              filteredMembers.map((member) => {
                const displayName = member.name?.trim() || member.email.split("@")[0];
                const isSelected = currentOwnerId === member.id;
                const isSavingThis = savingId === member.id;

                return (
                  <button
                    key={member.id}
                    type="button"
                    disabled={!isAdmin || savingId !== null}
                    onClick={() => handleAssign(member.id, displayName)}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition-all",
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10 shadow-2xs font-semibold"
                        : "border-border/60 hover:border-primary/40 hover:bg-primary/5",
                      !isAdmin && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                          avatarBg(displayName),
                        )}
                      >
                        {getInitials(displayName)}
                      </div>
                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground truncate">
                            {displayName}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[9px] px-1 py-0 font-normal uppercase",
                              member.role === "admin"
                                ? "bg-purple-500/15 text-purple-700 dark:text-purple-300"
                                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                            )}
                          >
                            {member.role === "admin" ? "Admin" : "Ventas"}
                          </Badge>
                        </div>
                        <p className="text-[10.5px] text-muted-foreground truncate">
                          {member.email}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 pl-2">
                      {isSavingThis ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : isSelected ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>Actual</span>
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
