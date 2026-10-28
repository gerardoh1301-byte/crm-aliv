"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShoppingBag,
  Truck,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Send,
  Phone,
  MapPin,
  PackageCheck,
  Search,
  HardDrive,
  Copy,
  RefreshCw,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { toast } from "sonner";
import {
  API_PEDIDOS,
  ETIQUETA_ESTADO_PEDIDO,
  TRANSPORTADORAS_PERU,
  MODALIDADES_PAGO,
  type EstadoPedido,
  type PedidoConContacto,
} from "../tipos";

const ESTILO_ESTADO: Record<EstadoPedido, string> = {
  por_confirmar_cod: "bg-amber-50 text-amber-800 border-amber-200",
  confirmado: "bg-violet-50 text-violet-800 border-violet-200",
  preparando: "bg-blue-50 text-blue-800 border-blue-200",
  enviado: "bg-sky-50 text-sky-800 border-sky-200",
  entregado: "bg-emerald-50 text-emerald-800 border-emerald-200",
  cancelado: "bg-rose-50 text-rose-800 border-rose-200",
};

function formatearSoles(monto: string | number | null | undefined): string {
  const n = Number(monto ?? 0);
  return `S/ ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function formatearFecha(f: string | Date | null | undefined): string {
  if (!f) return "—";
  const d = typeof f === "string" ? new Date(f) : f;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

interface ContactoSimple {
  id: string;
  name: string;
  phone: string | null;
}

interface ProductoSimple {
  id: string;
  sku: string | null;
  titulo: string;
  precio: string;
}

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<PedidoConContacto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [driveStatus, setDriveStatus] = useState<{
    carpeta: string;
    sincronizadoEn: string;
    urlPublica: string | null;
  } | null>(null);
  const [syncingDrive, setSyncingDrive] = useState(false);

  const sincronizarDriveManual = useCallback(async (silencioso = false) => {
    setSyncingDrive(true);
    try {
      const res = await fetch("/api/drive-sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDriveStatus({
          carpeta: data.carpeta,
          sincronizadoEn: data.sincronizadoEn,
          urlPublica: data.urlPublica,
        });
        if (!silencioso) {
          toast.success(`Guardado automático en Google Drive (${data.carpeta})`);
        }
      }
    } catch {
      if (!silencioso) toast.error("No se pudo sincronizar con Drive");
    } finally {
      setSyncingDrive(false);
    }
  }, []);

  // Dialogo de Despacho / Guia
  const [despachoPedido, setDespachoPedido] = useState<PedidoConContacto | null>(null);
  const [transportadora, setTransportadora] = useState<string>(TRANSPORTADORAS_PERU[0]);
  const [numeroGuia, setNumeroGuia] = useState("");
  const [claveRecojo, setClaveRecojo] = useState("");
  const [notificarCliente, setNotificarCliente] = useState(true);
  const [guardandoDespacho, setGuardandoDespacho] = useState(false);

  // Dialogo de Nuevo Pedido Manual
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [contactos, setContactos] = useState<ContactoSimple[]>([]);
  const [catalogo, setCatalogo] = useState<ProductoSimple[]>([]);
  const [nuevoForm, setNuevoForm] = useState({
    contactId: "",
    skuProducto: "",
    cantidad: "1",
    modalidadPago: "contraentrega",
    ciudad: "Lima",
    distrito: "",
    direccionEnvio: "",
    dniCliente: "",
    notas: "",
  });

  const cargarPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API_PEDIDOS);
      const data = await res.json();
      setPedidos(Array.isArray(data) ? data : []);
    } catch {
      toast.error("No se pudieron cargar los pedidos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarPedidos();
    sincronizarDriveManual(true);
  }, [cargarPedidos, sincronizarDriveManual]);

  const abrirNuevoPedido = async () => {
    setNuevoOpen(true);
    try {
      const [resC, resP] = await Promise.all([
        fetch("/api/contacts"),
        fetch("/api/m/catalogo"),
      ]);
      const dataC = await resC.json();
      const dataP = await resP.json();
      const listaContactos: ContactoSimple[] = Array.isArray(dataC)
        ? dataC
        : Array.isArray(dataC?.contacts)
        ? dataC.contacts
        : [];
      const listaProductos: ProductoSimple[] = Array.isArray(dataP) ? dataP : [];
      setContactos(listaContactos);
      setCatalogo(listaProductos);
      setNuevoForm((f) => ({
        ...f,
        contactId: listaContactos[0]?.id ?? "",
        skuProducto: listaProductos[0]?.sku ?? listaProductos[0]?.id ?? "",
      }));
    } catch {
      /* continúa con lista vacía */
    }
  };

  const crearPedidoManual = async () => {
    if (!nuevoForm.contactId) {
      toast.error("Selecciona un cliente");
      return;
    }
    const prod =
      catalogo.find((p) => p.sku === nuevoForm.skuProducto || p.id === nuevoForm.skuProducto) ??
      catalogo[0];
    if (!prod) {
      toast.error("Selecciona un producto del catálogo");
      return;
    }
    const cant = Math.max(1, Number(nuevoForm.cantidad) || 1);
    const precioUnitario = Number(prod.precio) || 99;

    const res = await fetch(API_PEDIDOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: nuevoForm.contactId,
        modalidadPago: nuevoForm.modalidadPago,
        estado: "confirmado",
        ciudad: nuevoForm.ciudad,
        distrito: nuevoForm.distrito,
        direccionEnvio: nuevoForm.direccionEnvio,
        dniCliente: nuevoForm.dniCliente,
        notas: nuevoForm.notas,
        items: [
          {
            sku: prod.sku ?? "ALIV-PROD",
            titulo: prod.titulo,
            cantidad: cant,
            precioUnitario,
          },
        ],
      }),
    });

    if (res.ok) {
      const creado = await res.json();
      toast.success(`Pedido ${creado.numeroOrden} registrado`);
      setNuevoOpen(false);
      cargarPedidos();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "No se pudo registrar el pedido");
    }
  };

  const cambiarEstado = async (pedido: PedidoConContacto, nuevoEstado: EstadoPedido) => {
    const res = await fetch(`${API_PEDIDOS}/${pedido.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    });
    if (res.ok) {
      toast.success(
        `Pedido ${pedido.numeroOrden} → ${ETIQUETA_ESTADO_PEDIDO[nuevoEstado]}`
      );
      cargarPedidos();
    } else {
      toast.error("No se pudo actualizar el pedido");
    }
  };

  const abrirModalDespacho = (p: PedidoConContacto) => {
    setDespachoPedido(p);
    const esLima = (p.ciudad ?? "").toLowerCase().includes("lima");
    setTransportadora(
      p.transportadora || (esLima ? "Motorizado Aliv (Lima)" : "Shalom Empresarial")
    );
    setNumeroGuia(p.numeroGuia ?? "");
    setClaveRecojo(p.claveRecojo ?? "");
    setNotificarCliente(true);
  };

  const confirmarDespacho = async () => {
    if (!despachoPedido) return;
    setGuardandoDespacho(true);
    try {
      const res = await fetch(`${API_PEDIDOS}/${despachoPedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "enviado",
          transportadora: transportadora.trim(),
          numeroGuia: numeroGuia.trim() || null,
          claveRecojo: claveRecojo.trim() || null,
          notificarCliente,
        }),
      });
      if (res.ok) {
        toast.success(
          notificarCliente
            ? `Pedido ${despachoPedido.numeroOrden} despachado y guía enviada al cliente`
            : `Pedido ${despachoPedido.numeroOrden} marcado como despachado`
        );
        setDespachoPedido(null);
        cargarPedidos();
      } else {
        toast.error("No se pudo guardar el despacho");
      }
    } finally {
      setGuardandoDespacho(false);
    }
  };

  // KPIs
  const porConfirmar = pedidos.filter((p) => p.estado === "por_confirmar_cod").length;
  const confirmados = pedidos.filter(
    (p) => p.estado === "confirmado" || p.estado === "preparando"
  ).length;
  const enCamino = pedidos.filter((p) => p.estado === "enviado").length;
  const entregados = pedidos.filter((p) => p.estado === "entregado");
  const totalCobrado = entregados.reduce((acc, p) => acc + (Number(p.total) || 0), 0);

  const filtrados = pedidos.filter((p) => {
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      p.numeroOrden.toLowerCase().includes(q) ||
      (p.contactName ?? "").toLowerCase().includes(q) ||
      (p.contactPhone ?? "").toLowerCase().includes(q) ||
      (p.ciudad ?? "").toLowerCase().includes(q) ||
      (p.distrito ?? "").toLowerCase().includes(q) ||
      (p.numeroGuia ?? "").toLowerCase().includes(q) ||
      (p.dniCliente ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos COD — Aliv Store"
        subtitle="Gestión de órdenes Contraentrega, despachos por Motorizado Lima / Shalom / Olva Courier y guardado automático en Google Drive."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sincronizarDriveManual(false)}
              disabled={syncingDrive}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${syncingDrive ? "animate-spin" : ""}`}
              />
              {syncingDrive ? "Guardando en Drive..." : "Sincronizar Google Drive"}
            </Button>
            <Button size="sm" onClick={abrirNuevoPedido}>
              <Plus className="mr-1.5 h-4 w-4" />
              Registrar Pedido COD
            </Button>
          </div>
        }
      />

      {/* Banner de Sincronizacion Google Drive y Enlace Web Publico para Vendedores */}
      <Card className="p-3.5 border-emerald-200/80 bg-emerald-50/40 dark:bg-emerald-950/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-start sm:items-center gap-2.5">
            <HardDrive className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-semibold text-foreground">
                Respaldo automático en Google Drive activo:{" "}
              </span>
              <code className="rounded bg-background px-1.5 py-0.5 border text-[11px]">
                {driveStatus?.carpeta ?? "G:\\Mi unidad\\Aliv Store CRM"}
              </code>
              <span className="text-muted-foreground ml-2">
                (Archivos: Pedidos_COD_AlivStore.csv · Contactos_Clientes_AlivStore.csv · Catalogo_Productos_AlivStore.csv)
              </span>
            </div>
          </div>
          {driveStatus?.urlPublica && (
            <div className="flex items-center gap-2 shrink-0">
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Enlace Vendedores:</span>
              <code className="rounded bg-background px-2 py-0.5 border font-mono text-[11px]">
                {driveStatus.urlPublica}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(driveStatus.urlPublica!);
                  toast.success("Enlace público copiado para compartir con tus vendedores");
                }}
              >
                <Copy className="h-3 w-3 mr-1" /> Copiar
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Tarjetas de resumen operativo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Por confirmar COD</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">{porConfirmar}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Requieren validación de datos</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Listos para despacho</span>
            <PackageCheck className="h-4 w-4 text-violet-600" />
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">{confirmados}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Pendientes de guía o motorizado</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>En camino (Tránsito)</span>
            <Truck className="h-4 w-4 text-sky-600" />
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">{enCamino}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Motorizado / Shalom / Olva</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Entregados y Cobrados</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {formatearSoles(totalCobrado)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entregados.length} órdenes completadas
          </p>
        </Card>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "todos", label: "Todos" },
            { id: "por_confirmar_cod", label: "Por confirmar COD" },
            { id: "confirmado", label: "Confirmados" },
            { id: "enviado", label: "En camino" },
            { id: "entregado", label: "Entregados" },
            { id: "cancelado", label: "Cancelados" },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={filtroEstado === tab.id ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFiltroEstado(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 text-muted-foreground absolute left-2.5 top-2.5" />
          <Input
            placeholder="Buscar #ALIV, cliente, DNI, guía..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Cargando pedidos de Aliv Store...
        </Card>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No hay pedidos en esta vista"
          description="Los pedidos creados por el Agente IA en WhatsApp/Instagram o sincronizados desde Shopify aparecerán aquí."
          actionLabel="Registrar primer pedido COD"
          onAction={abrirNuevoPedido}
        />
      ) : (
        <Card className="surface-card overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Orden / Fecha</TableHead>
                  <TableHead>Cliente / Destino</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead>Total COD</TableHead>
                  <TableHead className="hidden lg:table-cell">Envío / Guía</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acción rápida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-mono font-semibold text-sm">{p.numeroOrden}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatearFecha(p.createdAt)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm leading-tight">
                        {p.contactName ?? "Cliente"}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        {p.contactPhone && (
                          <span className="inline-flex items-center gap-0.5">
                            <Phone className="h-3 w-3" /> {p.contactPhone}
                          </span>
                        )}
                        {p.dniCliente && <span>· DNI {p.dniCliente}</span>}
                      </p>
                      {(p.distrito || p.ciudad || p.direccionEnvio) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 max-w-xs truncate">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {[p.distrito, p.ciudad, p.direccionEnvio]
                            .filter(Boolean)
                            .join(" — ")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5 max-w-xs">
                        {(p.items ?? []).map((it, idx) => (
                          <p key={idx} className="text-xs leading-snug">
                            <span className="font-semibold">{it.cantidad}x</span> {it.titulo}
                          </p>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <p className="font-semibold text-sm">{formatearSoles(p.total)}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {p.modalidadPago.replace(/_/g, " ")}
                      </p>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      {p.transportadora ? (
                        <div>
                          <p className="font-medium">{p.transportadora}</p>
                          {p.numeroGuia && (
                            <p className="font-mono text-muted-foreground">
                              Guía: {p.numeroGuia}
                              {p.claveRecojo ? ` (Clave: ${p.claveRecojo})` : ""}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Sin despachar</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={ESTILO_ESTADO[p.estado] ?? ""}
                      >
                        {ETIQUETA_ESTADO_PEDIDO[p.estado] ?? p.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {p.estado === "por_confirmar_cod" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => cambiarEstado(p, "confirmado")}
                          >
                            Confirmar COD
                          </Button>
                        )}
                        {(p.estado === "por_confirmar_cod" ||
                          p.estado === "confirmado" ||
                          p.estado === "preparando") && (
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => abrirModalDespacho(p)}
                          >
                            <Truck className="mr-1 h-3.5 w-3.5" />
                            Despachar
                          </Button>
                        )}
                        {p.estado === "enviado" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => cambiarEstado(p, "entregado")}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Entregado
                          </Button>
                        )}
                        {p.estado !== "cancelado" && p.estado !== "entregado" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Cancelar pedido"
                            onClick={() => cambiarEstado(p, "cancelado")}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Modal de Despacho y Envio de Guia por WhatsApp */}
      <Dialog
        open={Boolean(despachoPedido)}
        onOpenChange={(o) => !o && setDespachoPedido(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Despachar Pedido {despachoPedido?.numeroOrden}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">
                Cliente: {despachoPedido?.contactName} ({despachoPedido?.contactPhone ?? "sin teléfono"})
              </p>
              <p className="text-muted-foreground">
                Destino:{" "}
                {[
                  despachoPedido?.distrito,
                  despachoPedido?.ciudad,
                  despachoPedido?.direccionEnvio,
                ]
                  .filter(Boolean)
                  .join(" — ") || "Por definir"}
              </p>
              <p className="font-semibold text-foreground">
                Total a cobrar/confirmar: {formatearSoles(despachoPedido?.total)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Empresa de envío / Reparto</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={transportadora}
                onChange={(e) => setTransportadora(e.target.value)}
              >
                {TRANSPORTADORAS_PERU.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Número de Guía / Orden</Label>
                <Input
                  placeholder="Ej. SH-849201 o Motorizado"
                  value={numeroGuia}
                  onChange={(e) => setNumeroGuia(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Clave de Recojo (Shalom)</Label>
                <Input
                  placeholder="Ej. 4829 (opcional)"
                  value={claveRecojo}
                  onChange={(e) => setClaveRecojo(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={notificarCliente}
                onChange={(e) => setNotificarCliente(e.target.checked)}
              />
              <div className="text-xs">
                <p className="font-medium">
                  Avisar automáticamente al cliente por su chat activo
                </p>
                <p className="text-muted-foreground mt-0.5">
                  Envía un mensaje confirmando que su pedido {despachoPedido?.numeroOrden} ya está en camino con los datos de seguimiento.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDespachoPedido(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarDespacho} disabled={guardandoDespacho}>
              <Send className="mr-1.5 h-4 w-4" />
              {guardandoDespacho ? "Procesando..." : "Confirmar Despacho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal para Registrar Nuevo Pedido COD manualmente */}
      <Dialog open={nuevoOpen} onOpenChange={setNuevoOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar Nuevo Pedido COD — Aliv Store</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={nuevoForm.contactId}
                onChange={(e) =>
                  setNuevoForm({ ...nuevoForm, contactId: e.target.value })
                }
              >
                {contactos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Producto Aliv Store</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={nuevoForm.skuProducto}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, skuProducto: e.target.value })
                  }
                >
                  {catalogo.map((p) => (
                    <option key={p.id} value={p.sku ?? p.id}>
                      {p.titulo} — S/ {Number(p.precio).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  value={nuevoForm.cantidad}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, cantidad: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Modalidad de Pago</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={nuevoForm.modalidadPago}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, modalidadPago: e.target.value })
                  }
                >
                  {MODALIDADES_PAGO.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>DNI del Cliente</Label>
                <Input
                  placeholder="Ej. 72849102"
                  value={nuevoForm.dniCliente}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, dniCliente: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ciudad / Departamento</Label>
                <Input
                  placeholder="Lima, Arequipa, Trujillo..."
                  value={nuevoForm.ciudad}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, ciudad: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Distrito</Label>
                <Input
                  placeholder="Miraflores, Surco, Yanahuara..."
                  value={nuevoForm.distrito}
                  onChange={(e) =>
                    setNuevoForm({ ...nuevoForm, distrito: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Dirección Exacta o Sede Agencia Shalom / Olva</Label>
              <Input
                placeholder="Av. Arequipa 1240 Dpto 302 / Agencia Shalom Av. Grau"
                value={nuevoForm.direccionEnvio}
                onChange={(e) =>
                  setNuevoForm({ ...nuevoForm, direccionEnvio: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notas de entrega / Horario</Label>
              <Textarea
                rows={2}
                placeholder="Entregar en horario de tarde, llamar al llegar..."
                value={nuevoForm.notas}
                onChange={(e) =>
                  setNuevoForm({ ...nuevoForm, notas: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNuevoOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={crearPedidoManual}>Guardar Pedido COD</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
