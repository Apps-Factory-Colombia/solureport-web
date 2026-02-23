"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockMaintenances, mockClients, mockUsers } from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";
import { Clock, CheckCircle2, AlertTriangle, Play } from "lucide-react";

const statusConfig = {
  programado: {
    label: "Programado",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Clock,
  },
  en_ejecucion: {
    label: "En Ejecución",
    color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20",
    icon: Play,
  },
  realizado: {
    label: "Realizado",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: CheckCircle2,
  },
  pendiente: {
    label: "Pendiente",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: AlertTriangle,
  },
};

export function DailySummary() {
  const recentMaintenances = mockMaintenances.slice(0, 6);

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-foreground">
          Actividad Reciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recentMaintenances.map((m) => {
          const client = mockClients.find((c) => c.id === m.clienteId);
          const tech = mockUsers.find((u) => u.id === m.tecnicoId);
          const status = statusConfig[m.estado];
          const StatusIcon = status.icon;

          return (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3 transition-colors hover:bg-secondary/50"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg",
                    status.color.split(" ")[0]
                  )}
                >
                  <StatusIcon className={cn("h-4 w-4", status.color.split(" ")[1])} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {client?.edificio || "Cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tech?.nombre} {tech?.apellido} · {m.fechaProgramada}
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn("text-[10px] font-medium", status.color)}
              >
                {status.label}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
