"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  Wrench,
  Route,
  ClipboardCheck,
  ShieldCheck,
  DollarSign,
  Image,
  MapPin,
  PenLine,
  FileText,
  Package,
  Users,
  Save,
} from "lucide-react";
import { ActivityReport, TipoInforme, User, Client, WorkGroup, CompanySettings } from "@/lib/types";
import { getReportesActividad, updateCostoActividadAdmin, updateEstadoAprobacion } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

const tipoConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  mantenimiento_preventivo: {
    label: "Mant. Preventivo",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Wrench,
  },
  visita_tecnica: {
    label: "Visita Técnica",
    color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20",
    icon: ClipboardCheck,
  },
  recorrido: {
    label: "Recorrido",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: Route,
  },
  actividad_grupal: {
    label: "Actividad Grupal",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    icon: Users,
  },
  // Legacy value present in reportes_actividad.tipo
  actividad: {
    label: "Actividad",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    icon: Users,
  },
};

const defaultTipoConfig = {
  label: "Actividad",
  color: "bg-secondary text-muted-foreground border-border/50",
  icon: FileText,
};

function getTipoConfig(tipo: string) {
  return tipoConfig[tipo] || defaultTipoConfig;
}

const estadoAprobacionConfig = {
  pendiente: { label: "Pendiente", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: XCircle },
};

