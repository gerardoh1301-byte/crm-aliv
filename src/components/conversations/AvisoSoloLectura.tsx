"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, MessageCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Pie del chat cuando un vendedor abre el historial de otro número (el 944) de un cliente
 * suyo: se lee como contexto, y el botón abre (o crea) el chat en su propio número.
 */
export function AvisoSoloLectura({ contactId, numero }: { contactId: string; numero: string | null }) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState(false);

  async function escribirDesdeMiNumero() {
    if (!contactId || abriendo) return;
    setAbriendo(true);
    try {
      const res = await fetch("/api/conversations/mi-numero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const json = (await res.json().catch(() => ({}))) as { conversationId?: string; error?: string };
      if (!res.ok || !json.conversationId) {
        toast.error(json.error ?? "No se pudo abrir el chat en tu número");
        return;
      }
      router.push(`/conversations/${json.conversationId}`);
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <div className="border-t border-border bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 flex-1 min-w-[220px]">
        <Eye className="h-4 w-4 shrink-0" />
        <span>
          Historial del {numero ?? "otro número"}: solo lectura, para que tengas el contexto. Para
          retomar la venta, escríbele desde tu número.
        </span>
      </p>
      <button
        type="button"
        onClick={escribirDesdeMiNumero}
        disabled={abriendo || !contactId}
        className="inline-flex items-center h-8 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
      >
        <MessageCircle className="h-3.5 w-3.5 mr-1" />
        {abriendo ? "Abriendo…" : "Escribirle desde mi número"}
      </button>
    </div>
  );
}
