"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, Printer, Truck, FileImage } from "lucide-react";
import { toast } from "sonner";

export interface RotuloShalomData {
  numeroOrden: string;
  codigo?: string | null;
  destinatario: string;
  dni?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  ciudad: string;
  direccion: string;
  referencia?: string | null;
  modalidad?: string;
  tipoEntrega?: string;
  telefono?: string | null;
  total?: number | null;
  productosResumen?: string | null;
}

interface RotuloShalomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: RotuloShalomData;
}

export function RotuloShalomModal({
  open,
  onOpenChange,
  data,
}: RotuloShalomModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Formato de fecha para el rótulo: ej. "NOVEMBER 12-2026 / 09:15 AM/ 2026"
  const now = new Date();
  const mesesIngles = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
  ];
  const mesNombre = mesesIngles[now.getMonth()];
  const dia = String(now.getDate()).padStart(2, "0");
  const anio = now.getFullYear();
  let horas = now.getHours();
  const ampm = horas >= 12 ? "PM" : "AM";
  horas = horas % 12 || 12;
  const minutos = String(now.getMinutes()).padStart(2, "0");
  const fechaRótulo = `${mesNombre} ${dia}-${anio} / ${String(horas).padStart(2, "0")}:${minutos} ${ampm}/ ${anio}`;

  // Número de orden limpio
  const numOrdenLimpio = (data.numeroOrden || "1000").replace(/[^0-9]/g, "") || "1000";
  // Código corto para el rótulo (ej. CDT9 o derivado del destino)
  const codigoRótulo =
    data.codigo?.toUpperCase() ||
    `SH${numOrdenLimpio.slice(-3)}`;

  // Destino jerárquico: ej. "Junin - Satipo - Mazamari"
  const partesDestino = [
    data.departamento,
    data.provincia,
    data.distrito || data.ciudad,
  ].filter(Boolean);
  const textoDestinoRuta = partesDestino.length > 0 ? partesDestino.join(" - ") : (data.ciudad || "Provincia");

  const ciudadDestinoGrande = (data.ciudad || data.distrito || "AGENCIA SHALOM").toUpperCase();
  const direccionCompleta = [data.direccion, data.referencia ? `Ref: ${data.referencia}` : null]
    .filter(Boolean)
    .join(", ");

  // Dibuja el rótulo exacto en el Canvas para generar la imagen PNG en alta definición (1200 x 750 px)
  const dibujarEnCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 1200;
    const H = 750;
    canvas.width = W;
    canvas.height = H;

    // 1. Fondo celeste claro con micropuntos
    ctx.fillStyle = "#EAF4F9";
    ctx.fillRect(0, 0, W, H);

    // Trama de puntos celestes
    ctx.fillStyle = "#D1E5F1";
    for (let x = 15; x < W; x += 22) {
      for (let y = 15; y < H; y += 22) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Función auxiliar para rectángulos con esquinas redondeadas
    const roundRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      radius: number,
      fillColor: string,
      strokeColor?: string
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    // 2. Cabecera Roja Superior
    const headerH = 88;
    roundRect(24, 24, W - 48, headerH, 14, "#DE1C24");

    // Texto Izquierdo: MODALIDAD: TERRESTRE + Ícono de camión
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "900 28px sans-serif";
    ctx.fillText("MODALIDAD: TERRESTRE", 50, 80);

    // Dibujo de silueta de camión en la cabecera
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(410, 56, 38, 26);
    ctx.fillRect(448, 64, 18, 18);
    ctx.beginPath();
    ctx.arc(424, 84, 6, 0, Math.PI * 2);
    ctx.arc(456, 84, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#DE1C24";
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(450, 67, 10, 8);

    // Logo Shalom en la cabecera (Derecha)
    // S estilizada
    ctx.save();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.ellipse(960, 68, 22, 16, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#DE1C24";
    ctx.fillRect(944, 66, 32, 5); // Franjas
    ctx.restore();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "italic 900 38px sans-serif";
    ctx.fillText("SHALOM", 995, 82);

    // -------------------------------------------------------------
    // COLUMNA IZQUIERDA (Ancho: 710px)
    // -------------------------------------------------------------
    const colLeftX = 24;
    const colLeftW = 710;

    // Caja 1: N° de Orden y Código (Top)
    const box1Y = 130;
    const box1H = 150;
    roundRect(colLeftX, box1Y, colLeftW, box1H, 18, "#FFFFFF");

    ctx.fillStyle = "#1E293B";
    ctx.font = "700 34px sans-serif";
    ctx.fillText("N° de Orden: " + numOrdenLimpio, colLeftX + 35, box1Y + 62);

    ctx.font = "900 36px sans-serif";
    ctx.fillText("Código: " + codigoRótulo, colLeftX + 35, box1Y + 118);

    // Caja 2: Destinatario y Destino (Bottom)
    const box2Y = 300;
    const box2H = 425;
    roundRect(colLeftX, box2Y, colLeftW, box2H, 18, "#FFFFFF");

    let curY = box2Y + 45;
    ctx.fillStyle = "#475569";
    ctx.font = "600 24px sans-serif";
    ctx.fillText("Destinatario:", colLeftX + 35, curY);

    curY += 42;
    ctx.fillStyle = "#0F172A";
    ctx.font = "900 34px sans-serif";
    const nombreCliente = (data.destinatario || "CLIENTE ALIV").toUpperCase();
    ctx.fillText(nombreCliente.slice(0, 32), colLeftX + 35, curY);

    curY += 36;
    ctx.fillStyle = "#1E293B";
    ctx.font = "800 24px sans-serif";
    ctx.fillText("N° DOC. " + (data.dni || "NO REGISTRA"), colLeftX + 35, curY);

    curY += 46;
    ctx.fillStyle = "#475569";
    ctx.font = "600 24px sans-serif";
    ctx.fillText("Destino:", colLeftX + 35, curY);

    curY += 32;
    ctx.fillStyle = "#334155";
    ctx.font = "600 24px sans-serif";
    ctx.fillText(textoDestinoRuta.slice(0, 45), colLeftX + 35, curY);

    curY += 48;
    ctx.fillStyle = "#0F172A";
    ctx.font = "900 42px sans-serif";
    ctx.fillText(ciudadDestinoGrande.slice(0, 24), colLeftX + 35, curY);

    curY += 38;
    ctx.fillStyle = "#475569";
    ctx.font = "500 20px sans-serif";
    // Si la dirección es larga, dividirla en 2 líneas
    const dirTexto = direccionCompleta || "Entrega en Agencia Shalom";
    if (dirTexto.length > 55) {
      ctx.fillText(dirTexto.slice(0, 55), colLeftX + 35, curY);
      curY += 28;
      ctx.fillText(dirTexto.slice(55, 110), colLeftX + 35, curY);
    } else {
      ctx.fillText(dirTexto, colLeftX + 35, curY);
    }

    // -------------------------------------------------------------
    // COLUMNA DERECHA (Ancho: 418px)
    // -------------------------------------------------------------
    const colRightX = 758;
    const colRightW = 418;

    // Caja 3: Logo Aliv (Fondo Azul Marino Oscuro)
    const box3Y = 130;
    const box3H = 270;
    roundRect(colRightX, box3Y, colRightW, box3H, 18, "#0A1D33");

    // Dibujo del isotipo de Aliv (Hoja verde con pulso blanco)
    const logoCenterX = colRightX + colRightW / 2;
    const logoCenterY = box3Y + box3H / 2;

    // Hoja verde
    ctx.save();
    ctx.translate(logoCenterX, logoCenterY);
    ctx.beginPath();
    ctx.ellipse(0, 0, 72, 98, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0A5C36";
    ctx.fill();

    // Línea de pulso cardíaco en blanco
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-110, 0);
    ctx.lineTo(-40, 0);
    ctx.lineTo(-20, -45);
    ctx.lineTo(0, 45);
    ctx.lineTo(20, -25);
    ctx.lineTo(35, 0);
    ctx.lineTo(110, 0);
    ctx.stroke();
    ctx.restore();

    // Píldora Roja "Tienda de bienestar"
    const pillY = 418;
    const pillH = 50;
    roundRect(colRightX + 15, pillY, colRightW - 30, pillH, 25, "#DE1C24");
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tienda de bienestar", colRightX + colRightW / 2, pillY + 34);
    ctx.textAlign = "left";

    // Caja 4: Entrega en agencia + icono
    const box4Y = 485;
    const box4H = 130;
    roundRect(colRightX, box4Y, colRightW, box4H, 18, "#FFFFFF");

    ctx.fillStyle = "#64748B";
    ctx.font = "600 22px sans-serif";
    ctx.fillText("Entrega:", colRightX + 30, box4Y + 45);

    ctx.fillStyle = "#DE1C24";
    ctx.font = "900 32px sans-serif";
    ctx.fillText(data.tipoEntrega || "En agencia", colRightX + 30, box4Y + 92);

    // Ícono de agencia Shalom a la derecha
    const agX = colRightX + colRightW - 95;
    const agY = box4Y + 30;
    ctx.strokeStyle = "#DE1C24";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(agX, agY + 16, 60, 48); // Fachada
    // Marquesina / techo
    ctx.beginPath();
    ctx.moveTo(agX - 6, agY + 16);
    ctx.lineTo(agX + 30, agY - 2);
    ctx.lineTo(agX + 66, agY + 16);
    ctx.closePath();
    ctx.stroke();
    // Puertas
    ctx.strokeRect(agX + 14, agY + 30, 32, 34);
    ctx.beginPath();
    ctx.moveTo(agX + 30, agY + 30);
    ctx.lineTo(agX + 30, agY + 64);
    ctx.stroke();

    // Pie derecho: Impresión de rótulo
    ctx.fillStyle = "#475569";
    ctx.font = "600 17px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Impresión de rótulo:", colRightX + colRightW / 2, 655);

    ctx.fillStyle = "#0F172A";
    ctx.font = "800 17px sans-serif";
    ctx.fillText(fechaRótulo, colRightX + colRightW / 2, 680);

    // Línea subrayada fina
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(colRightX + 45, 695);
    ctx.lineTo(colRightX + colRightW - 45, 695);
    ctx.stroke();
    ctx.textAlign = "left";
  }, [
    numOrdenLimpio,
    codigoRótulo,
    data.destinatario,
    data.dni,
    textoDestinoRuta,
    ciudadDestinoGrande,
    direccionCompleta,
    data.tipoEntrega,
    fechaRótulo,
  ]);

  useEffect(() => {
    if (open) {
      setTimeout(dibujarEnCanvas, 100);
    }
  }, [open, dibujarEnCanvas]);

  // Acción: Descargar Imagen PNG
  const handleDescargarPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setDownloading(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `rotulo-shalom-${numOrdenLimpio}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Rótulo descargado exitosamente como imagen PNG");
    } catch (err) {
      console.error("Error al descargar rótulo:", err);
      toast.error("No se pudo generar el archivo de imagen");
    } finally {
      setDownloading(false);
    }
  };

  // Acción: Copiar Imagen al Portapapeles (para pegar directo en WhatsApp Web)
  const handleCopiarImagen = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error("Error al generar la imagen");
          return;
        }
        try {
          // Escribir imagen en el portapapeles del sistema
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          setCopied(true);
          toast.success("¡Imagen del rótulo copiada! Ya puedes pegarla (Ctrl+V) en WhatsApp");
          setTimeout(() => setCopied(false), 2500);
        } catch (clipErr) {
          console.warn("Fallo clipboard.write de imagen, intentando descarga directa", clipErr);
          handleDescargarPNG();
        }
      }, "image/png");
    } catch (err) {
      console.error("Error al copiar imagen:", err);
      toast.error("Tu navegador no soporta copiar imágenes directamente; usa el botón Descargar");
    }
  };

  // Acción: Imprimir
  const handleImprimir = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    const printWindow = window.open("", "_blank", "width=850,height=600");
    if (!printWindow) {
      toast.error("Habilita las ventanas emergentes para imprimir");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Rótulo Shalom #${numOrdenLimpio} - Aliv Perú</title>
          <style>
            @page { size: landscape; margin: 0; }
            body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fff; }
            img { width: 100%; max-width: 140mm; height: auto; }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" onload="window.print(); window.close();" />
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] p-4 sm:p-6 overflow-hidden">
        <DialogHeader className="pb-2 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-red-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
                S
              </div>
              <div>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <span>Rótulo de Envío Shalom</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">
                    #{numOrdenLimpio}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Etiqueta oficial para paquetes de agencia Shalom. Genera imagen PNG lista para enviar o imprimir.
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Vista previa visual interactiva idéntica a la imagen de referencia */}
        <div className="my-2 flex flex-col items-center">
          <div className="w-full max-w-[680px] rounded-2xl overflow-hidden border border-slate-300 shadow-md bg-[#EAF4F9] select-none">
            {/* Cabecera Roja */}
            <div className="bg-[#DE1C24] text-white px-4 py-2.5 flex items-center justify-between m-2.5 rounded-xl shadow-sm">
              <div className="flex items-center gap-2 font-black text-sm tracking-wide">
                <span>MODALIDAD: TERRESTRE</span>
                <Truck className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1 font-black italic text-lg tracking-wider">
                <span className="inline-block bg-white text-[#DE1C24] rounded-full h-5 w-5 text-center leading-5 text-xs not-italic font-bold">
                  S
                </span>
                <span>SHALOM</span>
              </div>
            </div>

            {/* Grid 2 Columnas */}
            <div className="p-3 pt-0 grid grid-cols-[1.58fr_1fr] gap-2.5">
              {/* Columna Izquierda */}
              <div className="flex flex-col gap-2.5">
                {/* N° Orden y Código */}
                <div className="bg-white rounded-xl p-3 shadow-xs">
                  <p className="text-sm font-bold text-slate-800">
                    N° de Orden:{" "}
                    <span className="text-base font-black text-slate-900">
                      {numOrdenLimpio}
                    </span>
                  </p>
                  <p className="text-base font-black text-slate-900 mt-1">
                    Código: <span>{codigoRótulo}</span>
                  </p>
                </div>

                {/* Destinatario y Destino */}
                <div className="bg-white rounded-xl p-3 shadow-xs flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500">
                      Destinatario:
                    </p>
                    <h3 className="font-extrabold text-slate-900 text-base uppercase leading-tight mt-0.5">
                      {data.destinatario || "Cliente Aliv"}
                    </h3>
                    <p className="text-xs font-bold text-slate-700 mt-1">
                      N° DOC. {data.dni || "NO REGISTRA"}
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500">
                      Destino:
                    </p>
                    <p className="text-xs text-slate-600 font-medium">
                      {textoDestinoRuta}
                    </p>
                    <h4 className="font-black text-slate-900 text-lg leading-tight mt-0.5">
                      {ciudadDestinoGrande}
                    </h4>
                    <p className="text-[11px] text-slate-600 line-clamp-2 mt-1 leading-snug">
                      {direccionCompleta || "Entrega en Agencia Shalom"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Columna Derecha */}
              <div className="flex flex-col gap-2.5 justify-between">
                {/* Logo Aliv */}
                <div className="bg-[#0A1D33] rounded-xl p-4 flex items-center justify-center h-[120px] shadow-xs">
                  <div className="relative flex items-center justify-center">
                    <div className="w-14 h-20 bg-[#0A5C36] rounded-full flex items-center justify-center shadow-inner" />
                    {/* Línea de pulso */}
                    <svg
                      className="absolute w-28 h-10 text-white"
                      viewBox="0 0 100 40"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M 0,20 L 30,20 L 40,5 L 50,35 L 60,10 L 70,20 L 100,20" />
                    </svg>
                  </div>
                </div>

                {/* Píldora Roja */}
                <div className="bg-[#DE1C24] text-white text-center font-extrabold text-xs py-1.5 px-3 rounded-full shadow-xs">
                  Tienda de bienestar
                </div>

                {/* Entrega en agencia */}
                <div className="bg-white rounded-xl p-3 shadow-xs flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Entrega:
                    </p>
                    <p className="text-sm font-black text-[#DE1C24]">
                      {data.tipoEntrega || "En agencia"}
                    </p>
                  </div>
                  <div className="h-8 w-8 text-[#DE1C24] flex items-center justify-center">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-7 w-7"
                    >
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </div>
                </div>

                {/* Impresión de rótulo */}
                <div className="text-center pt-1">
                  <p className="text-[9.5px] font-semibold text-slate-500">
                    Impresión de rótulo:
                  </p>
                  <p className="text-[10px] font-black text-slate-800 border-b border-slate-400 pb-0.5">
                    {fechaRótulo}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Canvas oculto para la generación fiel de la imagen en alta definición */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Botonera de Acciones */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>Listo para WhatsApp o impresión</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Copiar Imagen */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopiarImagen}
              className="gap-1.5 text-xs font-semibold"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copiar Imagen</span>
                </>
              )}
            </Button>

            {/* Imprimir */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImprimir}
              className="gap-1.5 text-xs font-semibold"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimir</span>
            </Button>

            {/* Descargar PNG */}
            <Button
              type="button"
              size="sm"
              onClick={handleDescargarPNG}
              disabled={downloading}
              className="gap-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Descargar Imagen PNG</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
