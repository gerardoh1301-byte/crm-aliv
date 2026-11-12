"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Copy, ExternalLink, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SeguimientoShalomModal,
  type SeguimientoShalomData,
} from "@/components/pipeline/SeguimientoShalomModal";

/**
 * Boton "Adelanto confirmado" (semiautomatico) para pedidos de provincia.
 *
 * 1. Una persona verifica el Yape de S/20 y presiona el boton: queda registrado quien y cuando.
 * 2. El panel arma los datos para Shalom Pro (con los faltantes en rojo), los copia y abre Shalom Pro.
 * 3. Con el N° de orden, codigo y clave de Shalom, abre el modal de seguimiento de siempre,
 *    que guarda y envia el mensaje al cliente. El boton verde del pipeline sigue de respaldo.
 */

interface PedidoAbierto {
  id: string;
  numeroOrden: string;
  dealId: string | null;
  estado: string;
  items: Array<{ titulo?: string; cantidad?: number }> | null;
  total: string;
  dniCliente: string | null;
  ciudad: string | null;
  distrito: string | null;
  direccionEnvio: string | null;
  numeroGuia: string | null;
  codigoRastreo: string | null;
  claveRecojo: string | null;
  esProvincia: boolean;
  adelantoConfirmado: boolean;
}

const CLAVE_URL_SHALOM = "aliv.shalomProUrl";

function leerUrlShalom(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CLAVE_URL_SHALOM) ?? "";
  } catch {
    return "";
  }
}

function esCelularPeruano(tel: string): boolean {
  return /^(\+?51)?9\d{8}$/.test(tel.replace(/[\s-]/g, ""));
}

