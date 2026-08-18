"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, XCircle } from "lucide-react";
import { getMantenimientos } from "@/lib/data/services/mantenimientos";
import { getClientes } from "@/lib/data/services/clientes";
import { Client, Maintenance } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DashboardAlert {
  id: string;
  message: string;
  date: string;
  icon: typeof XCircle;
  color: string;
  bg: string;
}

export function AlertsPanel() {
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    Promise.all([getMantenimientos(), getClientes()])
      .then(([m, c]) => {
        setMaintenances(m);
        setClients(c);
      })
      .catch((err) => console.error("Error cargando alertas del dashboard:", err));
  }, []);

  const alerts = useMemo<DashboardAlert[]>(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const in3Days = new Date(todayStart);
    in3Days.setDate(in3Days.getDate() + 3);

    const parseDate = (value: string) => {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    };

    const items: DashboardAlert[] = [];

    for (const maintenance of maintenances) {
      if (!maintenance.fechaProgramada) continue;
      const client = clients.find((c) => c.id === maintenance.clienteId);
      const building = client?.edificio || "cliente";
      const date = parseDate(maintenance.fechaProgramada);

      if (maintenance.estado === "pendiente" && date < todayStart) {
        items.push({
          id: `${maintenance.id}-vencido`,
          message: `Mantenimiento vencido en ${building}`,
          date: maintenance.fechaProgramada,
          icon: XCircle,
          color: "text-red-400",
          bg: "bg-red-500/10",
        });
      } else if (maintenance.estado === "pendiente") {
        items.push({
          id: `${maintenance.id}-pendiente`,
          message: `Mantenimiento pendiente sin cerrar en ${building}`,
          date: maintenance.fechaProgramada,
          icon: AlertTriangle,
          color: "text-amber-400",
          bg: "bg-amber-500/10",
        });
      } else if ((maintenance.estado === "programado" || maintenance.estado === "en_ejecucion") && date >= todayStart && date <= in3Days) {
        items.push({
          id: `${maintenance.id}-proximo`,
          message: `Mantenimiento próximo en ${building}`,
          date: maintenance.fechaProgramada,
          icon: Clock,
          color: "text-blue-400",
          bg: "bg-blue-500/10",
        });
      }
    }

    return items
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);
  }, [maintenances, clients]);

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Alertas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay alertas activas.</p>
        )}
        {alerts.map((alert) => {
          const Icon = alert.icon;
          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 rounded-lg border border-border/50 bg-secondary/30 p-3"
            >
              <div className={cn("mt-0.5 rounded-lg p-2", alert.bg)}>
                <Icon className={cn("h-4 w-4", alert.color)} />
              </div>
              <div className="flex-1">
                <p className="text-sm text-foreground">{alert.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {alert.date}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
