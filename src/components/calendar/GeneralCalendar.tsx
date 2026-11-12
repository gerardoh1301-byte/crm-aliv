"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Truck,
  DollarSign,
  Phone,
  Mail,
  Users,
  CheckCircle2,
  AlertCircle,
  Search,
  Plus,
  MapPin,
  MessageSquare,
  FileText,
  CalendarDays,
  ListFilter,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isPast,
  isTomorrow,
  addDays,
} from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ActivityForm } from "@/components/activities/ActivityForm";

export interface CalendarActivity {
  id: string;
  type: string;
  description: string;
  contactId: string;
  dealId?: string | null;
  scheduledAt: string | number | Date | null;
  completedAt?: string | number | Date | null;
  createdAt: string | number | Date;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

interface GeneralCalendarProps {
  initialActivities: CalendarActivity[];
  onRefresh?: () => void;
}

const TIPO_CONFIG: Record<
  string,
  { label: string; icon: typeof Truck; badgeClass: string; borderClass: string; bgClass: string }
> = {
  delivery: {
    label: "Entrega / Envío",
    icon: Truck,
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200",
    borderClass: "border-l-4 border-l-emerald-500",
    bgClass: "bg-emerald-50/50 dark:bg-emerald-950/20",
  },
  payment: {
    label: "Cobro / Pago",
    icon: DollarSign,
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200",
    borderClass: "border-l-4 border-l-amber-500",
    bgClass: "bg-amber-50/50 dark:bg-amber-950/20",
  },
  call: {
    label: "Llamada",
    icon: Phone,
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200",
    borderClass: "border-l-4 border-l-sky-500",
    bgClass: "bg-sky-50/50 dark:bg-sky-950/20",
  },
  follow_up: {
    label: "Seguimiento",
    icon: Clock,
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200",
    borderClass: "border-l-4 border-l-indigo-500",
    bgClass: "bg-indigo-50/50 dark:bg-indigo-950/20",
  },
  meeting: {
    label: "Reunión",
    icon: Users,
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200",
    borderClass: "border-l-4 border-l-purple-500",
    bgClass: "bg-purple-50/50 dark:bg-purple-950/20",
  },
  note: {
    label: "Nota",
    icon: FileText,
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300 border-slate-200",
    borderClass: "border-l-4 border-l-slate-400",
    bgClass: "bg-slate-50/50 dark:bg-slate-900/20",
  },
};

export function GeneralCalendar({ initialActivities, onRefresh }: GeneralCalendarProps) {
  const [activities, setActivities] = useState<CalendarActivity[]>(initialActivities);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"month" | "agenda">("agenda");
  const [filtroTipo, setFiltroTipo] = useState<string>("all");
  const [busqueda, setBusqueda] = useState<string>("");
  const [showForm, setShowForm] = useState<boolean>(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Filtrar actividades con fecha programada
  const scheduledActivities = useMemo(() => {
    return activities.filter((a) => {
      // Solo actividades con fecha de compromiso en el calendario
      if (!a.scheduledAt) return false;

      // Filtro de tipo
      if (filtroTipo === "delivery" && a.type !== "delivery") return false;
      if (filtroTipo === "payment" && a.type !== "payment") return false;
      if (filtroTipo === "call" && a.type !== "call") return false;
      if (filtroTipo === "follow_up" && a.type !== "follow_up") return false;
      if (filtroTipo === "completed" && !a.completedAt) return false;
      if (filtroTipo === "pending" && a.completedAt) return false;

      // Filtro de búsqueda
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const matchesName = a.contactName?.toLowerCase().includes(q);
        const matchesPhone = a.contactPhone?.toLowerCase().includes(q);
        const matchesDesc = a.description.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesDesc) return false;
      }

      return true;
    });
  }, [activities, filtroTipo, busqueda]);

  // Contadores para chips rápidos (solo actividades agendadas)
  const contadores = useMemo(() => {
    const programadas = activities.filter((a) => a.scheduledAt != null);
    const totalProgramadas = programadas.length;
    const totalEntregas = programadas.filter((a) => a.type === "delivery" && !a.completedAt).length;
    const totalCobros = programadas.filter((a) => a.type === "payment" && !a.completedAt).length;
    const totalLlamadas = programadas.filter((a) => (a.type === "call" || a.type === "follow_up") && !a.completedAt).length;
    const totalCompletadas = programadas.filter((a) => a.completedAt).length;
    return { totalProgramadas, totalEntregas, totalCobros, totalLlamadas, totalCompletadas };
  }, [activities]);

