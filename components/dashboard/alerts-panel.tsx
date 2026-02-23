"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const alerts = [
  {
    id: 1,
    type: "vencido",
    message: "Mantenimiento vencido en Urbanización Los Rosales",
    date: "2025-02-18",
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
  },
  {
    id: 2,
    type: "pendiente",
    message: "Mantenimiento pendiente sin cerrar en El Prado",
    date: "2025-02-19",
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    id: 3,
    type: "proximo",
    message: "Mantenimiento próximo a vencer en Torres del Parque",
    date: "2025-02-23",
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
  },
];

export function AlertsPanel() {
  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Alertas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