export default function AprobacionesPage() {
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [estadoFilter, setEstadoFilter] = useState<string>("todos");
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [editableCost, setEditableCost] = useState("");
  const [savingCost, setSavingCost] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, u, c, g] = await Promise.all([getReportesActividad(), getUsuarios(), getClientes(), getGrupos()]);
      setReports(r); setUsers(u); setClients(c); setGroups(g);
    } catch (err) {
      console.error("Error cargando aprobaciones:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setEditableCost(selectedReport ? String(selectedReport.costoActividad) : "");
  }, [selectedReport]);

  const costDraft = Number(editableCost || 0);
  const isCostDirty = selectedReport ? costDraft !== selectedReport.costoActividad : false;

  const persistCost = useCallback(async (report: ActivityReport, nextCost: number) => {
    await updateCostoActividadAdmin(report.id, nextCost);
    setReports((prev) => prev.map((item) => item.id === report.id ? { ...item, costoActividad: nextCost } : item));
    setSelectedReport((prev) => prev && prev.id === report.id ? { ...prev, costoActividad: nextCost } : prev);
  }, []);

  const handleSaveCost = async () => {
    if (!selectedReport) return;
    setSavingCost(true);
    try {
      await persistCost(selectedReport, costDraft);
    } catch (err) {
      console.error("Error actualizando costo de actividad:", err);
    } finally {
      setSavingCost(false);
    }
  };

  const handleApprove = async (report: ActivityReport) => {
    setProcessing(true);
    try {
      const nextCost = selectedReport?.id === report.id ? costDraft : report.costoActividad;
      if (nextCost !== report.costoActividad) {
        await persistCost(report, nextCost);
        report = { ...report, costoActividad: nextCost };
      }
      await updateEstadoAprobacion(report.id, "aprobado");
      const tech = users.find((u) => u.id === report.tecnicoId);
      const tipo = getTipoConfig(String(report.tipo));
      await createNotificacion({
        usuarioId: report.tecnicoId,
        titulo: "Actividad Aprobada",
        mensaje: `Tu informe de ${tipo.label} del ${report.fecha} ha sido aprobado. Valor: $${report.costoActividad.toLocaleString()}.`,
        tipo: "aprobacion",
        datos: { reporteId: report.id, estado: "aprobado" },
      });
      setDetailOpen(false);
      setSelectedReport(null);
      await loadData();
    } catch (err) {
      console.error("Error aprobando:", err);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (report: ActivityReport) => {
    setProcessing(true);
    try {
      const nextCost = selectedReport?.id === report.id ? costDraft : report.costoActividad;
      if (nextCost !== report.costoActividad) {
        await persistCost(report, nextCost);
        report = { ...report, costoActividad: nextCost };
      }
      await updateEstadoAprobacion(report.id, "rechazado");
      const tipo = getTipoConfig(String(report.tipo));
      await createNotificacion({
        usuarioId: report.tecnicoId,
        titulo: "Actividad Rechazada",
        mensaje: `Tu informe de ${tipo.label} del ${report.fecha} ha sido rechazado. Contacta a tu líder para más detalles.`,
        tipo: "aprobacion",
        datos: { reporteId: report.id, estado: "rechazado" },
      });
      setDetailOpen(false);
      setSelectedReport(null);
      await loadData();
    } catch (err) {
      console.error("Error rechazando:", err);
    } finally {
      setProcessing(false);
    }
  };

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      const tech = users.find((u) => u.id === r.tecnicoId);
      const client = r.clienteId ? clients.find((c) => c.id === r.clienteId) : null;
      const matchSearch =
        tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
        tech?.apellido.toLowerCase().includes(search.toLowerCase()) ||
        client?.edificio?.toLowerCase().includes(search.toLowerCase()) ||
        r.descripcion.toLowerCase().includes(search.toLowerCase());
      const matchTipo = tipoFilter === "todos" || r.tipo === tipoFilter;
      const matchEstado = estadoFilter === "todos" || r.estadoAprobacionLider === estadoFilter;
      const matchGrupo = grupoFilter === "todos" || r.grupoId === grupoFilter;
      return matchSearch && matchTipo && matchEstado && matchGrupo;
    });
  }, [reports, search, tipoFilter, estadoFilter, grupoFilter]);

  const totalReportes = reports.length;
  const aprobados = reports.filter((r) => r.estadoAprobacionLider === "aprobado").length;
  const pendientes = reports.filter((r) => r.estadoAprobacionLider === "pendiente").length;
  const totalValor = reports
    .filter((r) => r.estadoAprobacionLider === "aprobado")
    .reduce((s, r) => s + r.costoActividad, 0);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Aprobaciones de Actividades" />
        <AdminPageLoader
          title="Cargando aprobaciones"
          message="Estamos preparando los informes pendientes y el historial de aprobación."
          statsCount={4}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Aprobaciones de Actividades" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                <FileText className="h-5 w-5 text-cyan-neon" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{totalReportes}</p>
                <p className="text-xs text-muted-foreground">Total Informes</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-emerald-400">{aprobados}</p>
                <p className="text-xs text-muted-foreground">Aprobados por Líder</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-amber-400">{pendientes}</p>
                <p className="text-xs text-muted-foreground">Pendientes Aprobación</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <DollarSign className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">{formatCurrency(totalValor)}</p>
                <p className="text-xs text-muted-foreground">Valor Aprobado</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por técnico, cliente o descripción..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Select value={tipoFilter} onValueChange={setTipoFilter}>
            <SelectTrigger className="w-48 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos los tipos</SelectItem>
              <SelectItem value="mantenimiento_preventivo">Mant. Preventivo</SelectItem>
              <SelectItem value="visita_tecnica">Visita Técnica</SelectItem>
              <SelectItem value="recorrido">Recorrido</SelectItem>
              <SelectItem value="actividad_grupal">Actividad Grupal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={estadoFilter} onValueChange={setEstadoFilter}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="aprobado">Aprobado</SelectItem>
              <SelectItem value="rechazado">Rechazado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={grupoFilter} onValueChange={setGrupoFilter}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Grupo" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos los grupos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Tipo</TableHead>
                  <TableHead className="text-muted-foreground">Técnico</TableHead>
                  <TableHead className="text-muted-foreground">Grupo / Líder</TableHead>
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Descripción</TableHead>
                  <TableHead className="text-muted-foreground">Costo</TableHead>
                  <TableHead className="text-muted-foreground">Aprobación</TableHead>
                  <TableHead className="text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((report) => {
                  const tech = users.find((u) => u.id === report.tecnicoId);
                  const leader = users.find((u) => u.id === report.liderGrupoId);
                  const group = groups.find((g) => g.id === report.grupoId);
                  const tipo = getTipoConfig(String(report.tipo));
                  const estado = estadoAprobacionConfig[report.estadoAprobacionLider];
                  const TipoIcon = tipo.icon;

                  return (
                    <TableRow
                      key={report.id}
                      className={cn(
                        "border-border/50 hover:bg-secondary/30",
                        report.estadoAprobacionLider === "pendiente" && "bg-amber-500/3"
                      )}
                    >
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] gap-1", tipo.color)}>
                          <TipoIcon className="h-3 w-3" />
                          {tipo.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium text-foreground">
                          {tech?.nombre} {tech?.apellido}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-foreground/80">{group?.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          Líder: {leader?.nombre} {leader?.apellido}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">{report.fecha}</TableCell>
                      <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                        {report.descripcion}
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-gold">
                        {formatCurrency(report.costoActividad)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs gap-1", estado.color)}>
                          <estado.icon className="h-3 w-3" />
                          {estado.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setSelectedReport(report);
                              setDetailOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {report.estadoAprobacionLider === "pendiente" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-emerald-400"
                                onClick={() => handleApprove(report)}
                                disabled={processing}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                onClick={() => handleReject(report)}
                                disabled={processing}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Informe</DialogTitle>
          </DialogHeader>
          {selectedReport && (() => {
            const tech = users.find((u) => u.id === selectedReport.tecnicoId);
            const leader = users.find((u) => u.id === selectedReport.liderGrupoId);
            const group = groups.find((g) => g.id === selectedReport.grupoId);
            const client = selectedReport.clienteId
              ? clients.find((c) => c.id === selectedReport.clienteId)
              : null;
            const tipo = getTipoConfig(String(selectedReport.tipo));
            const estado = estadoAprobacionConfig[selectedReport.estadoAprobacionLider];

            return (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={cn("text-xs gap-1", tipo.color)}>
                    <tipo.icon className="h-3.5 w-3.5" />
                    {tipo.label}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs gap-1", estado.color)}>
                    <estado.icon className="h-3.5 w-3.5" />
                    {estado.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">{tech?.nombre} {tech?.apellido}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Líder de Grupo</p>
                    <p className="text-sm font-medium text-foreground">{leader?.nombre} {leader?.apellido}</p>
                    {leader?.esSupervisor && (
                      <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                        <ShieldCheck className="h-3 w-3 mr-0.5" />
                        Supervisor
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Grupo</p>
                    <p className="text-sm font-medium text-foreground">{group?.nombre}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fecha}</p>
                  </div>
                  {client && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-xs text-muted-foreground">Cliente</p>
                      <p className="text-sm font-medium text-foreground">{client.nombre} — {client.edificio}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                    {selectedReport.descripcion}
                  </p>
                </div>

                {selectedReport.observaciones && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                      {selectedReport.observaciones}
                    </p>
                  </div>
                )}

                {(selectedReport.tipo === "mantenimiento_preventivo" || selectedReport.tipo === "visita_tecnica") && (
                  <div className="space-y-3">
                    <p className={cn("text-xs font-semibold uppercase tracking-wide", selectedReport.tipo === "visita_tecnica" ? "text-cyan-neon" : "text-blue-400")}>
                      Datos {selectedReport.tipo === "visita_tecnica" ? "Visita Técnica" : "Mantenimiento Preventivo"}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedReport.datosReceptor && (
                        <div className="col-span-2 rounded-lg border border-border/50 bg-secondary/20 p-3">
                          <p className="text-xs text-muted-foreground mb-1">Receptor del Mantenimiento</p>
                          <div className="flex items-center gap-2">
                            <PenLine className="h-4 w-4 text-gold" />
                            <div>
                              <p className="text-sm font-medium text-foreground">{selectedReport.datosReceptor.nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                {selectedReport.datosReceptor.cedula ? `CC: ${selectedReport.datosReceptor.cedula}` : ""}
                                {selectedReport.datosReceptor.cedula && selectedReport.datosReceptor.cargo ? " · " : ""}
                                {selectedReport.datosReceptor.cargo}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Bitácora</p>
                        <p className="text-sm font-medium text-foreground">
                          {selectedReport.bitacora ? "Sí — Foto adjunta" : "No"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Firma receptor</p>
                        <p className="text-sm font-medium text-foreground">
                          {selectedReport.firmaReceptor ? "Sí — Firma digital" : "No registrada"}
                        </p>
                      </div>
                    </div>
                    {(selectedReport.fotosAntes?.length || selectedReport.fotosDespues?.length) ? (
                      <>
                        <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mt-2">Evidencia Fotográfica</p>
                        <div className="grid grid-cols-2 gap-4">
                          {selectedReport.fotosAntes && selectedReport.fotosAntes.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">Antes ({selectedReport.fotosAntes.length})</p>
                              <div className="grid grid-cols-2 gap-2">
                                {selectedReport.fotosAntes.map((url, i) => (
                                  <div key={`antes-${i}`} className="aspect-square rounded-md overflow-hidden bg-secondary/30 border border-border/50 relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Antes ${i + 1}`} className="object-cover w-full h-full" />
                                    <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <Eye className="h-5 w-5 text-foreground" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedReport.fotosDespues && selectedReport.fotosDespues.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">Después ({selectedReport.fotosDespues.length})</p>
                              <div className="grid grid-cols-2 gap-2">
                                {selectedReport.fotosDespues.map((url, i) => (
                                  <div key={`despues-${i}`} className="aspect-square rounded-md overflow-hidden bg-secondary/30 border border-border/50 relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Después ${i + 1}`} className="object-cover w-full h-full" />
                                    <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <Eye className="h-5 w-5 text-foreground" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {selectedReport.tipo === "recorrido" && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Datos del Recorrido</p>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Punto de Partida</p>
                          <p className="text-sm text-foreground">{selectedReport.puntoPartida}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Punto de Llegada</p>
                          <p className="text-sm text-foreground">{selectedReport.puntoLlegada}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/30">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            selectedReport.tipoRecorrido === "con_herramienta"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          {selectedReport.tipoRecorrido === "con_herramienta" ? (
                            <><Package className="h-3 w-3 mr-1" />Con Herramienta</>
                          ) : (
                            <><Route className="h-3 w-3 mr-1" />Normal</>
                          )}
                        </Badge>
                        {selectedReport.fotoHerramienta && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Image className="h-3 w-3" /> Foto herramienta adjunta
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-gold/5 p-4">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Costo de la Actividad</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative w-full max-w-xs">
                        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                        <Input
                          type="number"
                          min="0"
                          value={editableCost}
                          onChange={(e) => setEditableCost(e.target.value)}
                          className={cn(
                            "pl-9 bg-background/70 border-gold/20 text-gold font-semibold",
                            isCostDirty && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                        onClick={handleSaveCost}
                        disabled={!isCostDirty || savingCost || processing}
                      >
                        {savingCost ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingCost ? "Guardando..." : "Guardar valor"}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      El admin puede ajustar este valor incluso si la actividad sigue pendiente por aprobar.
                    </p>
                  </div>
                  {selectedReport.fechaAprobacionLider && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Aprobado por líder</p>
                      <p className="text-sm text-foreground">{selectedReport.fechaAprobacionLider}</p>
                    </div>
                  )}
                </div>

                {selectedReport.estadoAprobacionLider === "pendiente" && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                    <Button
                      variant="outline"
                      className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => handleReject(selectedReport)}
                      disabled={processing}
                    >
                      <XCircle className="h-4 w-4" />
                      Rechazar
                    </Button>
                    <Button
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      onClick={() => handleApprove(selectedReport)}
                      disabled={processing}
                    >
                      {processing ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {processing ? "Procesando..." : "Aprobar"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
