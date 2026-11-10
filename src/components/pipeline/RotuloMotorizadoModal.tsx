"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/constants";

export interface RotuloData {
  numeroOrden: string;
  clienteNombre: string;
  telefono: string;
  dni?: string | null;
  ciudad: string;
  distrito?: string | null;
  direccion: string;
  referencia?: string | null;
  total: number;
}

interface RotuloMotorizadoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: RotuloData;
}

export function RotuloMotorizadoModal({
  open,
  onOpenChange,
  data,
}: RotuloMotorizadoModalProps) {
  const [copied, setCopied] = useState(false);

  const fechaImpresion = new Date().toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const telFormateado = (data.telefono || "").replace(/^\+51/, "").trim();
  const distritoLimpio =
    data.distrito && data.distrito.toLowerCase() !== data.ciudad.toLowerCase()
      ? data.distrito
      : "";

  const handleCopiarTexto = () => {
    const texto = `📦 RÓTULO MOTORIZADO - ALIV PERÚ
Orden: ${data.numeroOrden}
Cliente: ${data.clienteNombre}
Teléfono: ${data.telefono}
${data.dni ? `DNI: ${data.dni}\n` : ""}Distrito: ${distritoLimpio || "Lima"}
Dirección: ${data.direccion}
${data.referencia ? `Referencia: ${data.referencia}\n` : ""}Total a cobrar: ${formatCurrency(data.total)} (Efectivo / Yape 951365418)`;

    navigator.clipboard.writeText(texto);
    setCopied(true);
    toast.success("Información copiada al portapapeles");
    setTimeout(() => setCopied(false), 2500);
  };

  const handleImprimir = () => {
    const printWindow = window.open("", "_blank", "width=600,height=600");
    if (!printWindow) {
      toast.error("Por favor habilita las ventanas emergentes para imprimir");
      return;
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Rótulo ${data.numeroOrden} - Aliv Perú</title>
  <style>
    @page {
      size: 105mm 90mm;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      background: #ffffff;
      width: 105mm;
      height: 90mm;
      max-width: 105mm;
      max-height: 90mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border: 1.5px solid #000;
      padding: 3mm 4mm;
      color: #000;
    }
    .header-bar {
      background: #0f172a;
      color: #ffffff;
      padding: 2mm 3mm;
      border-radius: 2mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2mm;
    }
    .header-title {
      font-size: 9pt;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .header-brand {
      font-size: 8.5pt;
      font-weight: 700;
      color: #34d399;
    }
    .main-grid {
      display: grid;
      grid-template-columns: 60mm 35mm;
      gap: 2mm;
      flex: 1;
    }
    .col-left {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .col-right {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border-left: 1px dashed #64748b;
      padding-left: 2.5mm;
    }
    .order-box {
      margin-bottom: 1.5mm;
    }
    .order-num {
      font-size: 11pt;
      font-weight: 900;
    }
    .phone-num {
      font-size: 9.5pt;
      font-weight: 800;
      color: #047857;
    }
    .dest-title {
      font-size: 6.5pt;
      text-transform: uppercase;
      font-weight: 700;
      color: #475569;
    }
    .client-name {
      font-size: 9.5pt;
      font-weight: 800;
      text-transform: uppercase;
      line-height: 1.1;
      margin-bottom: 0.5mm;
    }
    .dni-line {
      font-size: 7.5pt;
      font-weight: 600;
      color: #334155;
      margin-bottom: 1.5mm;
    }
    .district-badge {
      font-size: 10pt;
      font-weight: 900;
      text-transform: uppercase;
      line-height: 1.1;
      background: #f1f5f9;
      padding: 1mm 1.5mm;
      border-radius: 1mm;
      display: inline-block;
      margin-bottom: 1mm;
    }
    .address-line {
      font-size: 8.5pt;
      font-weight: 600;
      line-height: 1.15;
    }
    .ref-line {
      font-size: 7.5pt;
      color: #475569;
      font-style: italic;
      margin-top: 0.8mm;
    }
    .delivery-type {
      background: #ecfdf5;
      border: 1px solid #10b981;
      border-radius: 1.5mm;
      padding: 1.5mm;
      text-align: center;
      font-size: 7.5pt;
      font-weight: 700;
      color: #065f46;
      margin-bottom: 2mm;
    }
    .pay-card {
      border: 1.5px solid #000;
      background: #fafafa;
      border-radius: 2mm;
      padding: 2mm 1mm;
      text-align: center;
    }
    .pay-title {
      font-size: 7pt;
      font-weight: 800;
      letter-spacing: 0.4px;
      color: #b91c1c;
      text-transform: uppercase;
    }
    .pay-amount {
      font-size: 15pt;
      font-weight: 900;
      color: #000;
      line-height: 1.1;
      margin: 1mm 0;
    }
    .pay-yape {
      font-size: 6.5pt;
      font-weight: 700;
      color: #047857;
    }
    .footer-bar {
      font-size: 6pt;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      border-top: 0.5px solid #cbd5e1;
      padding-top: 1mm;
      margin-top: 1mm;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <span class="header-title">MODALIDAD: MOTORIZADO (DOMICILIO) 🛵</span>
    <span class="header-brand">🌿 ALIV PERÚ</span>
  </div>

  <div class="main-grid">
    <div class="col-left">
      <div class="order-box">
        <div class="order-num">N° Orden: ${data.numeroOrden}</div>
        <div class="phone-num">📞 Tel: ${telFormateado || "Sin teléfono"}</div>
      </div>

      <div>
        <div class="dest-title">Destinatario:</div>
        <div class="client-name">${data.clienteNombre}</div>
        ${data.dni ? `<div class="dni-line">DNI/Doc: ${data.dni}</div>` : ""}
      </div>

      <div>
        <div class="dest-title">Destino Lima:</div>
        ${distritoLimpio ? `<div class="district-badge">${distritoLimpio}</div>` : ""}
        <div class="address-line">${data.direccion || "Dirección pendiente"}</div>
        ${data.referencia ? `<div class="ref-line">Ref: ${data.referencia}</div>` : ""}
      </div>
    </div>

    <div class="col-right">
      <div>
        <div class="delivery-type">
          🛵 ENTREGA<br>A DOMICILIO
        </div>
      </div>

      <div class="pay-card">
        <div class="pay-title">TOTAL A COBRAR:</div>
        <div class="pay-amount">${formatCurrency(data.total)}</div>
        <div class="pay-yape">Efectivo / Yape: 951365418</div>
      </div>
    </div>
  </div>

  <div class="footer-bar">
    <span>Impresión: ${fechaImpresion}</span>
    <span>Aliv Store Lima · Tienda de Bienestar</span>
  </div>

  <script>
    window.onload = function() {
      window.print();
      setTimeout(function() { window.close(); }, 800);
    };
  </script>
</body>
</html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 bg-card">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              🏷️ Rótulo para Motorizado (Lima y Callao)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Formato exacto de 10.5 cm de largo × 9.0 cm de alto listo para pegar en la caja o sobre del pedido.
          </DialogDescription>
        </DialogHeader>

        {/* Vista previa exacta del Rótulo */}
        <div className="flex justify-center my-2">
          <div
            className="w-[360px] h-[308px] bg-white text-slate-900 border-2 border-slate-800 rounded-md p-3.5 flex flex-col justify-between shadow-md select-none text-[12px]"
            style={{ aspectRatio: "10.5 / 9" }}
          >
            {/* Header */}
            <div className="bg-slate-900 text-white rounded px-2.5 py-1.5 flex justify-between items-center text-[11px] font-bold">
              <span>MODALIDAD: MOTORIZADO 🛵</span>
              <span className="text-emerald-400 font-extrabold">🌿 ALIV PERÚ</span>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-[1.6fr_1fr] gap-2.5 my-1.5 flex-1">
              {/* Col Izquierda */}
              <div className="flex flex-col justify-between pr-1">
                <div>
                  <p className="font-extrabold text-[14px] leading-tight text-slate-950">
                    N° Orden: {data.numeroOrden}
                  </p>
                  <p className="font-bold text-[12px] text-emerald-700 leading-tight">
                    📞 Tel: {telFormateado || "Sin teléfono"}
                  </p>
                </div>

                <div className="my-1">
                  <p className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">
                    Destinatario:
                  </p>
                  <p className="font-bold text-[12px] uppercase text-slate-950 leading-tight line-clamp-1">
                    {data.clienteNombre}
                  </p>
                  {data.dni && (
                    <p className="text-[10px] text-slate-600 font-medium">
                      DNI: {data.dni}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">
                    Destino Lima:
                  </p>
                  {distritoLimpio && (
                    <span className="inline-block bg-slate-100 text-slate-900 font-extrabold text-[11px] px-1.5 py-0.5 rounded uppercase leading-none mb-1">
                      {distritoLimpio}
                    </span>
                  )}
                  <p className="text-[10.5px] font-semibold leading-tight line-clamp-2 text-slate-800">
                    {data.direccion || "Dirección pendiente"}
                  </p>
                  {data.referencia && (
                    <p className="text-[9.5px] italic text-slate-500 line-clamp-1 mt-0.5">
                      Ref: {data.referencia}
                    </p>
                  )}
                </div>
              </div>

              {/* Col Derecha */}
              <div className="flex flex-col justify-between border-l border-dashed border-slate-300 pl-2">
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-1.5 py-1 text-center font-bold text-[10px] leading-tight">
                  🛵 ENTREGA<br />A DOMICILIO
                </div>

                <div className="border-2 border-slate-900 bg-slate-50 rounded p-1.5 text-center">
                  <p className="text-[9px] font-extrabold text-red-700 uppercase tracking-tight">
                    TOTAL A COBRAR:
                  </p>
                  <p className="font-black text-[18px] text-slate-950 leading-tight my-0.5">
                    {formatCurrency(data.total)}
                  </p>
                  <p className="text-[8px] font-bold text-emerald-700 leading-tight">
                    Efectivo / Yape: 951365418
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 pt-1 text-[8.5px] text-slate-500 flex justify-between items-center">
              <span>Impresión: {fechaImpresion}</span>
              <span>Aliv Store Lima · Bienestar</span>
            </div>
          </div>
        </div>

        {/* Acciones del Modal */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopiarTexto}
            className="text-xs h-9"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1" />
                Copiar Datos
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-9"
            >
              Cerrar
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleImprimir}
              className="text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Imprimir Rótulo (10.5×9 cm)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
