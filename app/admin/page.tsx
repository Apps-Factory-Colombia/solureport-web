"use client";

import { AdminHeader } from "@/components/layout/admin-header";
import { StatsCard } from "@/components/dashboard/stats-cards";
import { DailySummary } from "@/components/dashboard/daily-summary";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import {
  CalendarClock,
  CheckCircle2,
  Users,
  FileText,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { mockMaintenances, mockUsers, mockReports } from "@/lib/data/mock-data";

export default function DashboardPage() {
  const programados = mockMaintenances.filter((m) => m.estado === "programado").length;
  const realizados = mockMaintenances.filter((m) => m.estado === "realizado").length;
  const pendientes = mockMaintenances.filter((m) => m.estado === "pendiente").length;
  const enEjecucion = mockMaintenances.filter((m) => m.estado === "en_ejecucion").length;
  const tecnicosActivos = mockUsers.filter((u) => u.rol === "tecnico" && u.estado === "activo").length;
  const reportesGenerados = mockReports.length;

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
            trend={{ value: 12, positive: true }}
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailySummary />
          </div>
          <div>
            <AlertsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
