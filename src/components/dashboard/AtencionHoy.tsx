import Link from "next/link";
import { AlertTriangle, Bot, Clock, PackageCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AtencionHoy as Datos } from "@/lib/dashboard/atencion";

/** Fila superior del Dashboard: lo que alguien tiene que hacer hoy. Cada tarjeta lleva a su lista. */
export function AtencionHoy({ datos }: { datos: Datos }) {
  const tarjetas = [
    {
      titulo: "Chats con alerta",
      valor: datos.alertas,
      detalle: `${datos.esperando} esperan respuesta hace +10 min`,
      href: "/conversations?filtro=atencion",
      icono: AlertTriangle,
      urgente: datos.alertas > 0 || datos.esperando > 0,
    },
    {
      titulo: "Adelantos por verificar",
      valor: datos.adelantosPorVerificar,
      detalle: "Provincia: revisar Yape de S/20",
      href: "/m/pedidos?filtro=adelanto",
      icono: Wallet,
      urgente: datos.adelantosPorVerificar > 0,
    },
    {
      titulo: "Pedidos por confirmar",
      valor: datos.porConfirmar,
      detalle: "Lima y provincia, sin pruebas",
      href: "/m/pedidos?filtro=por_confirmar_cod",
      icono: PackageCheck,
      urgente: false,
    },
    {
      titulo: "Respuesta del bot",
      valor: datos.botMedianaSeg === null ? "—" : `${datos.botMedianaSeg} s`,
      detalle: `${datos.botRespuestas24h} respuestas en 24 h (mediana)`,
      href: "/reportes",
      icono: datos.botMedianaSeg === null ? Clock : Bot,
      urgente: datos.botMedianaSeg !== null && datos.botMedianaSeg > 60,
    },
  ];

  return (
    <section aria-labelledby="atencion-hoy">
      <h2 id="atencion-hoy" className="text-sm font-semibold text-muted-foreground mb-2">
        Para atender hoy
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tarjetas.map((t) => (
          <Link
            key={t.titulo}
            href={t.href}
            className={cn(
              "rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              t.urgente ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20" : "border-border/60"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t.titulo}</span>
              <t.icono className={cn("h-4 w-4", t.urgente ? "text-amber-600" : "text-muted-foreground")} aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t.valor}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.detalle}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
