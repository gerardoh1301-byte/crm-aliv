"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  calcularUbu,
  METAS,
  porCanal,
  porMes,
  porSemanaProducto,
  tasas,
  type Columnas,
  type Conteo,
  type FilaReporte,
  type PedidoReporte,
} from "@/lib/reportes-operacion-reglas";

const COLS = ["AG", "CE", "TOTAL"] as const;
type Col = (typeof COLS)[number];

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const soles = (v: number | null) =>
  v === null ? "—" : `S/ ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Tasa({ valor, meta }: { valor: number | null; meta?: number }) {
  const bajo = valor !== null && meta !== undefined && valor < meta;
  return (
    <span className={cn("tabular-nums", valor !== null && meta !== undefined && (bajo ? "text-rose-600" : "text-emerald-600"))}>
      {pct(valor)}
    </span>
  );
}

function Celda({ c, col }: { c: Conteo; col: Col }) {
  const t = tasas(c);
  const meta = col === "TOTAL" ? undefined : METAS[col];
  return (
    <td className="px-2 py-1.5 align-top border-l border-border/50">
      <div className="tabular-nums">
        <span className="font-medium">{c.recibidos}</span>
        <span className="text-muted-foreground"> → {c.confirmados} → </span>
        <span className="font-medium text-emerald-700 dark:text-emerald-400">{c.entregados}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        conf <Tasa valor={t.confirmacion} meta={meta?.confirmacion} /> · entr <Tasa valor={t.entrega} meta={meta?.entrega} />
        {c.en_curso > 0 && <> · {c.en_curso} en curso</>}
      </div>
    </td>
  );
}

function Tabla({ filas, titulo }: { filas: FilaReporte[]; titulo: string }) {
  if (filas.length === 0) return <p className="text-sm text-muted-foreground py-4">Sin pedidos en el periodo.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium px-2 py-1">{titulo}</th>
            {COLS.map((c) => (
              <th key={c} className="text-left font-medium px-2 py-1 border-l border-border/50">
                {c} <span className="font-normal">recib. → conf. → entr.</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {filas.map((f) => (
            <tr key={f.clave}>
              <th scope="row" className="text-left font-medium px-2 py-1.5 align-top whitespace-nowrap">
                {f.clave}
              </th>
              {COLS.map((c) => (
                <Celda key={c} c={f.columnas[c]} col={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Calculadora({ filas }: { filas: FilaReporte[] }) {
  const [clave, setClave] = useState(filas[0]?.clave ?? "");
  const [gasto, setGasto] = useState("");
  const fila = filas.find((f) => f.clave === clave) ?? filas[0];
  if (!fila) return null;
  const g = Number(gasto.replace(",", ".")) || 0;
  const cols: Columnas = fila.columnas;
  // El gasto de Meta se reparte entre AG y CE según los pedidos recibidos de cada uno.
  const gastoDe = (col: Col) =>
    col === "TOTAL" || cols.TOTAL.recibidos === 0 ? g : (g * cols[col].recibidos) / cols.TOTAL.recibidos;

  const filasCalc: [string, (r: ReturnType<typeof calcularUbu>) => number | null][] = [
    ["CPA por recibido", (r) => r.cpaRecibido],
    ["CPA por confirmado", (r) => r.cpaConfirmado],
    ["CPA por entregado", (r) => r.cpaEntregado],
    ["UP (ticket − producto)", (r) => r.up],
    ["Logística por entregado", (r) => r.flete],
    ["UBU por pedido", (r) => r.ubu],
    ["UBU total", (r) => r.ubuTotal],
  ];
  const res = Object.fromEntries(COLS.map((c) => [c, calcularUbu(cols[c], gastoDe(c))])) as Record<
    Col,
    ReturnType<typeof calcularUbu>
  >;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs space-y-1">
          <span className="block text-muted-foreground">Mes</span>
          <select
            value={fila.clave}
            onChange={(e) => setClave(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs cursor-pointer"
          >
            {filas.map((f) => (
              <option key={f.clave} value={f.clave}>
                {f.clave}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="block text-muted-foreground">Gasto en anuncios del mes (S/)</span>
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={gasto}
            onChange={(e) => setGasto(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th />
              {COLS.map((c) => (
                <th key={c} className="text-right font-medium px-2 py-1">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filasCalc.map(([t, f]) => (
              <tr key={t} className={t.startsWith("UBU") ? "font-semibold" : undefined}>
                <th scope="row" className="text-left font-normal px-2 py-1.5">
                  {t}
                </th>
                {COLS.map((c) => {
                  const v = f(res[c]);
                  return (
                    <td
                      key={c}
                      className={cn(
                        "text-right tabular-nums px-2 py-1.5",
                        t.startsWith("UBU") && v !== null && (v < 0 ? "text-rose-600" : "text-emerald-600")
                      )}
                    >
                      {soles(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Costos: NAC600 S/18 por frasco, Termix S/38,42. Logística AG = flete Shalom registrado (o S/10) + S/5 de
        AliClik; CE = S/16,5 por entrega. El gasto se reparte entre AG y CE según los pedidos recibidos. Es utilidad
        bruta: sin gastos fijos ni devoluciones de flete.
      </p>
    </div>
  );
}

/** Mejoras 7 y 8: reportes AG | CE | TOTAL contra metas y calculadora UBU/CPA. */
export function ReporteOperacion({ pedidos }: { pedidos: PedidoReporte[] }) {
  const meses = useMemo(() => porMes(pedidos), [pedidos]);
  const semanas = useMemo(() => porSemanaProducto(pedidos), [pedidos]);
  const canales = useMemo(() => porCanal(pedidos), [pedidos]);

  return (
    <section aria-labelledby="reporte-operacion" className="mt-6 rounded-xl border border-border/60 bg-card p-4">
      <h2 id="reporte-operacion" className="text-sm font-semibold">
        Operación AG | CE
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Últimos 4 meses por fecha de pedido. Metas: AG 40 % confirmación / 90 % entrega · CE 80 % / 65 %. Verde = en
        meta, rojo = bajo meta.
      </p>
      <Tabs defaultValue="mes">
        <TabsList>
          <TabsTrigger value="mes">Mensual</TabsTrigger>
          <TabsTrigger value="semana">Semanal por producto</TabsTrigger>
          <TabsTrigger value="canal">Por asesor / canal</TabsTrigger>
          <TabsTrigger value="ubu">Calculadora UBU</TabsTrigger>
        </TabsList>
        <TabsContent value="mes" className="pt-3">
          <Tabla filas={meses} titulo="Mes" />
        </TabsContent>
        <TabsContent value="semana" className="pt-3">
          <Tabla filas={semanas} titulo="Semana (lunes) · producto" />
        </TabsContent>
        <TabsContent value="canal" className="pt-3">
          <Tabla filas={canales} titulo="Canal" />
        </TabsContent>
        <TabsContent value="ubu" className="pt-3">
          <Calculadora filas={meses} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
