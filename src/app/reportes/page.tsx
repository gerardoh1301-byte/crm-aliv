import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Reportes } from "@/components/reportes/Reportes";
import { getCurrentMember } from "@/lib/team";
import { generarReporte, RANGOS, type RangoDias } from "@/lib/reportes";
import { pedidosReporteOperacion } from "@/lib/reportes-operacion";
import { ReporteOperacion } from "@/components/reportes/ReporteOperacion";
import { llamadasWhatsApp } from "@/lib/reportes-llamadas";
import { ReporteLlamadas } from "@/components/reportes/ReporteLlamadas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reportes",
};

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const member = await getCurrentMember();
  if (!member) redirect("/sin-acceso");

  const { dias: param } = await searchParams;
  const dias: RangoDias = (RANGOS as readonly number[]).includes(Number(param)) ? (Number(param) as RangoDias) : 30;

  const [reporte, pedidosOperacion, llamadas] = await Promise.all([
    generarReporte(member, dias),
    pedidosReporteOperacion(member),
    llamadasWhatsApp(member, dias),
  ]);

  return (
    <div>
      <PageHeader
        title="Reportes"
        subtitle={
          member.role === "admin"
            ? "Numeros reales de toda la instancia"
            : "Numeros reales de tus contactos"
        }
      />
      <Reportes reporte={reporte} />
      <ReporteLlamadas llamadas={llamadas} dias={dias} />
      <ReporteOperacion pedidos={pedidosOperacion} />
    </div>
  );
}
