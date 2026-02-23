"use client";

import { useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { MaintenanceDialog } from "@/components/mantenimientos/maintenance-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  CalendarDays,
  List,
  Clock,
  CheckCircle2,
  Play,
  AlertTriangle,
} from "lucide-react";
import { Maintenance, MaintenanceStatus } from "@/lib/types";
import { mockMaintenances, mockClients, mockUsers } from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";

const statusConfig: Record<MaintenanceStatus, { label: string; color: string; icon: React.ElementType }> = {
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

const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function MiniCalendar({ maintenances }: { maintenances: Maintenance[] }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthName = today.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const getMaintenancesForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return maintenances.filter((m) => m.fechaProgramada === dateStr);
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 capitalize">
          {monthName}
        </h3>
        <div className="grid grid-cols-7 gap-1">
          {daysOfWeek.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
          {days.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />;
            const dayMaintenances = getMaintenancesForDay(day);
            const isToday = day === today.getDate();

            return (
              <div
                key={day}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded-md p-1 text-xs transition-colors",
                  isToday && "bg-gold/10 text-gold font-bold",
                  dayMaintenances.length > 0 && !isToday && "bg-secondary/50",
                  "hover:bg-secondary/80 cursor-pointer"
                )}
              >
                {day}
                {dayMaintenances.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dayMaintenances.slice(0, 3).map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "h-1 w-1 rounded-full",
                          m.estado === "programado" && "bg-blue-400",
                          m.estado === "en_ejecucion" && "bg-cyan-neon",
                          m.estado === "realizado" && "bg-emerald-400",
                          m.estado === "pendiente" && "bg-amber-400"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-400" /> Programado
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-cyan-neon" /> En Ejecución
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-emerald-400" /> Realizado
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-amber-400" /> Pendiente
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MantenimientosPage() {
  const [maintenances, setMaintenances] = useState<Maintenance[]>(mockMaintenances);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState<Maintenance | null>(null);

  const filtered = maintenances.filter((m) => {
    const client = mockClients.find((c) => c.id === m.clienteId);
    const tech = mockUsers.find((u) => u.id === m.tecnicoId);
    const matchesSearch =
      client?.edificio.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.apellido.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "todos" || m.estado === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSave = (data: Partial<Maintenance>) => {
    if (editingMaintenance) {
      setMaintenances((prev) =>
        prev.map((m) => (m.id === editingMaintenance.id ? { ...m, ...data } : m))
      );
    } else {
      setMaintenances((prev) => [...prev, data as Maintenance]);
    }
    setEditingMaintenance(null);
  };

  const handleDelete = (id: string) => {
    setMaintenances((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div>
      <AdminHeader title="Programación de Mantenimientos" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente o técnico..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="programado">Programado</SelectItem>
                <SelectItem value="en_ejecucion">En Ejecución</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => {
              setEditingMaintenance(null);
              setDialogOpen(true);
            }}
            className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            Nuevo Mantenimiento
          </Button>
        </div>

        <Tabs defaultValue="lista" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="lista"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <List className="h-4 w-4 mr-2" />
              Lista
            </TabsTrigger>
            <TabsTrigger
              value="calendario"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Calendario
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lista">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha Programada</TableHead>
                      <TableHead className="text-muted-foreground">Próxima Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((m) => {
                      const client = mockClients.find((c) => c.id === m.clienteId);
                      const tech = mockUsers.find((u) => u.id === m.tecnicoId);
                      const status = statusConfig[m.estado];
                      const StatusIcon = status.icon;

                      return (
                        <TableRow key={m.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell>
                            <p className="font-medium text-foreground">{client?.edificio}</p>
                            <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{m.fechaProgramada}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{m.proximaFecha || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-xs gap-1", status.color)}>
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-card border-border">
                                <DropdownMenuItem
                                  onClick={() => { setEditingMaintenance(m); setDialogOpen(true); }}
                                  className="gap-2 cursor-pointer"
                                >
                                  <Pencil className="h-4 w-4" /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDelete(m.id)}
                                  className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" /> Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendario">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <MiniCalendar maintenances={maintenances} />
              </div>
              <div className="lg:col-span-2 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Mantenimientos del período
                </h3>
                {filtered.map((m) => {
                  const client = mockClients.find((c) => c.id === m.clienteId);
                  const tech = mockUsers.find((u) => u.id === m.tecnicoId);
                  const status = statusConfig[m.estado];
                  const StatusIcon = status.icon;

                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-border/50 bg-card/80 p-4 hover:bg-secondary/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", status.color.split(" ")[0])}>
                          <StatusIcon className={cn("h-5 w-5", status.color.split(" ")[1])} />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{client?.edificio}</p>
                          <p className="text-xs text-muted-foreground">
                            {tech?.nombre} {tech?.apellido} · {m.fechaProgramada}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("text-xs", status.color)}>
                        {status.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <MaintenanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        maintenance={editingMaintenance}
        onSave={handleSave}
      />
    </div>
  );
}
