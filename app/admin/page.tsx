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
import { getMantenimientos } from "@/lib/data/services/mantenimientos";
import { getClientes } from "@/lib/data/services/clientes";
import { getUsuarios } from "@/lib/data/services/usuarios";
import { getDashboardMetrics, DashboardMetrics } from "@/lib/data/services/dashboard";
import { Maintenance, User, Client } from "@/lib/types";

export default function DashboardPage() {
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const touchStartY = useRef<number | null>(null);
  const pullDistance = useRef(0);
  const isPulling = useRef(false);
  const dashboardRequestRef = useRef(0);

  const loadCoreDashboardData = useCallback(async (showLoader = true) => {
    const requestId = ++dashboardRequestRef.current;
    if (showLoader) setLoading(true);
    try {
      const [m, c, u, dashboardMetrics] = await Promise.all([
        getMantenimientos(),
        getClientes(),
        getUsuarios(),
        getDashboardMetrics(),
      ]);
      if (requestId !== dashboardRequestRef.current) return;
      setMaintenances(m);
      setClients(c);
      setUsers(u);
      setMetrics(dashboardMetrics);
    } catch (err) {
      console.error("Error cargando dashboard:", err);
    } finally {
      if (showLoader && requestId === dashboardRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoreDashboardData();

    const interval = setInterval(() => {
      loadCoreDashboardData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [loadCoreDashboardData]);

  useEffect(() => {
    const onFocus = () => {
      void loadCoreDashboardData(false);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadCoreDashboardData]);

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

  const programados = metrics?.programados ?? 0;
  const realizados = metrics?.realizados ?? 0;
  const pendientes = metrics?.pendientes ?? 0;
  const enEjecucion = metrics?.enEjecucion ?? 0;
  const tecnicosActivos = metrics?.tecnicosActivos ?? 0;
  const reportesGenerados = metrics?.reportesGenerados ?? 0;

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
