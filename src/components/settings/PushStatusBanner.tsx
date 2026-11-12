"use client";

import { BellOff, BellRing } from "lucide-react";
import { usePush } from "@/lib/use-push";

/**
 * Aviso arriba de Configuracion: si los push no funcionan, las alertas del bot
 * (captura recibida, baja, chat sin respuesta) solo quedan en la campana del CRM.
 */
export function PushStatusBanner() {
  const push = usePush();
  if (push.state === "loading" || push.state === "subscribed") return null;

  const sinClaves = !push.configured;
  return (
    <a
      href="#notificaciones"
      className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 hover:bg-amber-500/10 transition-colors"
    >
      {sinClaves ? (
        <BellOff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
      ) : (
        <BellRing className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
      )}
      <div>
        <p className="text-sm font-semibold">
          {sinClaves
            ? "Los avisos al celular están apagados"
            : "Este dispositivo no recibe avisos al celular"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {sinClaves
            ? "Faltan las claves VAPID en Render. Mientras tanto, las alertas del bot solo aparecen en la campana del CRM."
            : "Actívalos en Notificaciones para enterarte de las alertas del bot aunque el CRM esté cerrado."}
        </p>
      </div>
    </a>
  );
}
