"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { GuiaPdfDrive } from "@/components/pipeline/GuiaPdfDrive";

interface PedidoShalom {
  id: string;
  numeroOrden: string;
  fecha: string;
  estado: string;
  tieneGuia: boolean;
}

/**
 * En la ficha del contacto: sube la preguía / guía PDF de su pedido Shalom a Drive
 * («Cliente - fecha del pedido - #orden.pdf»). No usa el almacenamiento S3 de Documentos.
 * Solo aparece si el contacto tiene pedidos por agencia Shalom.
 */
export function PreguiaShalomContacto({ contactId }: { contactId: string }) {
  const [pedidos, setPedidos] = useState<PedidoShalom[]>([]);
  const [elegido, setElegido] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`/api/pedidos/guia-pdf?contactId=${encodeURIComponent(contactId)}`)
      .then((r) => (r.ok ? r.json() : { pedidos: [] }))
      .then((j: { pedidos?: PedidoShalom[] }) => {
        if (!vivo) return;
        const lista = j.pedidos ?? [];
        setPedidos(lista);
        setElegido((prev) => prev || lista[0]?.id || "");
      })
      .catch(() => vivo && setPedidos([]));
    return () => {
      vivo = false;
    };
  }, [contactId]);

  if (pedidos.length === 0) return null;
  const actual = pedidos.find((p) => p.id === elegido) ?? pedidos[0];

  return (
    <div className="space-y-1.5 mb-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold">Preguía Shalom del pedido:</span>
        {pedidos.length > 1 ? (
          <select
            value={actual.id}
            onChange={(e) => setElegido(e.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs"
            aria-label="Pedido Shalom"
          >
            {pedidos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.numeroOrden} · {p.fecha}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {actual.numeroOrden} · {actual.fecha}
          </span>
        )}
        {actual.tieneGuia && (
          <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> ya tiene guía en Drive (subir otra la reemplaza)
          </span>
        )}
      </div>
      <GuiaPdfDrive key={actual.id} pedidoId={actual.id} enviarPorDefecto={false} />
    </div>
  );
}
