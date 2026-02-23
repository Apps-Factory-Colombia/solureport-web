"use client";

import { useState } from "react";
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
} from "lucide-react";
import { MaintenanceReport } from "@/lib/types";
import { mockReports, mockClients, mockUsers, mockMaintenances } from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";

export default function ReportesPage() {
  const [reports] = useState<MaintenanceReport[]>(mockReports);
  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState<MaintenanceReport | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const filteredReports = reports.filter((r) => {
    const client = mockClients.find((c) => c.id === r.clienteId);
    const tech = mockUsers.find((u) => u.id === r.tecnicoId);
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
                  const client = mockClients.find((c) => c.id === report.clienteId);
                  const tech = mockUsers.find((u) => u.id === report.tecnicoId);

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
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {!report.enviado && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
                            >
                              <Mail className="h-4 w-4" />
                            </Button>
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
                    {mockClients.find((c) => c.id === selectedReport.clienteId)?.edificio}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Técnico</p>
                  <p className="text-sm font-medium text-foreground">
                    {(() => {
                      const t = mockUsers.find((u) => u.id === selectedReport.tecnicoId);
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
                  {selectedReport.fotosAntes.map((_, i) => (
                    <div
                      key={`antes-${i}`}
                      className="aspect-video rounded-lg bg-secondary/50 border border-border/50 flex items-center justify-center"
                    >
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
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
                  {selectedReport.fotosDespues.map((_, i) => (
                    <div
                      key={`despues-${i}`}
                      className="aspect-video rounded-lg bg-secondary/50 border border-border/50 flex items-center justify-center"
                    >
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
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

              <div className="flex justify-end gap-2">
                <Button variant="outline" className="gap-2 border-border/50 text-foreground/80">
                  <Download className="h-4 w-4" />
                  Descargar PDF
                </Button>
                {!selectedReport.enviado && (
                  <Button className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold">
                    <Mail className="h-4 w-4" />
                    Enviar al Cliente
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
