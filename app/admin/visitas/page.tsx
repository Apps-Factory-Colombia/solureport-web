"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
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
  Download,
  DollarSign,
  Eye,
  CheckCircle2,
  Clock,
  Wrench,
  Trash2,
  Loader2,
  FileSpreadsheet,
  Save,
} from "lucide-react";
import { TechnicalVisit, Client, User } from "@/lib/types";
import { deleteVisitaTecnica, getVisitasTecnicas, updateVisitaTecnica } from "@/lib/supabase/services/visitas";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { cn } from "@/lib/utils";
import { generateTablePDF } from "@/lib/utils/pdf-generator";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function VisitasPage() {
  const [visits, setVisits] = useState<TechnicalVisit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [selectedVisit, setSelectedVisit] = useState<TechnicalVisit | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [valorCobrado, setValorCobrado] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFechaInicio, setExportFechaInicio] = useState("");
  const [exportFechaFin, setExportFechaFin] = useState("");
  const [visitToDelete, setVisitToDelete] = useState<TechnicalVisit | null>(null);
  const [deletingVisitId, setDeletingVisitId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [savingValueId, setSavingValueId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [v, c, u] = await Promise.all([getVisitasTecnicas(), getClientes(), getUsuarios()]);
      setVisits(v);
      setClients(c);
      setUsers(u);
      setEditingValues(
        Object.fromEntries(
          v.map((visit) => [visit.id, visit.valorCobradoCliente > 0 ? String(visit.valorCobradoCliente) : ""])
        )
      );
    } catch (err) {
      console.error("Error cargando visitas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Visitas Técnicas" />
        <AdminPageLoader
          title="Cargando visitas"
          message="Estamos preparando las visitas técnicas y sus valores registrados."
          showStats={false}
          rows={6}
        />
      </div>
    );
  }

  const filtered = visits.filter((v) => {
    const client = clients.find((c) => c.id === v.clienteId);
    const tech = users.find((u) => u.id === v.tecnicoId);
    const matchesSearch =
      client?.edificio.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.apellido.toLowerCase().includes(search.toLowerCase()) ||
      v.descripcion.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "todos" || v.estado === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalCobrado = visits
    .filter((v) => v.estado === "verificada")
    .reduce((sum, v) => sum + v.valorCobradoCliente, 0);
  const pendientes = visits.filter((v) => v.estado === "pendiente").length;
  const verificadas = visits.filter((v) => v.estado === "verificada").length;

  const getValorEditado = (visit: TechnicalVisit) => editingValues[visit.id] ?? "";

  const isDirty = (visit: TechnicalVisit) => {
    const editVal = editingValues[visit.id];
    if (editVal === undefined) return false;
    const currentVal = visit.valorCobradoCliente > 0 ? String(visit.valorCobradoCliente) : "";
    return editVal !== currentVal;
  };

  const parseValorCobrado = (rawValue: string, fallbackValue: number) => {
    if (rawValue.trim() === "") return fallbackValue;
    const parsedValue = Number(rawValue);
    return Number.isNaN(parsedValue) ? fallbackValue : parsedValue;
  };

  const saveVisitValue = async (visit: TechnicalVisit, rawValue: string) => {
    setSavingValueId(visit.id);
    try {
      const updatedVisit = await updateVisitaTecnica(visit.id, {
        valorCobradoCliente: parseValorCobrado(rawValue, visit.valorCobradoCliente),
      });

      setVisits((currentVisits) =>
        currentVisits.map((currentVisit) =>
          currentVisit.id === visit.id ? updatedVisit : currentVisit
        )
      );
      setEditingValues((currentValues) => ({
        ...currentValues,
        [visit.id]: updatedVisit.valorCobradoCliente > 0 ? String(updatedVisit.valorCobradoCliente) : "",
      }));

      if (selectedVisit?.id === visit.id) {
        setSelectedVisit(updatedVisit);
        setValorCobrado(updatedVisit.valorCobradoCliente > 0 ? String(updatedVisit.valorCobradoCliente) : "");
      }

      return updatedVisit;
    } catch (err) {
      console.error("Error guardando valor de visita:", err);
      alert("No se pudo guardar el valor de la visita técnica.");
      return null;
    } finally {
      setSavingValueId(null);
    }
  };

  const handleSaveValue = async (visit: TechnicalVisit) => {
    await saveVisitValue(visit, getValorEditado(visit));
  };

  const handleSaveSelectedValue = async () => {
    if (!selectedVisit) return;
    await saveVisitValue(selectedVisit, valorCobrado);
  };

  const handleVerify = async () => {
    if (!selectedVisit) return;
    try {
      await updateVisitaTecnica(selectedVisit.id, {
        estado: "verificada",
        valorCobradoCliente: parseValorCobrado(valorCobrado, selectedVisit.valorCobradoCliente),
      });
      setDetailOpen(false);
      setSelectedVisit(null);
      await loadData();
    } catch (err) {
      console.error("Error verificando visita:", err);
    }
  };

  const handleExport = (format: "pdf" | "excel") => {
    const filteredVisits = visits.filter((v) => {
      if (exportFechaInicio && v.fecha < exportFechaInicio) return false;
      if (exportFechaFin && v.fecha > exportFechaFin) return false;
      return true;
    });

    if (format === "pdf") {
      const rows = filteredVisits.map((v) => {
        const client = clients.find((c) => c.id === v.clienteId);
        const tech = users.find((u) => u.id === v.tecnicoId);
        return [
          v.fecha,
          client?.nombre || "—",
          client?.edificio || "—",
          `${tech?.nombre || ""} ${tech?.apellido || ""}`,
          v.descripcion,
          formatCurrency(v.valorCobradoCliente),
          v.estado,
        ];
      });
      generateTablePDF({
        titulo: "REPORTE DE VISITAS TÉCNICAS",
        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: `${exportFechaInicio || "Inicio"} a ${exportFechaFin || "Fin"}`,
        headers: ["Fecha", "Cliente", "Edificio", "Técnico", "Descripción", "Valor", "Estado"],
        rows,
        totales: ["TOTAL", "", "", "", `${filteredVisits.length} visitas`, formatCurrency(filteredVisits.reduce((s, v) => s + v.valorCobradoCliente, 0)), ""],
      });
    } else {
      const header = "Fecha,Cliente,Edificio,Técnico,Descripción,Valor Cobrado,Estado";
      const csvRows = filteredVisits.map((v) => {
        const client = clients.find((c) => c.id === v.clienteId);
        const tech = users.find((u) => u.id === v.tecnicoId);
        return `${v.fecha},"${client?.nombre}","${client?.edificio}","${tech?.nombre} ${tech?.apellido}","${v.descripcion}",${v.valorCobradoCliente},${v.estado}`;
      });
      const blob = new Blob([header + "\n" + csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_visitas_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExportOpen(false);
  };

  const handleDeleteVisit = async (visit: TechnicalVisit) => {
    setDeletingVisitId(visit.id);
    try {
      await deleteVisitaTecnica(visit.id);

      if (selectedVisit?.id === visit.id) {
        setDetailOpen(false);
        setSelectedVisit(null);
      }

      setVisitToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando visita:", err);
      alert("No se pudo eliminar la visita técnica.");
    } finally {
      setDeletingVisitId(null);
    }
  };

  return (
    <div>
      <AdminHeader title="Visitas Técnicas" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <DollarSign className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">{formatCurrency(totalCobrado)}</p>
                <p className="text-xs text-muted-foreground">Total Cobrado</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{verificadas}</p>
                <p className="text-xs text-muted-foreground">Verificadas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{pendientes}</p>
                <p className="text-xs text-muted-foreground">Pendientes de Verificar</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar visita..."
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
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="verificada">Verificada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => setExportOpen(true)}
            variant="outline"
            className="gap-2 border-border/50 text-foreground/80"
          >
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Cliente</TableHead>
                  <TableHead className="text-muted-foreground">Técnico</TableHead>
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Descripción</TableHead>
                  <TableHead className="text-muted-foreground">Valor Cobrado</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  <TableHead className="text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((visit) => {
                  const client = clients.find((c) => c.id === visit.clienteId);
                  const tech = users.find((u) => u.id === visit.tecnicoId);

                  return (
                    <TableRow key={visit.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell>
                        <p className="font-medium text-foreground">{client?.edificio}</p>
                        <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">
                        {tech?.nombre} {tech?.apellido}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">{visit.fecha}</TableCell>
                      <TableCell className="text-sm text-foreground/80 max-w-60 truncate">
                        {visit.descripcion}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              type="number"
                              min="0"
                              value={getValorEditado(visit)}
                              onChange={(e) =>
                                setEditingValues((currentValues) => ({
                                  ...currentValues,
                                  [visit.id]: e.target.value,
                                }))
                              }
                              className={cn(
                                "h-8 w-28 pl-7 pr-3 bg-secondary/50 border-border/50 text-sm font-semibold transition-colors",
                                isDirty(visit) ? "border-gold/50 bg-gold/5 text-gold" : "text-foreground"
                              )}
                              placeholder="0"
                            />
                          </div>
                          {isDirty(visit) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-gold hover:text-gold hover:bg-gold/10 shrink-0"
                              onClick={() => handleSaveValue(visit)}
                              disabled={savingValueId === visit.id}
                            >
                              {savingValueId === visit.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            visit.estado === "verificada"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          )}
                        >
                          {visit.estado === "verificada" ? "Verificada" : "Pendiente"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setSelectedVisit(visit);
                              setValorCobrado(getValorEditado(visit));
                              setDetailOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setVisitToDelete(visit)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle de Visita Técnica</DialogTitle>
          </DialogHeader>
          {selectedVisit && (() => {
            const client = clients.find((c) => c.id === selectedVisit.clienteId);
            const tech = users.find((u) => u.id === selectedVisit.tecnicoId);
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Cliente</p>
                    <p className="text-sm font-medium text-foreground">{client?.nombre}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">
                      {tech?.nombre} {tech?.apellido}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="text-sm font-medium text-foreground">{selectedVisit.fecha}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Estado</p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        selectedVisit.estado === "verificada"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      )}
                    >
                      {selectedVisit.estado === "verificada" ? "Verificada" : "Pendiente"}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                    {selectedVisit.descripcion}
                  </p>
                </div>
                <div className="space-y-3 bg-secondary/20 p-4 rounded-xl border border-border/50">
                  <div className="space-y-1">
                    <Label className="text-foreground font-medium flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-gold" />
                      Valor Cobrado al Cliente
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Este valor es solo para el área administrativa.
                    </p>
                  </div>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      value={valorCobrado}
                      onChange={(e) => setValorCobrado(e.target.value)}
                      className={cn(
                        "pl-9 bg-background border-border/50 font-semibold text-lg transition-colors",
                        (selectedVisit.valorCobradoCliente > 0 ? String(selectedVisit.valorCobradoCliente) : "") !== valorCobrado
                          ? "border-gold/50 ring-1 ring-gold/20 text-gold"
                          : ""
                      )}
                      placeholder="Ingrese el valor cobrado"
                    />
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDetailOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveSelectedValue}
              variant="outline"
              className={cn(
                "transition-colors",
                ((selectedVisit?.valorCobradoCliente || 0) > 0 ? String(selectedVisit?.valorCobradoCliente) : "") !== valorCobrado
                  ? "border-gold text-gold hover:text-gold hover:bg-gold/10"
                  : "border-border/50 text-foreground/80"
              )}
              disabled={
                savingValueId === selectedVisit?.id ||
                ((selectedVisit?.valorCobradoCliente || 0) > 0 ? String(selectedVisit?.valorCobradoCliente) : "") === valorCobrado
              }
            >
              {savingValueId === selectedVisit?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Guardar valor"
              )}
            </Button>
            <Button
              onClick={handleVerify}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <CheckCircle2 className="h-4 w-4" />
              Verificar y Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!visitToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingVisitId) setVisitToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que quieres eliminar esta visita técnica? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setVisitToDelete(null)}
              disabled={!!deletingVisitId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => visitToDelete && handleDeleteVisit(visitToDelete)}
              disabled={!!deletingVisitId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingVisitId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingVisitId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Exportar Visitas Técnicas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground/80">Fecha Inicio</Label>
                <Input
                  type="date"
                  value={exportFechaInicio}
                  onChange={(e) => setExportFechaInicio(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Fecha Fin</Label>
                <Input
                  type="date"
                  value={exportFechaFin}
                  onChange={(e) => setExportFechaFin(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Incluye información del cliente, descripción y valor cobrado según las fechas seleccionadas.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => handleExport("excel")}
              variant="outline"
              className="gap-2 border-border/50 text-foreground/80"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button
              onClick={() => handleExport("pdf")}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Download className="h-4 w-4" />
              PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