export function AdelantoConfirmadoPanel({ contactId }: { contactId: string }) {
  const [pedidos, setPedidos] = useState<PedidoAbierto[]>([]);
  const [contacto, setContacto] = useState<{ name: string; phone: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activo, setActivo] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [celular, setCelular] = useState("");
  const [agencia, setAgencia] = useState("");
  const [urlShalom, setUrlShalom] = useState(leerUrlShalom);
  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/pedidos/adelanto?contactId=${encodeURIComponent(contactId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setContacto(data.contacto ?? null);
      setPedidos((data.pedidos ?? []).filter((p: PedidoAbierto) => p.esProvincia && !p.numeroGuia));
    } catch {
      /* el panel es opcional: si falla, no se muestra */
    }
  }, [contactId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pedido = pedidos.find((p) => p.id === activo) ?? null;

  const prepararDatos = (p: PedidoAbierto) => {
    setActivo(p.id);
    setNombre(contacto?.name ?? "");
    setDni(p.dniCliente ?? "");
    const tel = (contacto?.phone ?? "").replace(/^\+?51/, "");
    setCelular(esCelularPeruano(contacto?.phone ?? "") ? tel : "");
    setAgencia([p.ciudad, p.direccionEnvio].filter(Boolean).join(" - "));
  };

  const confirmarAdelanto = async (p: PedidoAbierto) => {
    const ok = window.confirm(
      `¿Verificaste en tu Yape el adelanto de S/20 del pedido ${p.numeroOrden}?\n\nQuedará registrado a tu nombre.`
    );
    if (!ok) return;
    setBusy(p.id);
    try {
      const res = await fetch("/api/pedidos/adelanto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId: p.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo registrar");
      toast.success(`Adelanto de ${p.numeroOrden} registrado. Ahora regístralo en Shalom Pro.`);
      await cargar();
      prepararDatos({ ...p, adelantoConfirmado: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al registrar el adelanto");
    } finally {
      setBusy(null);
    }
  };

  const totalNum = pedido ? Number(pedido.total) || 0 : 0;
  const saldo = Math.max(0, totalNum - 20);
  const productos = pedido?.items?.map((i) => `${i.cantidad ?? 1} x ${i.titulo ?? "Producto"}`).join(", ") ?? "";

  const faltantes = [
    !nombre.trim() && "nombre",
    !/^\d{8}$/.test(dni.trim()) && "DNI (8 dígitos)",
    !esCelularPeruano(celular) && "celular",
    !agencia.trim() && "agencia",
  ].filter(Boolean) as string[];

  const textoShalom = pedido
    ? [
        `Destinatario: ${nombre.trim()}`,
        `DNI: ${dni.trim()}`,
        `Celular: ${celular.trim()}`,
        `Agencia destino: ${agencia.trim()}`,
        `Contenido: ${productos}`,
        `Valor: S/ ${totalNum.toFixed(2)} (saldo a cobrar S/ ${saldo.toFixed(2)})`,
        `Pedido: ${pedido.numeroOrden}`,
      ].join("\n")
    : "";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoShalom);
      toast.success("Datos copiados para Shalom Pro");
    } catch {
      toast.error("No se pudo copiar");
    }
    if (pedido && dni.trim() && dni.trim() !== (pedido.dniCliente ?? "")) {
      void fetch("/api/pedidos/adelanto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedidoId: pedido.id, soloDatos: true, dni: dni.trim() }),
      });
    }
  };

  const abrirShalom = () => {
    let url = urlShalom.trim();
    if (!url) {
      url = window.prompt("Pega una sola vez el enlace de tu Shalom Pro (se guarda en este navegador):", "") ?? "";
      url = url.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        localStorage.setItem(CLAVE_URL_SHALOM, url);
      } catch {
        /* sin almacenamiento: se pedira de nuevo */
      }
      setUrlShalom(url);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (pedidos.length === 0) return null;

  const datosModal: SeguimientoShalomData | null = pedido
    ? {
        pedidoId: pedido.id,
        dealId: pedido.dealId,
        contactId,
        numeroOrden: pedido.numeroOrden,
        clienteNombre: nombre.trim() || contacto?.name || "Cliente",
        telefono: contacto?.phone ?? null,
        dni: dni.trim() || null,
        ciudad: pedido.ciudad,
        distrito: pedido.distrito,
        direccion: agencia.trim() || pedido.direccionEnvio,
        total: totalNum,
        numeroGuia: pedido.numeroGuia,
        codigoRastreo: pedido.codigoRastreo,
        claveRecojo: pedido.claveRecojo,
        transportadora: "Shalom",
        estadoPedido: "enviado",
      }
    : null;

  return (
    <div className="px-4 py-4 border-b border-border space-y-2.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Truck className="h-3 w-3" />
        Envío a provincia
      </Label>

      {pedidos.map((p) => (
        <div key={p.id} className="rounded-md border border-border px-2.5 py-2 text-[12px] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{p.numeroOrden}</span>
            <span className="text-muted-foreground">
              S/ {(Number(p.total) || 0).toFixed(2)} · saldo S/ {Math.max(0, (Number(p.total) || 0) - 20).toFixed(2)}
            </span>
          </div>
          {p.adelantoConfirmado ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                <BadgeCheck className="h-3.5 w-3.5" /> Adelanto verificado
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px] ml-auto cursor-pointer"
                onClick={() => prepararDatos(p)}
              >
                Registrar en Shalom
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={busy === p.id}
              className="w-full h-8 text-xs cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => confirmarAdelanto(p)}
            >
              <BadgeCheck className="h-3.5 w-3.5 mr-1" />
              {busy === p.id ? "Registrando…" : "Adelanto confirmado"}
            </Button>
          )}
        </div>
      ))}

      {pedido && pedido.adelantoConfirmado && (
        <div className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 px-2.5 py-2.5 space-y-2 text-[12px]">
          <p className="font-medium">Datos para Shalom Pro · {pedido.numeroOrden}</p>
          <div className="grid gap-1.5">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" className={!nombre.trim() ? "border-red-400 h-8 text-xs" : "h-8 text-xs"} />
            <Input value={dni} onChange={(e) => setDni(e.target.value)} placeholder="DNI" inputMode="numeric" className={!/^\d{8}$/.test(dni.trim()) ? "border-red-400 h-8 text-xs" : "h-8 text-xs"} />
            <Input value={celular} onChange={(e) => setCelular(e.target.value)} placeholder="Celular (9 dígitos)" inputMode="tel" className={!esCelularPeruano(celular) ? "border-red-400 h-8 text-xs" : "h-8 text-xs"} />
            <Input value={agencia} onChange={(e) => setAgencia(e.target.value)} placeholder="Agencia Shalom destino" className={!agencia.trim() ? "border-red-400 h-8 text-xs" : "h-8 text-xs"} />
          </div>
          <p className="text-muted-foreground">{productos} · S/ {totalNum.toFixed(2)} · saldo S/ {saldo.toFixed(2)}</p>
          {faltantes.length > 0 && (
            <p className="text-red-600 dark:text-red-400">Falta: {faltantes.join(", ")}. Pídeselo al cliente antes de registrar.</p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs flex-1 cursor-pointer" onClick={copiar}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copiar datos
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs flex-1 cursor-pointer" onClick={abrirShalom}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir Shalom Pro
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full h-8 text-xs cursor-pointer"
            onClick={() => setModalAbierto(true)}
          >
            Ya lo registré: ingresar N° de orden y enviar
          </Button>
          {urlShalom && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground underline cursor-pointer"
              onClick={() => {
                try { localStorage.removeItem(CLAVE_URL_SHALOM); } catch { /* nada */ }
                setUrlShalom("");
              }}
            >
              Cambiar enlace de Shalom Pro
            </button>
          )}
        </div>
      )}

      {datosModal && (
        <SeguimientoShalomModal
          open={modalAbierto}
          onOpenChange={(o) => {
            setModalAbierto(o);
            if (!o) void cargar();
          }}
          data={datosModal}
          onUpdated={() => void cargar()}
        />
      )}
    </div>
  );
}
