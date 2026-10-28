"use client";

import { useEffect, useState, useCallback } from "react";
import {
  PackageSearch,
  RefreshCw,
  Plus,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Sparkles,
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

export interface ProductoCatalogo {
  id: string;
  shopifyId: string | null;
  sku: string | null;
  handle: string | null;
  titulo: string;
  categoria: string;
  descripcion: string | null;
  beneficios: string | null;
  precauciones: string | null;
  precio: string;
  precioRegular: string | null;
  moneda: string;
  stock: number;
  disponible: boolean;
  imagenUrl: string | null;
  publicUrl: string | null;
}

const API_CATALOGO = "/api/m/catalogo";

function formatearPrecio(monto: string | null | undefined, moneda = "PEN"): string {
  if (!monto) return "—";
  const num = Number(monto);
  if (!Number.isFinite(num)) return `${moneda} ${monto}`;
  const simbolo = moneda === "PEN" ? "S/" : moneda;
  return `${simbolo} ${num.toFixed(2)}`;
}

export function CatalogoPage() {
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<ProductoCatalogo | null>(null);

  const [form, setForm] = useState({
    titulo: "",
    sku: "",
    categoria: "Bienestar y Salud",
    precio: "99.00",
    precioRegular: "",
    stock: "50",
    descripcion: "",
    beneficios: "",
    precauciones: "",
    publicUrl: "https://alivstore.shop/products/",
    imagenUrl: "",
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(API_CATALOGO);
      const data = await res.json();
      setProductos(Array.isArray(data) ? data : []);
    } catch {
      toast.error("No se pudo cargar el catálogo");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const sincronizarShopify = async () => {
    setSyncing(true);
    try {
      const res = await fetch(API_CATALOGO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_shopify" }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast.success(
          `Catálogo sincronizado (${json.sincronizados} productos de alivstore.shop)`
        );
        cargar();
      } else {
        toast.error(json.error ?? "No se pudo sincronizar con Shopify");
      }
    } catch {
      toast.error("Error de red al sincronizar con Shopify");
    } finally {
      setSyncing(false);
    }
  };

  const abrirNuevo = () => {
    setEditando(null);
    setForm({
      titulo: "",
      sku: "ALIV-NUEVO",
      categoria: "Terapia Térmica y Masaje",
      precio: "99.00",
      precioRegular: "",
      stock: "40",
      descripcion: "",
      beneficios: "",
      precauciones: "",
      publicUrl: "https://alivstore.shop/products/",
      imagenUrl: "",
    });
    setDialogOpen(true);
  };

  const abrirEdicion = (p: ProductoCatalogo) => {
    setEditando(p);
    setForm({
      titulo: p.titulo,
      sku: p.sku ?? "",
      categoria: p.categoria ?? "Bienestar",
      precio: p.precio ?? "99.00",
      precioRegular: p.precioRegular ?? "",
      stock: String(p.stock ?? 50),
      descripcion: p.descripcion ?? "",
      beneficios: p.beneficios ?? "",
      precauciones: p.precauciones ?? "",
      publicUrl: p.publicUrl ?? "",
      imagenUrl: p.imagenUrl ?? "",
    });
    setDialogOpen(true);
  };

  const guardarProducto = async () => {
    if (!form.titulo.trim()) {
      toast.error("El nombre del producto es obligatorio");
      return;
    }
    const payload = {
      titulo: form.titulo.trim(),
      sku: form.sku.trim() || null,
      categoria: form.categoria.trim() || "Bienestar",
      precio: form.precio.trim() || "0",
      precioRegular: form.precioRegular.trim() || null,
      stock: Math.max(0, Number(form.stock) || 0),
      descripcion: form.descripcion.trim() || null,
      beneficios: form.beneficios.trim() || null,
      precauciones: form.precauciones.trim() || null,
      publicUrl: form.publicUrl.trim() || null,
      imagenUrl: form.imagenUrl.trim() || null,
    };

    const url = editando ? `${API_CATALOGO}/${editando.id}` : API_CATALOGO;
    const method = editando ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast.success(editando ? "Producto actualizado" : "Producto creado");
      setDialogOpen(false);
      cargar();
    } else {
      toast.error("No se pudo guardar el producto");
    }
  };

  const alternarDisponible = async (p: ProductoCatalogo) => {
    const res = await fetch(`${API_CATALOGO}/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disponible: !p.disponible }),
    });
    if (res.ok) {
      toast.success(
        !p.disponible ? `${p.titulo} activado para la venta` : `${p.titulo} marcado como agotado`
      );
      cargar();
    }
  };

  const eliminarProducto = async (p: ProductoCatalogo) => {
    if (!confirm(`¿Eliminar "${p.titulo}" del catálogo del CRM?`)) return;
    const res = await fetch(`${API_CATALOGO}/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Producto eliminado");
      cargar();
    }
  };

  const filtrados = productos.filter((p) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      p.titulo.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.categoria ?? "").toLowerCase().includes(q) ||
      (p.descripcion ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo Aliv Store"
        subtitle={`${productos.length} productos activos en Soles (PEN). El agente IA consulta esta tabla en tiempo real antes de responder precios o confirmar pedidos COD.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={sincronizarShopify}
              disabled={syncing}
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando..." : "Sincronizar con alivstore.shop"}
            </Button>
            <Button size="sm" onClick={abrirNuevo}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nuevo producto
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <Input
          placeholder="Buscar por nombre, SKU, síntoma o categoría (ej. NAC600, Termix, migraña, cervical)..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="max-w-md"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Conectado a https://alivstore.shop (Sincronización gratuita sin API de pago)</span>
        </div>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Cargando catálogo de Aliv Store...
        </Card>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No hay productos en el catálogo"
          description="Pulsa 'Sincronizar con alivstore.shop' para importar automáticamente tus productos reales de Shopify."
          actionLabel="Importar catálogo de alivstore.shop"
          onAction={sincronizarShopify}
        />
      ) : (
        <Card className="surface-card overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden md:table-cell">Categoría</TableHead>
                  <TableHead>Precio (PEN)</TableHead>
                  <TableHead className="hidden sm:table-cell">Stock</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {p.imagenUrl ? (
                          <img
                            src={p.imagenUrl}
                            alt={p.titulo}
                            className="h-11 w-11 rounded-md object-cover border bg-muted shrink-0"
                          />
                        ) : (
                          <div className="h-11 w-11 rounded-md border bg-muted flex items-center justify-center shrink-0">
                            <PackageSearch className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium leading-tight truncate max-w-xs sm:max-w-md">
                            {p.titulo}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                            {p.sku && <span className="font-mono">{p.sku}</span>}
                            {p.publicUrl && (
                              <a
                                href={p.publicUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                ver en tienda <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {p.categoria}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <span className="font-semibold text-sm">
                        {formatearPrecio(p.precio, p.moneda)}
                      </span>
                      {p.precioRegular && Number(p.precioRegular) > Number(p.precio) && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {formatearPrecio(p.precioRegular, p.moneda)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm tabular-nums">
                      {p.stock} uds.
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.disponible && p.stock > 0
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-pointer"
                            : "bg-rose-50 text-rose-700 border-rose-200 cursor-pointer"
                        }
                        onClick={() => alternarDisponible(p)}
                      >
                        {p.disponible && p.stock > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> En stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> Agotado
                          </span>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => abrirEdicion(p)}
                          title="Editar producto"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => eliminarProducto(p)}
                          title="Eliminar producto"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editando ? `Editar: ${editando.titulo}` : "Nuevo Producto Aliv Store"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre del producto</Label>
              <Input
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                placeholder="Ej. Termix Tobillera – Calor y Masaje"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="ALIV-TERMIX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Input
                  value={form.categoria}
                  onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                  placeholder="Terapia Térmica"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Precio Venta (S/)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.precio}
                  onChange={(e) => setForm({ ...form, precio: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Precio Regular (S/)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.precioRegular}
                  onChange={(e) => setForm({ ...form, precioRegular: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Stock disponible</Label>
                <Input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción y Modo de Uso (leído por el Agente IA)</Label>
              <Textarea
                rows={3}
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Qué incluye, cómo funciona y cómo se usa..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Beneficios Clave</Label>
              <Textarea
                rows={2}
                value={form.beneficios}
                onChange={(e) => setForm({ ...form, beneficios: e.target.value })}
                placeholder="Para qué sirve y qué alivia..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precauciones / Contraindicaciones</Label>
              <Textarea
                rows={2}
                value={form.precauciones}
                onChange={(e) => setForm({ ...form, precauciones: e.target.value })}
                placeholder="Restricciones médicas o advertencias..."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Link del producto en tienda</Label>
                <Input
                  value={form.publicUrl}
                  onChange={(e) => setForm({ ...form, publicUrl: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>URL de Imagen</Label>
                <Input
                  value={form.imagenUrl}
                  onChange={(e) => setForm({ ...form, imagenUrl: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={guardarProducto}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
