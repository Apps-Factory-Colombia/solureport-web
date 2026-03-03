"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  FileText,
  Download,
  Mail,
  Eye,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  Camera,
  Trash2,
  Loader2,
} from "lucide-react";
import { MaintenanceReport, Client, User } from "@/lib/types";
import {
  getReportesMantenimiento,
  updateReporteEnvio,
  deleteReporteMantenimiento,
} from "@/lib/supabase/services/mantenimientos";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { cn } from "@/lib/utils";
import { generateReportePDF } from "@/lib/utils/pdf-generator";

export default function ReportesPage() {
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState<MaintenanceReport | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<MaintenanceReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [sendingReportId, setSendingReportId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [r, c, u] = await Promise.all([getReportesMantenimiento(), getClientes(), getUsuarios()]);
      setReports(r); setClients(c); setUsers(u);
    } catch (err) {
      console.error("Error cargando reportes:", err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSendEmail = async (report: MaintenanceReport) => {
    const client = clients.find((c) => c.id === report.clienteId);
    const tech = users.find((u) => u.id === report.tecnicoId);

    if (!client?.correo) {
      alert("Este cliente no tiene correo registrado.");
      return;
    }

    setSendingReportId(report.id);

    try {
      // Generar PDF en Base64 para adjunto
      const base64Pdf = await generateReportePDF({
        titulo: "REPORTE DE MANTENIMIENTO PREVENTIVO",
        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        fecha: report.fechaGeneracion,
        tecnico: tech ? `${tech.nombre} ${tech.apellido}` : "—",
        cliente: client?.nombre || "—",
        edificio: client?.edificio || "—",
        observaciones: report.observaciones,
        fotosAntes: report.fotosAntes,
        fotosDespues: report.fotosDespues,
        firmaUrl: report.firmaReceptor,
        receptor: report.datosReceptor,
      }, true) as string;

      // Remover el prefijo de data URI que devuelve jsPDF (data:application/pdf;filename=generated.pdf;base64,)
      const base64Content = base64Pdf.split(",")[1];

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: client.correo,
          subject: `Reporte de mantenimiento - ${client.edificio}`,
          data: {
            clienteNombre: client.contacto || client.nombre,
            edificio: client.edificio,
            fecha: report.fechaGeneracion,
            tecnicoNombre: tech ? `${tech.nombre} ${tech.apellido}` : "No disponible",
            observaciones: report.observaciones,
          },
          pdfAttachment: {
            filename: `Reporte_${client.edificio.replace(/\s+/g, '_')}_${report.fechaGeneracion}.pdf`,
            base64: base64Content
          }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "No se pudo enviar el correo.");
      }

      await updateReporteEnvio(report.id);
      setViewerOpen(false);
      setSelectedReport(null);
      await loadData();
    } catch (err) {
      console.error("Error enviando reporte:", err);
      const message = err instanceof Error ? err.message : "No se pudo enviar el reporte por correo.";
      alert(message);
    } finally {
      setSendingReportId(null);
    }
  };

  const handleDeleteReport = async (report: MaintenanceReport) => {
    setDeletingReportId(report.id);
    try {
      await deleteReporteMantenimiento(report.id);

      if (selectedReport?.id === report.id) {
        setViewerOpen(false);
        setSelectedReport(null);
      }

      setReportToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando reporte:", err);
      const message = err instanceof Error
        ? err.message
        : "No se pudo eliminar el reporte y sus fotos.";
      alert(message);
    } finally {
      setDeletingReportId(null);
    }
  };

  const filteredReports = reports.filter((r) => {
    const client = clients.find((c) => c.id === r.clienteId);
    const tech = users.find((u) => u.id === r.tecnicoId);
    return (
      client?.edificio.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.apellido.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleView = (report: MaintenanceReport) => {
    setSelectedReport(report);
    setViewerOpen(true);
  };

  const handleDownloadPDF = async (report: MaintenanceReport) => {
    const client = clients.find((c) => c.id === report.clienteId);
    const tech = users.find((u) => u.id === report.tecnicoId);

    try {
      await generateReportePDF({
        titulo: "REPORTE DE MANTENIMIENTO PREVENTIVO",
        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        fecha: report.fechaGeneracion,
        tecnico: tech ? `${tech.nombre} ${tech.apellido}` : "—",
        cliente: client?.nombre || "—",
        edificio: client?.edificio || "—",
        observaciones: report.observaciones,
        fotosAntes: report.fotosAntes,
        fotosDespues: report.fotosDespues,
        firmaUrl: report.firmaReceptor,
        receptor: report.datosReceptor,
      });
    } catch (err) {
      console.error("Error generando PDF:", err);
      alert("Hubo un error al generar el PDF. Revisa la consola.");
    }
  };

  return (
    <div>
      <AdminHeader title="Reportes de Mantenimiento" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <FileText className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{reports.length}</p>
                <p className="text-xs text-muted-foreground">Total Reportes</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {reports.filter((r) => r.enviado).length}
                </p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {reports.filter((r) => !r.enviado).length}
                </p>
                <p className="text-xs text-muted-foreground">Pendientes de Envío</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar reporte..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Cliente</TableHead>
                  <TableHead className="text-muted-foreground">Técnico</TableHead>
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Fotos</TableHead>
                  <TableHead className="text-muted-foreground">Estado Envío</TableHead>
                  <TableHead className="text-muted-foreground">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.map((report) => {
                  const client = clients.find((c) => c.id === report.clienteId);
                  const tech = users.find((u) => u.id === report.tecnicoId);

                  return (
                    <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
                      <TableCell>
                        <p className="font-medium text-foreground">{client?.edificio}</p>
                        <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">
                        {tech?.nombre} {tech?.apellido}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">
                        {report.fechaGeneracion}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm text-foreground/80">
                          <Camera className="h-3.5 w-3.5 text-cyan-neon" />
                          {report.fotosAntes.length + report.fotosDespues.length} fotos
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            report.enviado
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          )}
                        >
                          {report.enviado ? "Enviado" : "Pendiente"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleView(report)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-gold"
                            onClick={() => handleDownloadPDF(report)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
                            onClick={() => handleSendEmail(report)}
                            disabled={sendingReportId === report.id}
                            title={report.enviado ? "Reenviar correo" : "Enviar correo"}
                          >
                            {sendingReportId === report.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Mail className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setReportToDelete(report)}
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

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Reporte</DialogTitle>
          </DialogHeader>
          {selectedReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="text-sm font-medium text-foreground">
                    {clients.find((c) => c.id === selectedReport.clienteId)?.edificio}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Técnico</p>
                  <p className="text-sm font-medium text-foreground">
                    {(() => {
                      const t = users.find((u) => u.id === selectedReport.tecnicoId);
                      return `${t?.nombre} ${t?.apellido}`;
                    })()}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p className="text-sm font-medium text-foreground">
                    {selectedReport.fechaGeneracion}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      selectedReport.enviado
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    )}
                  >
                    {selectedReport.enviado
                      ? `Enviado el ${selectedReport.fechaEnvio}`
                      : "Pendiente de Envío"}
                  </Badge>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Camera className="h-4 w-4 text-cyan-neon" />
                  Fotos Antes ({selectedReport.fotosAntes.length})
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {selectedReport.fotosAntes.map((url, i) => (
                    <div
                      key={`antes-${i}`}
                      className="aspect-video rounded-lg bg-secondary/50 border border-border/50 overflow-hidden"
                    >
                      {url ? (
                        <img src={url} alt={`Antes ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Camera className="h-4 w-4 text-gold" />
                  Fotos Después ({selectedReport.fotosDespues.length})
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {selectedReport.fotosDespues.map((url, i) => (
                    <div
                      key={`despues-${i}`}
                      className="aspect-video rounded-lg bg-secondary/50 border border-border/50 overflow-hidden"
                    >
                      {url ? (
                        <img src={url} alt={`Después ${i + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Observaciones</h4>
                <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                  {selectedReport.observaciones}
                </p>
              </div>

              {(selectedReport.tipoPendiente || selectedReport.descripcionPendiente) && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Pendiente reportado</h4>
                  <div className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50 space-y-1">
                    {selectedReport.tipoPendiente && (
                      <p><span className="text-muted-foreground">Tipo:</span> {selectedReport.tipoPendiente}</p>
                    )}
                    {selectedReport.descripcionPendiente && (
                      <p><span className="text-muted-foreground">Descripción:</span> {selectedReport.descripcionPendiente}</p>
                    )}
                  </div>
                </div>
              )}

              {selectedReport.datosReceptor && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Datos del Receptor</h4>
                  <div className="rounded-lg bg-secondary/30 border border-border/50 p-3 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Nombre</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.datosReceptor.nombre}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cédula</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.datosReceptor.cedula}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cargo</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.datosReceptor.cargo}</p>
                    </div>
                  </div>
                </div>
              )}

              {selectedReport.firmaReceptor && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Firma del Receptor</h4>
                  <div className="rounded-lg bg-white border border-border/50 p-3 flex items-center justify-center">
                    <img
                      src={selectedReport.firmaReceptor}
                      alt="Firma del receptor"
                      className="max-h-24 object-contain"
                    />
                  </div>
                </div>
              )}

              {selectedReport.fotoBitacora && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Foto de Bitácora</h4>
                  <div className="aspect-video max-w-xs rounded-lg bg-secondary/50 border border-border/50 overflow-hidden">
                    <img
                      src={selectedReport.fotoBitacora}
                      alt="Bitácora"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  className="gap-2 border-border/50 text-foreground/80"
                  onClick={() => handleDownloadPDF(selectedReport)}
                >
                  <Download className="h-4 w-4" />
                  Descargar PDF
                </Button>
                <Button
                  className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                  onClick={() => handleSendEmail(selectedReport)}
                  disabled={sendingReportId === selectedReport.id}
                >
                  {sendingReportId === selectedReport.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      {selectedReport.enviado ? "Reenviar al Cliente" : "Enviar al Cliente"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
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
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que quieres eliminar este reporte? También se eliminarán todas sus fotos del bucket.
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
              onClick={() => reportToDelete && handleDeleteReport(reportToDelete)}
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

      {deletingReportId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando reporte y fotos...</p>
          </div>
        </div>
      )}
    </div>
  );
}
