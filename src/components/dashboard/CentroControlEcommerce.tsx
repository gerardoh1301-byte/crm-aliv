"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  armarMatriz,
  CUBOS_EMBUDO,
  CUBOS_LOGISTICA,
  type Cubo,
  type PedidoCentro,
} from "@/lib/dashboard/centro-control-reglas";

const FILAS = [
  ["TOTAL", "Total"],
  ["AG", "AG · agencia"],
  ["CE", "CE · contra entrega"],
] as const;

type Fila = (typeof FILAS)[number][0];

const ETIQUETA: Record<string, string> = Object.fromEntries([...CUBOS_EMBUDO, ...CUBOS_LOGISTICA]);

const TONO: Partial<Record<Cubo, string>> = {
  entregados: "text-emerald-600",
  ag_entregados: "text-emerald-600",
  desc_confirmacion: "text-rose-600",
  desc_entrega: "text-rose-600",
  ag_descartados: "text-rose-600",
  seguimiento: "text-amber-600",
};

function hoyLima(offsetDias: number): string {
  const d = new Date(Date.now() - offsetDias * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

function soles(n: number) {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Mejora 1: embudo Total / AG / CE y flujo logístico AG; cada número abre la lista de pedidos. */
export function CentroControlEcommerce({ pedidos }: { pedidos: PedidoCentro[] }) {
  const [dias, setDias] = useState<1 | 7 | 30>(7);
  const [abierto, setAbierto] = useState<{ fila: Fila; cubo: Cubo } | null>(null);

  const matriz = useMemo(() => {
    const desde = hoyLima(dias - 1);
    return armarMatriz(pedidos.filter((p) => p.fecha >= desde));
  }, [pedidos, dias]);

  const lista = abierto ? matriz[abierto.fila][abierto.cubo] : [];

  const celda = (fila: Fila, cubo: Cubo) => {
    const n = matriz[fila][cubo].length;
    return (
      <button
        type="button"
        disabled={n === 0}
        onClick={() => setAbierto({ fila, cubo })}
        className={cn(
          "w-full rounded-lg border border-border/60 bg-card px-2 py-2 text-left transition-colors",
          n > 0 ? "hover:bg-muted/50 cursor-pointer" : "opacity-60 cursor-default",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        )}
        aria-label={`${ETIQUETA[cubo]} ${fila}: ${n} pedidos`}
      >
        <span className={cn("block text-lg font-semibold tabular-nums", n > 0 && TONO[cubo])}>{n}</span>
      </button>
    );
  };

  return (
    <section aria-labelledby="centro-control" className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 id="centro-control" className="text-sm font-semibold">
          Centro de Control <span className="text-muted-foreground font-normal">· pedidos creados</span>
        </h2>
        <div className="flex gap-1" role="group" aria-label="Periodo">
          {([1, 7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs cursor-pointer border",
                dias === d ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
              )}
            >
              {d === 1 ? "Hoy" : `${d} días`}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-28" />
              {CUBOS_EMBUDO.map(([k, t]) => (
                <th key={k} className="font-medium text-muted-foreground text-left px-1">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map(([fila, t]) => (
              <tr key={fila}>
                <th scope="row" className="text-left font-medium pr-2">
                  {t}
                </th>
                {CUBOS_EMBUDO.map(([k]) => (
                  <td key={k}>{celda(fila, k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 mb-1 text-xs font-semibold">Flujo logístico AG</p>
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              {CUBOS_LOGISTICA.map(([k, t]) => (
                <th key={k} className="font-medium text-muted-foreground text-left px-1">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {CUBOS_LOGISTICA.map(([k]) => (
                <td key={k}>{celda("AG", k)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <Dialog open={!!abierto} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {abierto ? `${ETIQUETA[abierto.cubo]} · ${FILAS.find((f) => f[0] === abierto.fila)?.[1]}` : ""}
            </DialogTitle>
            <DialogDescription>
              {lista.length} pedidos · {soles(lista.reduce((s, p) => s + p.total, 0))} ·{" "}
              {dias === 1 ? "hoy" : `últimos ${dias} días`}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border/60">
            {lista.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.nombre} <span className="text-xs text-muted-foreground">#{p.numero}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {soles(p.total)} · {p.telefono ?? "sin teléfono"} · {p.asesor ?? "sin asesor"} · {p.estado}
                  </p>
                </div>
                <Link
                  href={`/conversations/${p.contactId}`}
                  aria-label={`Abrir chat de ${p.nombre}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted"
                >
                  <MessageCircle className="h-4 w-4" />
                </Link>
                {p.telefono && (
                  <a
                    href={`tel:${p.telefono.replace(/[^\d+]/g, "")}`}
                    aria-label={`Llamar a ${p.nombre}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
