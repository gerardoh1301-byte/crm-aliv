"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, ExternalLink, CloudOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface EstadoDrive {
  configurado: boolean;
  conectado: boolean;
  cuenta: string | null;
  esAdmin: boolean;
}

/**
 * Sube la preguía / guía PDF de Shalom a Drive («Nombre - fecha del pedido - #orden.pdf») y, si se marca, el bot
 * le envía al cliente la imagen de la guía con una pregunta (solo dentro de las 24 h).
 */
export function GuiaPdfDrive({
  pedidoId,
  antesDeSubir,
  enviarPorDefecto = true,
}: {
  pedidoId: string;
  /** Guarda primero N° de orden y código, para que el mensaje los lleve. */
  antesDeSubir?: () => Promise<unknown>;
  /** Desde la ficha del contacto la casilla viene apagada (se envía solo si la marcan). */
  enviarPorDefecto?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoDrive | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [enviar, setEnviar] = useState(enviarPorDefecto);
  const [resultado, setResultado] = useState<{ archivo?: string; pdfUrl?: string | null; envio?: { enviado: boolean; motivo?: string } } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/google/drive/estado")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && setEstado(j))
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, []);

  const subir = async (archivo: File) => {
    setSubiendo(true);
    setResultado(null);
    try {
      if (antesDeSubir) await antesDeSubir();
      const form = new FormData();
      form.set("pedidoId", pedidoId);
      form.set("archivo", archivo);
      form.set("enviar", enviar ? "1" : "0");
      const r = await fetch("/api/pedidos/guia-pdf", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo subir la guía");
      setResultado(j);
      if (j.envio?.enviado) toast.success("Guía guardada en Drive y enviada al cliente 📦");
      else if (enviar) toast.warning(`Guía guardada en Drive. No se envió: ${j.envio?.motivo ?? "sin detalle"}`, { duration: 8000 });
      else toast.success("Guía guardada en Drive");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al subir la guía");
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  };

  if (!estado) return null;

  return (
    <div className="rounded-md border border-dashed p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold flex items-center gap-1">
          <FileUp className="h-3.5 w-3.5 text-red-600" /> Preguía / guía PDF (Drive)
        </span>
        {estado.conectado && estado.cuenta && (
          <span className="text-[9.5px] text-muted-foreground truncate">{estado.cuenta}</span>
        )}
      </div>

      {!estado.configurado || !estado.conectado ? (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <CloudOff className="h-3.5 w-3.5" />
          {!estado.configurado ? (
            <span>Drive no está configurado en el servidor.</span>
          ) : estado.esAdmin ? (
            <a href="/api/google/drive/conectar" target="_blank" rel="noopener" className="text-red-600 font-semibold underline">
              Conectar Drive
            </a>
          ) : (
            <span>Pide a un administrador que conecte Drive.</span>
          )}
        </div>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={subiendo} onClick={() => input.current?.click()}>
              {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileUp className="h-3.5 w-3.5 mr-1" />}
              Subir preguía PDF
            </Button>
            <label className="text-[11px] flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
              Enviar la foto al cliente con una pregunta
            </label>
          </div>
          {resultado?.archivo && (
            <p className="text-[10.5px] text-muted-foreground flex items-center gap-1 flex-wrap">
              Guardado: <span className="font-medium text-foreground">{resultado.archivo}</span>
              {resultado.pdfUrl && (
                <a href={resultado.pdfUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-red-600 underline">
                  ver <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