  // Cuadrícula del mes
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Lunes
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [startDate, endDate]);

  // Marcar como completado
  const handleToggleComplete = async (activity: CalendarActivity) => {
    setMarkingId(activity.id);
    const nuevoEstado = !activity.completedAt;
    try {
      const res = await fetch(`/api/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completedAt: nuevoEstado ? new Date().toISOString() : null }),
      });
      if (res.ok) {
        setActivities((prev) =>
          prev.map((a) =>
            a.id === activity.id ? { ...a, completedAt: nuevoEstado ? new Date() : null } : a
          )
        );
        onRefresh?.();
      }
    } catch (err) {
      console.error("Error actualizando actividad:", err);
    } finally {
      setMarkingId(null);
    }
  };

  // Agrupación para la vista de Agenda
  const agendaGrupos = useMemo(() => {
    const conFecha = scheduledActivities
      .filter((a) => a.scheduledAt)
      .map((a) => ({ ...a, dateObj: new Date(a.scheduledAt!) }))
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    const vencidas: typeof conFecha = [];
    const hoy: typeof conFecha = [];
    const manana: typeof conFecha = [];
    const estaSemana: typeof conFecha = [];
    const proximas: typeof conFecha = [];

    const now = new Date();
    const finSemana = addDays(now, 7);

    for (const item of conFecha) {
      if (item.completedAt) {
        // Las completadas van al final o en próximas
        proximas.push(item);
      } else if (isToday(item.dateObj)) {
        hoy.push(item);
      } else if (isTomorrow(item.dateObj)) {
        manana.push(item);
      } else if (isPast(item.dateObj)) {
        vencidas.push(item);
      } else if (item.dateObj <= finSemana) {
        estaSemana.push(item);
      } else {
        proximas.push(item);
      }
    }

    return { vencidas, hoy, manana, estaSemana, proximas };
  }, [scheduledActivities]);

  // Actividades del día seleccionado
  const actividadesDiaSeleccionado = useMemo(() => {
    return scheduledActivities.filter((a) => {
      if (!a.scheduledAt) return false;
      return isSameDay(new Date(a.scheduledAt), selectedDay);
    });
  }, [scheduledActivities, selectedDay]);

  return (
    <div className="space-y-6">
      {/* Barra Superior con Controles y Métricas */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border rounded-xl p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CalendarIcon className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight capitalize font-heading">
              {format(currentDate, "MMMM yyyy", { locale: es })}
            </h2>
            <p className="text-xs text-muted-foreground">
              Entregas, cobros y coordinaciones agendadas
            </p>
          </div>
        </div>

        {/* Controles de Navegación y Vistas */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center border rounded-lg overflow-hidden bg-background">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 rounded-none text-xs font-semibold"
              onClick={() => {
                const hoy = new Date();
                setCurrentDate(hoy);
                setSelectedDay(hoy);
              }}
            >
              Hoy
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center border rounded-lg p-0.5 bg-muted/40">
            <Button
              size="sm"
              variant={viewMode === "agenda" ? "default" : "ghost"}
              className="h-8 text-xs gap-1.5"
              onClick={() => setViewMode("agenda")}
            >
              <ListFilter className="h-3.5 w-3.5" />
              Agenda
            </Button>
            <Button
              size="sm"
              variant={viewMode === "month" ? "default" : "ghost"}
              className="h-8 text-xs gap-1.5"
              onClick={() => setViewMode("month")}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Mes
            </Button>
          </div>

          <Button
            size="sm"
            className="h-9 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-4 w-4" />
            Agendar Compromiso
          </Button>
        </div>
      </div>

      {/* Filtros de Tipo y Buscador */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltroTipo("all")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer",
              filtroTipo === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            )}
          >
            Todos ({contadores.totalProgramadas})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo("delivery")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer",
              filtroTipo === "delivery"
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/60 hover:bg-emerald-100/60"
            )}
          >
            <Truck className="h-3.5 w-3.5" />
            Entregas ({contadores.totalEntregas})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo("payment")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer",
              filtroTipo === "payment"
                ? "bg-amber-600 text-white border-amber-600"
                : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/60 hover:bg-amber-100/60"
            )}
          >
            <DollarSign className="h-3.5 w-3.5" />
            Cobros ({contadores.totalCobros})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo("call")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer",
              filtroTipo === "call"
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200/60 hover:bg-sky-100/60"
            )}
          >
            <Phone className="h-3.5 w-3.5" />
            Llamadas / Seg. ({contadores.totalLlamadas})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo("completed")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer",
              filtroTipo === "completed"
                ? "bg-muted-foreground text-background border-muted-foreground"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Completadas ({contadores.totalCompletadas})
          </button>
        </div>

        <div className="relative w-full md:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, orden, calle..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-8 h-9 text-xs bg-card"
          />
        </div>
      </div>

      {/* VISTA 1: AGENDA DE PENDIENTES (Predeterminada para ventas y logística) */}
      {viewMode === "agenda" && (
        <div className="space-y-6">
          {/* 1. Vencidos / Por Confirmar */}
          {agendaGrupos.vencidas.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>Pendientes Atrasados ({agendaGrupos.vencidas.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agendaGrupos.vencidas.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onToggleComplete={handleToggleComplete}
                    isMarking={markingId === item.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 2. Hoy */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
              <Clock className="h-4 w-4" />
              <span>Para Hoy ({agendaGrupos.hoy.length})</span>
            </div>
            {agendaGrupos.hoy.length === 0 ? (
              <div className="p-4 border border-dashed rounded-lg text-xs text-muted-foreground bg-card text-center">
                No hay entregas ni cobros agendados para hoy.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agendaGrupos.hoy.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onToggleComplete={handleToggleComplete}
                    isMarking={markingId === item.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 3. Mañana */}
          {agendaGrupos.manana.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-sm">
                <CalendarIcon className="h-4 w-4" />
                <span>Para Mañana ({agendaGrupos.manana.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agendaGrupos.manana.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onToggleComplete={handleToggleComplete}
                    isMarking={markingId === item.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 4. Esta Semana (Aquí aparece el Sábado de José Navarro) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <CalendarDays className="h-4 w-4" />
              <span>Próximos Días de Esta Semana ({agendaGrupos.estaSemana.length})</span>
            </div>
            {agendaGrupos.estaSemana.length === 0 ? (
              <div className="p-4 border border-dashed rounded-lg text-xs text-muted-foreground bg-card text-center">
                No hay más actividades programadas para el resto de la semana.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agendaGrupos.estaSemana.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onToggleComplete={handleToggleComplete}
                    isMarking={markingId === item.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 5. Próximas Fechas */}
          {agendaGrupos.proximas.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground font-semibold text-sm">
                <CalendarDays className="h-4 w-4" />
                <span>Próximas Semanas y Completadas ({agendaGrupos.proximas.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {agendaGrupos.proximas.map((item) => (
                  <ActivityCard
                    key={item.id}
                    item={item}
                    onToggleComplete={handleToggleComplete}
                    isMarking={markingId === item.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VISTA 2: CUADRÍCULA DE MES */}
      {viewMode === "month" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Cuadrícula interactiva */}
          <div className="lg:col-span-3 bg-card border rounded-xl overflow-hidden shadow-xs">
            {/* Cabecera días semana */}
            <div className="grid grid-cols-7 border-b text-center text-xs font-semibold text-muted-foreground bg-muted/30 py-2.5">
              <span>Lun</span>
              <span>Mar</span>
              <span>Mié</span>
              <span>Jue</span>
              <span>Vie</span>
              <span>Sáb</span>
              <span>Dom</span>
            </div>

            {/* Días del mes */}
            <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y border-b text-sm">
              {calendarDays.map((day) => {
                const dayActivities = scheduledActivities.filter(
                  (a) => a.scheduledAt && isSameDay(new Date(a.scheduledAt), day)
                );
                const isSelected = isSameDay(day, selectedDay);
                const isCurrentMonth = isSameMonth(day, monthStart);
                const isCurrentDay = isToday(day);

                return (
                  <div
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      "min-h-[96px] p-1.5 transition-colors cursor-pointer flex flex-col justify-between",
                      !isCurrentMonth && "bg-muted/15 text-muted-foreground/50",
                      isSelected && "bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-emerald-500/50 inset-0",
                      isCurrentDay && !isSelected && "bg-primary/5 font-semibold"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          "inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium",
                          isCurrentDay && "bg-emerald-600 text-white font-bold",
                          !isCurrentDay && isSelected && "bg-muted text-foreground font-semibold"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {dayActivities.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                          {dayActivities.length}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 mt-1">
                      {dayActivities.slice(0, 2).map((act) => {
                        const conf = TIPO_CONFIG[act.type] || TIPO_CONFIG.note;
                        return (
                          <div
                            key={act.id}
                            className={cn(
                              "text-[10px] font-medium truncate px-1.5 py-0.5 rounded-sm border",
                              act.completedAt
                                ? "bg-muted text-muted-foreground line-through opacity-70"
                                : conf.badgeClass
                            )}
                            title={act.description}
                          >
                            {act.type === "delivery" && "🚚 "}
                            {act.type === "payment" && "💰 "}
                            {act.contactName ? act.contactName.split(" ")[0] : "Compromiso"}
                          </div>
                        );
                      })}
                      {dayActivities.length > 2 && (
                        <div className="text-[9px] text-muted-foreground font-medium pl-1">
                          +{dayActivities.length - 2} más
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Panel Lateral: Detalle del día seleccionado */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="border shadow-xs">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-semibold capitalize flex items-center justify-between">
                  <span>{format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}</span>
                  {isToday(selectedDay) && (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                      Hoy
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-3 max-h-[500px] overflow-y-auto">
                {actividadesDiaSeleccionado.length === 0 ? (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    No hay compromisos agendados para este día.
                  </div>
                ) : (
                  actividadesDiaSeleccionado.map((item) => (
                    <ActivityCard
                      key={item.id}
                      item={item}
                      compact
                      onToggleComplete={handleToggleComplete}
                      isMarking={markingId === item.id}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Modal de Nueva Actividad */}
      <ActivityForm
        open={showForm}
        defaultType="delivery"
        onClose={() => {
          setShowForm(false);
          onRefresh?.();
        }}
      />
    </div>
  );
}

function ActivityCard({
  item,
  compact = false,
  onToggleComplete,
  isMarking,
}: {
  item: CalendarActivity;
  compact?: boolean;
  onToggleComplete: (item: CalendarActivity) => void;
  isMarking?: boolean;
}) {
  const conf = TIPO_CONFIG[item.type] || TIPO_CONFIG.note;
  const Icon = conf.icon;
  const isDone = Boolean(item.completedAt);

  // Formato de hora programada
  const fechaStr = item.scheduledAt
    ? format(new Date(item.scheduledAt), "EEEE d 'de' MMMM", { locale: es })
    : "Sin fecha";
  const horaStr = item.scheduledAt
    ? format(new Date(item.scheduledAt), "h:mm a")
    : "";

  return (
    <Card
      className={cn(
        "border transition-all relative overflow-hidden text-xs shadow-xs",
        conf.borderClass,
        isDone ? "bg-muted/30 opacity-75" : conf.bgClass
      )}
    >
      <CardContent className={cn("p-3 space-y-2", compact && "p-2.5")}>
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className={cn("text-[10px] font-semibold gap-1", conf.badgeClass)}>
            <Icon className="h-3 w-3 shrink-0" />
            <span>{conf.label}</span>
          </Badge>

          <Button
            size="sm"
            variant={isDone ? "outline" : "secondary"}
            className={cn(
              "h-6 px-2 text-[10px] font-medium gap-1 cursor-pointer",
              isDone && "text-emerald-700 bg-emerald-50 border-emerald-300"
            )}
            disabled={isMarking}
            onClick={() => onToggleComplete(item)}
          >
            {isDone ? (
              <>
                <Check className="h-3 w-3" />
                Realizada
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                Completar
              </>
            )}
          </Button>
        </div>

        {/* Cliente y Teléfono */}
        <div className="space-y-0.5">
          <div className="font-bold text-sm text-foreground flex items-center justify-between">
            <span>{item.contactName || "Cliente sin nombre"}</span>
            {item.contactPhone && (
              <a
                href={`https://wa.me/${item.contactPhone.replace(/[\s\+\-]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-mono text-[11px]"
                title="Abrir WhatsApp"
              >
                <MessageSquare className="h-3 w-3" />
                {item.contactPhone}
              </a>
            )}
          </div>

          <div className="text-muted-foreground text-[11px] flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="capitalize">{fechaStr}</span>
            {horaStr && <span>· {horaStr}</span>}
          </div>
        </div>

        {/* Descripción del compromiso */}
        <p className="text-xs leading-relaxed text-foreground/90 font-medium bg-background/80 p-2 rounded-md border border-border/50">
          {item.description}
        </p>

        {/* Enlaces Rápidos de Acción */}
        <div className="pt-1 flex items-center justify-between border-t border-border/40 text-[11px]">
          <Link
            href={`/conversations?contactId=${item.contactId}`}
            className="text-primary hover:underline flex items-center gap-1 font-medium"
          >
            <MessageSquare className="h-3 w-3" />
            Ver Chat
          </Link>
          <Link
            href={`/contacts/${item.contactId}`}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Users className="h-3 w-3" />
            Ver Ficha
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
