"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { StatsCard } from "@/components/dashboard/stats-cards";
import { DailySummary } from "@/components/dashboard/daily-summary";
import {
  CalendarClock,
  CheckCircle2,
  Users,
  FileText,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { getMantenimientos } from "@/lib/supabase/services/mantenimientos";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getReportesActividad } from "@/lib/supabase/services/reportes-actividad";
import { Maintenance, User, ActivityReport, Client } from "@/lib/types";

export default function DashboardPage() {
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const touchStartY = useRef<number | null>(null);
  const pullDistance = useRef(0);
  const isPulling = useRef(false);

  const loadCoreDashboardData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const [m, c, u] = await Promise.all([getMantenimientos(), getClientes(), getUsuarios()]);
      setMaintenances(m);
      setClients(c);
      setUsers(u);
    } catch (err) {
      console.error("Error cargando dashboard:", err);
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  const loadDashboardReports = useCallback(async () => {
    try {
      const r = await getReportesActividad();
      setReports(r);
    } catch (err) {
      console.error("Error cargando reportes del dashboard:", err);
    }
  }, []);

  useEffect(() => {
    loadCoreDashboardData();
    loadDashboardReports();

    const interval = setInterval(() => {
      loadCoreDashboardData(false);
      loadDashboardReports();
    }, 30000);

    return () => clearInterval(interval);
  }, [loadCoreDashboardData, loadDashboardReports]);

  useEffect(() => {
    const resetPullState = () => {
      touchStartY.current = null;
      pullDistance.current = 0;
      isPulling.current = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0) {
        resetPullState();
        return;
      }
      touchStartY.current = event.touches[0]?.clientY ?? null;
      pullDistance.current = 0;
      isPulling.current = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!isPulling.current || touchStartY.current === null) return;

      const currentY = event.touches[0]?.clientY ?? touchStartY.current;
      const delta = currentY - touchStartY.current;

      if (delta > 0 && window.scrollY <= 0) {
        pullDistance.current = delta;
        return;
      }

      resetPullState();
    };

    const onTouchEnd = () => {
      const shouldReload = isPulling.current && pullDistance.current >= 90;
      resetPullState();
      if (shouldReload) {
        window.location.reload();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  const maintenancesThisMonth = maintenances.filter((m) => {
    if (!m.fechaProgramada) return false;
    const [year, month] = m.fechaProgramada.split("-").map(Number);
    return year === thisYear && month - 1 === thisMonth;
  });

  const programados = maintenancesThisMonth.filter((m) => m.estado === "programado").length;
  const realizados = maintenancesThisMonth.filter((m) => ["realizado", "completado"].includes(String(m.estado))).length;
  const pendientes = maintenances.filter((m) => m.estado === "pendiente").length;
  const enEjecucion = maintenances.filter((m) => ["en_ejecucion", "en_progreso"].includes(String(m.estado))).length;
  const tecnicosActivos = users.filter((u) => u.rol === "tecnico" && u.estado === "activo").length;
  const reportesGenerados = reports.filter((r) => {
    const [year, month] = r.fecha.split("-").map(Number);
    return year === thisYear && month - 1 === thisMonth;
  }).length;

  if (loading) {
    return (
      <div>
        <AdminHeader title="Dashboard" />
        <AdminPageLoader
          title="Cargando dashboard"
          message="Estamos preparando tus indicadores y la actividad reciente."
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Dashboard" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatsCard
            title="Programados"
            value={programados}
            subtitle="Este mes"
            icon={CalendarClock}
            accentColor="cyan"
          />
          <StatsCard
            title="En Ejecución"
            value={enEjecucion}
            subtitle="Actualmente"
            icon={Clock}
            accentColor="cyan"
          />
          <StatsCard
            title="Realizados"
            value={realizados}
            subtitle="Este mes"
            icon={CheckCircle2}
            accentColor="green"
          />
          <StatsCard
            title="Pendientes"
            value={pendientes}
            subtitle="Sin cerrar"
            icon={AlertTriangle}
            accentColor="red"
          />
          <StatsCard
            title="Técnicos Activos"
            value={tecnicosActivos}
            icon={Users}
            accentColor="gold"
          />
          <StatsCard
            title="Reportes"
            value={reportesGenerados}
            subtitle="Generados"
            icon={FileText}
            accentColor="gold"
          />
        </div>

        <div className="grid grid-cols-1 gap-6">
          <DailySummary maintenances={maintenances} clients={clients} users={users} />
        </div>
      </div>
    </div>
  );
}
