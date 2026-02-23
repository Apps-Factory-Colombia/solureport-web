"use client";

import { useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign,
  Download,
  Mail,
  Lock,
  Users,
  FileText,
  CalendarDays,
} from "lucide-react";
import { LiquidationPeriod } from "@/lib/types";
import {
  mockLiquidationEntries,
  mockLiquidationPeriods,
  mockActivities,
  mockUsers,
  mockGroups,
} from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function LiquidacionPage() {
  const [periods] = useState<LiquidationPeriod[]>(mockLiquidationPeriods);
  const [selectedPeriodId, setSelectedPeriodId] = useState(periods[0]?.id || "");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const periodEntries = mockLiquidationEntries.filter(
    (e) => e.periodoId === selectedPeriodId
  );

  const techSummary = new Map<string, { nombre: string; actividades: number; total: number }>();
  periodEntries.forEach((entry) => {
    entry.participantes.forEach((p) => {
      const tech = mockUsers.find((u) => u.id === p.tecnicoId);
      if (!tech) return;
      const existing = techSummary.get(p.tecnicoId) || {
        nombre: `${tech.nombre} ${tech.apellido}`,
        actividades: 0,
        total: 0,
      };
      existing.actividades += 1;
      existing.total += p.valorCalculado;
      techSummary.set(p.tecnicoId, existing);
    });
  });

  const groupSummary = new Map<string, { nombre: string; actividades: number; total: number }>();
  periodEntries.forEach((entry) => {
    const group = mockGroups.find((g) => g.id === entry.grupoId);
    if (!group) return;
    const existing = groupSummary.get(entry.grupoId) || {
      nombre: group.nombre,
      actividades: 0,
      total: 0,
    };
    existing.actividades += 1;
    const entryTotal = entry.participantes.reduce((sum, p) => sum + p.valorCalculado, 0);
    existing.total += entryTotal;
    groupSummary.set(entry.grupoId, existing);
  });

  const totalPeriod = Array.from(techSummary.values()).reduce(
    (sum, t) => sum + t.total,
    0
  );

  return (
    <div>
      <AdminHeader title="Liquidación de Actividades" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-gold" />
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
              <SelectTrigger className="w-72 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Seleccionar período" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fechaInicio} → {p.fechaFin}{" "}
                    {p.estado === "cerrado" ? "(Cerrado)" : "(Abierto)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2 border-border/50 text-foreground/80"
            >
              <Download className="h-4 w-4" />
              Descargar PDF
            </Button>
            {selectedPeriod?.estado === "abierto" && (
              <Button
                onClick={() => setCloseDialogOpen(true)}
                className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
              >
                <Lock className="h-4 w-4" />
                Cerrar Período
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <DollarSign className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">{formatCurrency(totalPeriod)}</p>
                <p className="text-xs text-muted-foreground">Total Período</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                <FileText className="h-5 w-5 text-cyan-neon" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{periodEntries.length}</p>
                <p className="text-xs text-muted-foreground">Actividades Registradas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2.5">
                <Users className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{techSummary.size}</p>
                <p className="text-xs text-muted-foreground">Técnicos Participantes</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <Lock className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground capitalize">
                  {selectedPeriod?.estado || "—"}
                </p>
                <p className="text-xs text-muted-foreground">Estado del Período</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="actividades" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="actividades"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Actividades
            </TabsTrigger>
            <TabsTrigger
              value="por_tecnico"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Por Técnico
            </TabsTrigger>
            <TabsTrigger
              value="por_grupo"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Por Grupo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="actividades">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Actividad</TableHead>
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Lugar</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Participantes</TableHead>
                      <TableHead className="text-muted-foreground text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodEntries.map((entry) => {
                      const activity = mockActivities.find((a) => a.id === entry.actividadId);
                      const group = mockGroups.find((g) => g.id === entry.grupoId);
                      const total = entry.participantes.reduce((s, p) => s + p.valorCalculado, 0);

                      return (
                        <TableRow key={entry.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell>
                            <div>
                              <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-[10px] font-mono mb-1">
                                {activity?.codigo}
                              </Badge>
                              <p className="text-sm text-foreground/80">{activity?.descripcion}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{group?.nombre}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{entry.lugar}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{entry.fecha}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {entry.participantes.map((p) => {
                                const tech = mockUsers.find((u) => u.id === p.tecnicoId);
                                return (
                                  <div key={p.tecnicoId} className="flex items-center justify-between text-xs">
                                    <span className="text-foreground/70">
                                      {tech?.nombre} {tech?.apellido}
                                    </span>
                                    <span className="text-gold font-medium">
                                      {p.porcentaje}% · {formatCurrency(p.valorCalculado)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-gold">
                            {formatCurrency(total)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="por_tecnico">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Actividades</TableHead>
                      <TableHead className="text-muted-foreground text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(techSummary.entries()).map(([id, data]) => (
                      <TableRow key={id} className="border-border/50 hover:bg-secondary/30">
                        <TableCell className="font-medium text-foreground">{data.nombre}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs">
                            {data.actividades}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-gold">
                          {formatCurrency(data.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-border/50 bg-gold/5">
                      <TableCell className="font-bold text-foreground">Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-bold text-gold text-lg">
                        {formatCurrency(totalPeriod)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="por_grupo">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Actividades</TableHead>
                      <TableHead className="text-muted-foreground text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(groupSummary.entries()).map(([id, data]) => (
                      <TableRow key={id} className="border-border/50 hover:bg-secondary/30">
                        <TableCell className="font-medium text-foreground">{data.nombre}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs">
                            {data.actividades}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-gold">
                          {formatCurrency(data.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Cerrar Período de Liquidación</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-foreground/80">
              ¿Está seguro de cerrar el período{" "}
              <span className="font-semibold text-gold">
                {selectedPeriod?.fechaInicio} → {selectedPeriod?.fechaFin}
              </span>
              ? Esta acción no se puede deshacer.
            </p>
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Actividades registradas:</span>
                <span className="font-medium text-foreground">{periodEntries.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Técnicos involucrados:</span>
                <span className="font-medium text-foreground">{techSummary.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total liquidación:</span>
                <span className="font-bold text-gold">{formatCurrency(totalPeriod)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Se enviará un correo con el resumen de la liquidación a todos los involucrados.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCloseDialogOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => setCloseDialogOpen(false)}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Lock className="h-4 w-4" />
              Confirmar Cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
