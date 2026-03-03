"use client";

import { useState, useEffect } from "react";
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
  DialogDescription,
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
  Printer,
  PenLine,
  Bike,
  Sparkles,
  Clock,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react";
import { LiquidationPeriod, LiquidationEntry, Activity, User, WorkGroup, LeaderAccumulation, ActivityReport } from "@/lib/types";
import { getPeriodos, getLiquidationEntries, closePeriodo } from "@/lib/supabase/services/liquidacion";
import { getActividades } from "@/lib/supabase/services/actividades";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { deleteReporteActividadAdmin, getAcumulacionesLider, getReportesActividad } from "@/lib/supabase/services/reportes-actividad";
import { cn } from "@/lib/utils";
import { generateTablePDF, generateComprobantePDF } from "@/lib/utils/pdf-generator";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function LiquidacionPage() {
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [entries, setEntries] = useState<LiquidationEntry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [leaderAccumulations, setLeaderAccumulations] = useState<LeaderAccumulation[]>([]);
  const [actReports, setActReports] = useState<ActivityReport[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [comprobanteOpen, setComprobanteOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("todos");
  const [reportToDelete, setReportToDelete] = useState<ActivityReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;
    setClosing(true);
    try {
      await closePeriodo(selectedPeriod.id);

      const techIds = Array.from(techSummary.keys());
      const techEmails = techIds
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean);

      try {
        const emailPromises = techEmails.map((tech) => {
          if (!tech) return Promise.resolve();
          const data = techSummary.get(tech.id);
          return fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: tech.email,
              subject: `SoluReport - Liquidación Cerrada (${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin})`,
              html: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                  <h2 style="color:#D4A843">Liquidación Cerrada</h2>
                  <p>Hola <strong>${tech.nombre} ${tech.apellido}</strong>,</p>
                  <p>El período de liquidación <strong>${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin}</strong> ha sido cerrado.</p>
                  <table style="width:100%;border-collapse:collapse;margin:16px 0">
                    <tr style="background:#f5f5f5"><td style="padding:8px;border:1px solid #ddd">Actividades</td><td style="padding:8px;border:1px solid #ddd;text-align:right"><strong>${data?.actividades || 0}</strong></td></tr>
                    <tr><td style="padding:8px;border:1px solid #ddd">Total Liquidación</td><td style="padding:8px;border:1px solid #ddd;text-align:right;color:#D4A843"><strong>${formatCurrency(data?.total || 0)}</strong></td></tr>
                  </table>
                  <p>Ingresa al aplicativo para descargar tu comprobante individual.</p>
                  <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
                  <p style="font-size:11px;color:#999">SOLUCIONES & AUTOMATIZACIONES S.A.S. — SoluReport</p>
                </div>
              `,
            }),
          });
        });
        await Promise.allSettled(emailPromises);
      } catch (emailErr) {
        console.error("Error enviando emails (no bloqueante):", emailErr);
      }

      const updatedPeriods = await getPeriodos();
      setPeriods(updatedPeriods);
      setCloseDialogOpen(false);
    } catch (err) {
      console.error("Error cerrando período:", err);
    } finally {
      setClosing(false);
    }
  };

  useEffect(() => {
    Promise.all([
      getPeriodos(), getLiquidationEntries(), getActividades(),
      getUsuarios(), getGrupos(), getAcumulacionesLider(), getReportesActividad(),
    ]).then(([p, e, a, u, g, la, ar]) => {
      setPeriods(p); setEntries(e); setActivities(a);
      setUsers(u); setGroups(g); setLeaderAccumulations(la); setActReports(ar);
      if (p.length > 0) setSelectedPeriodId(p[0].id);
    }).catch((err) => console.error("Error cargando liquidación:", err));
  }, []);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const periodEntries = entries.filter(
    (e) => e.periodoId === selectedPeriodId
  );

  // Reportes de actividad del período (fuente principal de datos)
  const periodReports = actReports.filter(
    (r) => r.periodoId === selectedPeriodId
  );

  // Resumen por técnico basado en reportes_actividad
  const techSummary = new Map<string, { nombre: string; actividades: number; total: number }>();
  periodReports.forEach((r) => {
    const tech = users.find((u) => u.id === r.tecnicoId);
    if (!tech) return;
    const existing = techSummary.get(r.tecnicoId) || {
      nombre: `${tech.nombre} ${tech.apellido}`,
      actividades: 0,
      total: 0,
    };
    existing.actividades += 1;
    existing.total += r.costoActividad;
    techSummary.set(r.tecnicoId, existing);
  });

  // Resumen por grupo basado en reportes_actividad
  const groupSummary = new Map<string, { nombre: string; actividades: number; total: number }>();
  periodReports.forEach((r) => {
    const group = groups.find((g) => g.id === r.grupoId);
    if (!group) return;
    const existing = groupSummary.get(r.grupoId) || {
      nombre: group.nombre,
      actividades: 0,
      total: 0,
    };
    existing.actividades += 1;
    existing.total += r.costoActividad;
    groupSummary.set(r.grupoId, existing);
  });

  const totalPeriod = Array.from(techSummary.values()).reduce(
    (sum, t) => sum + t.total,
    0
  );

  const filteredPeriodReports = periodReports.filter(
    (r) => selectedGroupId === "todos" || r.grupoId === selectedGroupId
  );

  const handleDeleteActivity = async () => {
    if (!reportToDelete) return;
    setDeletingReportId(reportToDelete.id);
    try {
      await deleteReporteActividadAdmin(reportToDelete.id);
      const updatedReports = await getReportesActividad();
      setActReports(updatedReports);
      setReportToDelete(null);
    } catch (err) {
      console.error("Error eliminando actividad de liquidación:", err);
      alert("No se pudo eliminar la actividad. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  };

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
              onClick={() => {
                const tipoLabels: Record<string, string> = { mantenimiento_preventivo: "Mant. Preventivo", visita_tecnica: "Visita Técnica", recorrido: "Recorrido", actividad_grupal: "Act. Grupal" };
                const rows = periodReports.map((r) => {
                  const tech = users.find((u) => u.id === r.tecnicoId);
                  const group = groups.find((g) => g.id === r.grupoId);
                  return [
                    tipoLabels[r.tipo] || r.tipo,
                    r.descripcion || "\u2014",
                    group?.nombre || "\u2014",
                    r.fecha,
                    tech ? `${tech.nombre} ${tech.apellido}` : "\u2014",
                    r.estadoAprobacionLider === "aprobado" ? "Aprobado" : "Pendiente",
                    formatCurrency(r.costoActividad),
                  ];
                });
                generateTablePDF({
                  titulo: "LIQUIDACI\u00d3N DE ACTIVIDADES",
                  empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
                  periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} \u2192 ${selectedPeriod.fechaFin}` : "",
                  headers: ["Tipo", "Descripci\u00f3n", "Grupo", "Fecha", "T\u00e9cnico", "Estado", "Valor"],
                  rows,
                  totales: ["TOTAL", "", "", "", "", `${periodReports.length} actividades`, formatCurrency(totalPeriod)],
                });
              }}
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
                <p className="text-xl font-bold text-foreground">{periodReports.length}</p>
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

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-foreground flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-gold" />
              Resumen Quincenal de Pagos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(() => {
                const approvedReports = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "aprobado"
                );
                const pendingReports = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "pendiente"
                );
                const totalAprobado = approvedReports.reduce((s, r) => s + r.costoActividad, 0);
                const totalPendiente = pendingReports.reduce((s, r) => s + r.costoActividad, 0);
                const recorridos = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.tipo === "recorrido"
                );
                const totalRecorridos = recorridos.reduce((s, r) => s + r.costoActividad, 0);

                return (
                  <>
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide">Aprobado para Pago</p>
                      </div>
                      <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalAprobado)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{approvedReports.length} actividades aprobadas</p>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-amber-400" />
                        <p className="text-xs font-medium text-amber-400 uppercase tracking-wide">Pendiente de Aprobación</p>
                      </div>
                      <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalPendiente)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{pendingReports.length} actividades pendientes</p>
                    </div>
                    <div className="rounded-lg border border-gold/20 bg-gold/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <DollarSign className="h-4 w-4 text-gold" />
                        <p className="text-xs font-medium text-gold uppercase tracking-wide">Total Quincena</p>
                      </div>
                      <p className="text-2xl font-bold text-gold">{formatCurrency(totalAprobado + totalPendiente)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Recorridos: {formatCurrency(totalRecorridos)} ({recorridos.length})
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>

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
            <TabsTrigger
              value="comprobantes"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Printer className="h-4 w-4 mr-1" />
              Comprobantes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="actividades">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    Filtra por grupo y elimina actividades sin salir de Liquidación.
                  </p>
                  <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                    <SelectTrigger className="w-56 bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Filtrar por grupo" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="todos">Todos los grupos</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Tipo</TableHead>
                      <TableHead className="text-muted-foreground">Descripci\u00f3n</TableHead>
                      <TableHead className="text-muted-foreground">T\u00e9cnico</TableHead>
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground text-right">Valor</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPeriodReports.map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      const group = groups.find((g) => g.id === r.grupoId);
                      const tipoLabel = r.tipo === "mantenimiento_preventivo" ? "Mant. Preventivo"
                        : r.tipo === "visita_tecnica" ? "Visita Técnica"
                          : r.tipo === "recorrido" ? "Recorrido"
                            : r.tipo === "actividad_grupal" ? "Act. Grupal" : r.tipo;

                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              "text-[10px]",
                              r.tipo === "mantenimiento_preventivo" ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                                : r.tipo === "visita_tecnica" ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                  : r.tipo === "actividad_grupal" ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            )}>
                              {tipoLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                            {r.descripcion || "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {tech ? `${tech.nombre} ${tech.apellido}` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{group?.nombre || "\u2014"}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              "text-xs",
                              r.estadoAprobacionLider === "aprobado"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            )}>
                              {r.estadoAprobacionLider === "aprobado" ? "Aprobado" : "Pendiente"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-gold">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-400"
                              disabled={deletingReportId === r.id}
                              onClick={() => setReportToDelete(r)}
                            >
                              {deletingReportId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {periodReports.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                          No hay actividades registradas en este período.
                        </TableCell>
                      </TableRow>
                    )}
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

          <TabsContent value="comprobantes">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Genere comprobantes individuales de liquidación por cada técnico. Cada comprobante incluye firmas, separación de conceptos y referencia al contrato según Art. 128 CST.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from(techSummary.entries()).map(([techId, data]) => {
                  const tech = users.find((u) => u.id === techId);
                  const techReports = periodReports.filter((r) => r.tecnicoId === techId);
                  const techRecorridos = techReports.filter((r) => r.tipo === "recorrido");
                  const rodamiento = techRecorridos.reduce((s, r) => s + r.costoActividad, 0);

                  return (
                    <Card
                      key={techId}
                      className="border-border/50 bg-card/80 hover:border-gold/20 transition-all cursor-pointer"
                      onClick={() => {
                        setSelectedTechId(techId);
                        setComprobanteOpen(true);
                      }}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground">{data.nombre}</p>
                            <p className="text-xs text-muted-foreground">{data.actividades} actividades</p>
                          </div>
                          <Printer className="h-5 w-5 text-gold" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-neon" />
                              AUXILIO EXTRALEGAL
                            </span>
                            <span className="font-semibold text-gold">{formatCurrency(data.total - rodamiento)}</span>
                          </div>
                          {rodamiento > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Bike className="h-3.5 w-3.5 text-emerald-400" />
                                RECORRIDOS
                              </span>
                              <span className="font-semibold text-emerald-400">{formatCurrency(rodamiento)}</span>
                            </div>
                          )}
                        </div>
                        <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Total comprobante</span>
                          <span className="font-bold text-gold">
                            {formatCurrency(data.total)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Cerrar Período de Liquidación</DialogTitle>
          </DialogHeader>
          {(() => {
            const pendingAccumulations = leaderAccumulations.filter(
              (a) => a.periodoId === selectedPeriodId && a.totalPendientePago > 0
            );
            const totalPendingCarryOver = pendingAccumulations.reduce(
              (s, a) => s + a.totalPendientePago, 0
            );
            const pendingReports = actReports.filter(
              (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "pendiente"
            );

            return (
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
                    <span className="font-medium text-foreground">{periodReports.length}</span>
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

                {pendingReports.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                    <Clock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-400">
                        {pendingReports.length} informe(s) pendiente(s) de aprobación por líder
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Estos informes no han sido aprobados y su valor se trasladará como pendiente de pago al siguiente período.
                      </p>
                    </div>
                  </div>
                )}

                {totalPendingCarryOver > 0 && (
                  <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3 flex items-start gap-2">
                    <Bike className="h-4 w-4 text-cyan-neon mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-cyan-neon">
                        Arrastre al siguiente período: {formatCurrency(totalPendingCarryOver)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        El acumulado pendiente de pago se transferirá automáticamente al siguiente período quincenal.
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Se enviará un correo con el resumen de la liquidación a todos los involucrados.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCloseDialogOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleClosePeriod}
              disabled={closing}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {closing ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {closing ? "Cerrando..." : "Confirmar Cierre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!reportToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingReportId) setReportToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Eliminar actividad</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Esta acción eliminará la actividad del período y su espejo relacionado en la tabla origen cuando aplique.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReportToDelete(null)}
              disabled={!!deletingReportId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDeleteActivity}
              disabled={!!deletingReportId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingReportId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingReportId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={comprobanteOpen} onOpenChange={setComprobanteOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Comprobante de Liquidación</DialogTitle>
          </DialogHeader>
          {selectedTechId && (() => {
            const tech = users.find((u) => u.id === selectedTechId);
            const techData = techSummary.get(selectedTechId);
            if (!tech || !techData) return null;

            const techReportsForComprobante = periodReports.filter((r) => r.tecnicoId === selectedTechId);
            const nonRecorridoReports = techReportsForComprobante.filter((r) => r.tipo !== "recorrido");
            const recorridoReports = techReportsForComprobante.filter((r) => r.tipo === "recorrido");

            const auxilioTotal = nonRecorridoReports.reduce((s, r) => s + r.costoActividad, 0);
            const rodamientoTotal = recorridoReports.reduce((s, r) => s + r.costoActividad, 0);
            const grandTotal = auxilioTotal + rodamientoTotal;

            return (
              <div className="space-y-6">
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-4">
                  <div className="text-center border-b border-border/50 pb-3">
                    <p className="text-sm font-bold text-gold">SOLUCIONES & AUTOMATIZACIONES S.A.S.</p>
                    <p className="text-xs text-muted-foreground">NIT: 900.XXX.XXX-X</p>
                    <p className="text-xs font-semibold text-foreground mt-2">COMPROBANTE DE LIQUIDACIÓN QUINCENAL</p>
                    <p className="text-xs text-muted-foreground">
                      Período: {selectedPeriod?.fechaInicio} → {selectedPeriod?.fechaFin}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Nombre del Técnico</p>
                      <p className="font-medium text-foreground">{tech.nombre} {tech.apellido}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Correo</p>
                      <p className="font-medium text-foreground">{tech.email}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-cyan-neon uppercase tracking-wide">
                      AUXILIO EXTRALEGAL POR PRODUCTIVIDAD Y RESPALDO DIGITAL
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/30 hover:bg-transparent">
                          <TableHead className="text-muted-foreground text-xs">Tipo</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Descripción</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Fecha</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Estado</TableHead>
                          <TableHead className="text-muted-foreground text-xs text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nonRecorridoReports.map((r) => (
                          <TableRow key={r.id} className="border-border/30 hover:bg-secondary/20">
                            <TableCell className="text-xs text-foreground/80">
                              {r.tipo === "mantenimiento_preventivo" ? "Mant." : r.tipo === "visita_tecnica" ? "Visita" : r.tipo}
                            </TableCell>
                            <TableCell className="text-xs text-foreground/80 max-w-40 truncate">{r.descripcion || "—"}</TableCell>
                            <TableCell className="text-xs text-foreground/80">{r.fecha}</TableCell>
                            <TableCell className="text-xs text-foreground/80">
                              {r.estadoAprobacionLider === "aprobado" ? "✓" : "Pend."}
                            </TableCell>
                            <TableCell className="text-xs text-right font-medium text-gold">
                              {formatCurrency(r.costoActividad)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-border/30 bg-gold/5">
                          <TableCell colSpan={4} className="text-xs font-bold text-foreground">
                            Subtotal Auxilio Extralegal
                          </TableCell>
                          <TableCell className="text-right font-bold text-gold">
                            {formatCurrency(auxilioTotal)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {rodamientoTotal > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                        RECORRIDOS Y DESPLAZAMIENTOS
                      </p>
                      <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Medio</p>
                            <p className="text-foreground">{tech.tieneMoto ? "Motocicleta" : "Otro"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Recorridos realizados</p>
                            <p className="text-foreground">{recorridoReports.length} desplazamientos</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Valor</p>
                            <p className="font-bold text-emerald-400">{formatCurrency(rodamientoTotal)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Auxilio Extralegal por Productividad</span>
                      <span className="font-medium text-foreground">{formatCurrency(auxilioTotal)}</span>
                    </div>
                    {rodamientoTotal > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Recorridos y Desplazamientos</span>
                        <span className="font-medium text-foreground">{formatCurrency(rodamientoTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold border-t border-gold/20 pt-2">
                      <span className="text-foreground">TOTAL A LIQUIDAR</span>
                      <span className="text-gold">{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 pt-8 mt-4 border-t border-border/50">
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma del Técnico
                        </p>
                        <p className="text-[10px] text-muted-foreground">{tech.nombre} {tech.apellido}</p>
                        <p className="text-[10px] text-muted-foreground">C.C. _______________</p>
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma Supervisor/Gerente
                        </p>
                        <p className="text-[10px] text-muted-foreground">SOLUCIONES & AUTOMATIZACIONES S.A.S.</p>
                        <p className="text-[10px] text-muted-foreground">Representante Legal</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-2 rounded border border-border/30 bg-secondary/10">
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      <strong>Nota:</strong> Este pago se realiza bajo los términos de la Cláusula Tercera del contrato de trabajo
                      (Pagos No Prestacionales - Art. 128 CST). Los valores aquí descritos corresponden a auxilios extralegales y
                      compensaciones que no constituyen salario ni factor prestacional. Este documento no reemplaza el comprobante
                      de nómina del salario básico.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 border-border/50 text-foreground/80"
                    onClick={() => setComprobanteOpen(false)}
                  >
                    Cerrar
                  </Button>
                  <Button
                    className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                    onClick={() => {
                      const tech = users.find((u) => u.id === selectedTechId);
                      const techData = techSummary.get(selectedTechId!);
                      if (!tech || !techData) return;
                      const pdfReports = periodReports.filter((r) => r.tecnicoId === selectedTechId);
                      const pdfNonRecorrido = pdfReports.filter((r) => r.tipo !== "recorrido");
                      const pdfRecorrido = pdfReports.filter((r) => r.tipo === "recorrido");
                      const pdfAuxilio = pdfNonRecorrido.reduce((s, r) => s + r.costoActividad, 0);
                      const pdfRodamiento = pdfRecorrido.reduce((s, r) => s + r.costoActividad, 0);
                      generateComprobantePDF({
                        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
                        periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin}` : "",
                        tecnico: `${tech.nombre} ${tech.apellido}`,
                        items: pdfNonRecorrido.map((r) => ({
                          actividad: r.descripcion || r.tipo,
                          edificio: "",
                          fecha: r.fecha,
                          porcentaje: 100,
                          valor: r.costoActividad,
                        })),
                        totalAuxilio: pdfAuxilio,
                        totalRodamiento: pdfRodamiento,
                        grandTotal: pdfAuxilio + pdfRodamiento,
                      });
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Descargar PDF
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
