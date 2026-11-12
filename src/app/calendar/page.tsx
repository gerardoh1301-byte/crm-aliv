"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { GeneralCalendar, type CalendarActivity } from "@/components/calendar/GeneralCalendar";

export default function CalendarPage() {
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activities");
      if (res.ok) {
        const data = await res.json();
        setActivities(data);
      }
    } catch (err) {
      console.error("Error cargando actividades para el calendario:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendario General"
        subtitle="Entregas, despachos, cobros y compromisos agendados con clientes"
      />

      {loading ? (
        <div className="space-y-4">
          <div className="h-16 bg-muted/40 rounded-xl animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />
            <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />
            <div className="h-32 bg-muted/40 rounded-xl animate-pulse" />
          </div>
        </div>
      ) : (
        <GeneralCalendar initialActivities={activities} onRefresh={loadActivities} />
      )}
    </div>
  );
}
