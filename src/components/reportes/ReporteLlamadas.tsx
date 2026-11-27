import type { LlamadaRegistrada } from "@/lib/reportes-llamadas";

const ZONA = "America/Lima";
const fechaCorta = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, weekday: "short", day: "2-digit", month: "2-digit" });
const hora = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });
const horaNum = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hour: "numeric", hour12: false });

/** Franja de 2 h en hora de Lima, p. ej. «10–12». */
function franja(iso: string): string {
  const h = Number(horaNum.format(new Date(iso))) % 24;
  const ini = h - (h % 2);
  return `${ini}–${ini + 2}`;
}

export function ReporteLlamadas({ llamadas, dias }: { llamadas: LlamadaRegistrada[]; dias: number }) {
  const porPersona = new Map<string, { total: number; franjas: Map<string, number>; ultima: string }>();
  for (const l of llamadas) {
    const p = porPersona.get(l.quien) ?? { total: 0, franjas: new Map(), ultima: l.fecha };
    p.total += 1;
    const f = franja(l.fecha);
    p.franjas.set(f, (p.franjas.get(f) ?? 0) + 1);
    porPersona.set(l.quien, p);
  }

  return (
    <section aria-labelledby="reporte-llamadas" className="mt-6 rounded-xl border border-border/60 bg-card p-4">
      <h2 id="reporte-llamadas" className="text-sm font-semibold">
        Llamadas por WhatsApp
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Cada vez que alguien presiona el botón de teléfono, en los últimos {dias} días (hora de Lima). Registra el clic,
        no si la llamada se contestó: eso se ve en el historial de llamadas de WhatsApp.
      </p>

      {llamadas.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nadie presionó «Llamar» en el periodo.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            {[...porPersona.entries()].map(([quien, p]) => (
              <div key={quien} className="rounded-lg border border-border/60 px-3 py-2 text-xs min-w-[200px]">
                <p className="font-medium text-sm">{quien}</p>
                <p className="tabular-nums">
                  <span className="text-lg font-semibold">{p.total}</span> clics · última {fechaCorta.format(new Date(p.ultima))}{" "}
                  {hora.format(new Date(p.ultima))}
                </p>
                <p className="text-muted-foreground tabular-nums">
                  {[...p.franjas.entries()]
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([f, c]) => `${f} h: ${c}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground text-left">
                  <th className="px-2 py-1.5 font-medium">Día</th>
                  <th className="px-2 py-1.5 font-medium">Hora</th>
                  <th className="px-2 py-1.5 font-medium">Quién</th>
                  <th className="px-2 py-1.5 font-medium">Cliente</th>
                </tr>
              </thead>
              <tbody>
                {llamadas.map((l, i) => (
                  <tr key={`${l.fecha}-${i}`} className="border-t border-border/50">
                    <td className="px-2 py-1.5">{fechaCorta.format(new Date(l.fecha))}</td>
                    <td className="px-2 py-1.5 tabular-nums">{hora.format(new Date(l.fecha))}</td>
                    <td className="px-2 py-1.5">{l.quien}</td>
                    <td className="px-2 py-1.5">
                      {l.contacto}
                      {l.telefono && <span className="text-muted-foreground"> · {l.telefono}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
