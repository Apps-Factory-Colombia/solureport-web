"use client";

import { useState, useMemo, useEffect } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Search,
  Wrench,
  ClipboardCheck,
  Route,
  Download,
  Mail,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  Image,
  Eye,
  PenLine,
  BookOpen,
  DollarSign,
  Trash2,
  Loader2,
  Users,
  Send,
} from "lucide-react";
import { ActivityReport, User, Client, WorkGroup, CompanySettings } from "@/lib/types";
import { deleteReporteActividadAdmin, getReportesActividad, markReporteActividadEmailSent } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { cn } from "@/lib/utils";
import { generateReportePDF } from "@/lib/utils/pdf-generator";

const DEFAULT_NOTIFICATION_BCC = "solucionesyautomatizaciones@hotmail.com";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) return "Sin envío";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

export default function InformesPage() {
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<ActivityReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [sendingReportId, setSendingReportId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    Promise.all([getReportesActividad(), getUsuarios(), getClientes(), getGrupos(), getConfiguracion()])
      .then(([r, u, c, g, s]) => { setReports(r); setUsers(u); setClients(c); setGroups(g); setCompanySettings(s); })
      .catch((err) => console.error("Error cargando informes:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteReport = async () => {
    if (!reportToDelete) return;
    setDeletingReportId(reportToDelete.id);
    try {
      await deleteReporteActividadAdmin(reportToDelete.id);
      setReportToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando informe:", err);
      alert("No se pudo eliminar el informe. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  };

  const preventivos = useMemo(
    () => reports.filter((r) => r.tipo === "mantenimiento_preventivo"),
    [reports]
  );
  const visitas = useMemo(
    () => reports.filter((r) => r.tipo === "visita_tecnica"),
    [reports]
  );
  const recorridos = useMemo(
    () => reports.filter((r) => r.tipo === "recorrido"),
    [reports]
  );
  const grupales = useMemo(
    () => reports.filter((r) => r.tipo === "actividad_grupal"),
    [reports]
  );

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const getTipoLabel = (tipo: ActivityReport["tipo"]) => {
    if (tipo === "mantenimiento_preventivo") return "Mantenimiento Preventivo";
    if (tipo === "visita_tecnica") return "Visita Técnica";
    if (tipo === "recorrido") return "Recorrido";
    return "Actividad Grupal";
  };

  const buildMultilineText = (parts: Array<string | undefined | null>) =>
    parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");

  const getSafeFileSegment = (value: string) => {
    return value
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "reporte";
  };

  const getEvidenceCount = (report: ActivityReport) => {
    return (report.fotosAntes?.length || 0) + (report.fotosDespues?.length || 0) + (report.fotoBitacora ? 1 : 0);
  };

  const applySentState = (targetReport: ActivityReport, sentAt: string) => {
    setReports((current) => current.map((item) => {
      if (targetReport.id.startsWith("reg-")) {
        const parts = targetReport.id.split("-");
        const registroId = parts.slice(1, -1).join("-");
        return item.id.startsWith(`reg-${registroId}-`)
          ? { ...item, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
          : item;
      }

      return item.id === targetReport.id
        ? { ...item, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
        : item;
    }));

    setSelectedReport((current) => {
      if (!current) return current;

      if (targetReport.id.startsWith("reg-")) {
        const parts = targetReport.id.split("-");
        const registroId = parts.slice(1, -1).join("-");
        return current.id.startsWith(`reg-${registroId}-`)
          ? { ...current, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
          : current;
      }

      return current.id === targetReport.id
        ? { ...current, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
        : current;
    });
  };

  const getReportContext = (report: ActivityReport) => {
    const tech = usersById.get(report.tecnicoId);
    const client = report.clienteId ? clientsById.get(report.clienteId) : null;
    const group = groupsById.get(report.grupoId);
    const tecnicoNombre = tech ? `${tech.nombre} ${tech.apellido}`.trim() : "—";
    const companyName = companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.";
    const tipoLabel = getTipoLabel(report.tipo);
    const edificio = client?.edificio || group?.nombre || tipoLabel;

    const observaciones = (() => {
      if (report.tipo === "visita_tecnica") {
        return buildMultilineText([
          report.descripcion,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "recorrido") {
        return buildMultilineText([
          report.descripcion,
          report.puntoPartida ? `Punto de partida: ${report.puntoPartida}` : undefined,
          report.puntoLlegada ? `Punto de llegada: ${report.puntoLlegada}` : undefined,
          report.tipoRecorrido ? `Tipo de recorrido: ${report.tipoRecorrido === "con_herramienta" ? "Con herramienta" : "Normal"}` : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "actividad_grupal") {
        return buildMultilineText([
          report.descripcion,
          report.especificacion ? `Especificación: ${report.especificacion}` : undefined,
          group?.nombre ? `Grupo: ${group.nombre}` : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      return buildMultilineText([
        report.descripcion,
        report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
      ]);
    })();

    return {
      client,
      tech,
      group,
      tipoLabel,
      companyName,
      tecnicoNombre,
      edificio,
      pdfData: {
        titulo:
          report.tipo === "mantenimiento_preventivo"
            ? "REPORTE DE MANTENIMIENTO PREVENTIVO"
            : report.tipo === "visita_tecnica"
              ? "REPORTE DE VISITA TÉCNICA"
              : report.tipo === "recorrido"
                ? "REPORTE DE RECORRIDO"
                : "REPORTE DE ACTIVIDAD GRUPAL",
        subtitulo:
          report.tipo === "visita_tecnica"
            ? "Informe técnico consolidado"
            : report.tipo === "recorrido"
              ? report.tipoRecorrido === "con_herramienta"
                ? "Recorrido con herramienta"
                : "Recorrido normal"
              : group?.nombre
                ? `Grupo: ${group.nombre}`
                : undefined,
        empresa: companyName,
        fecha: report.fecha,
        tecnico: tecnicoNombre,
        cliente: client?.nombre || "—",
        edificio,
        direccionCliente: client?.direccion || "—",
        correoCliente: client?.correo || "—",
        observaciones: observaciones || report.descripcion || "Sin detalle registrado.",
        fotosAntes: report.fotosAntes,
        fotosDespues: report.fotosDespues,
        fotoBitacora: report.fotoBitacora,
        firmaUrl: report.firmaReceptor,
        receptor: report.datosReceptor,
      },
    };
  };

  const getReportEmailContext = (report: ActivityReport) => {
    const { client, group, pdfData, tipoLabel, companyName, tecnicoNombre, edificio } = getReportContext(report);
    const operationalEmail = companySettings?.correoEmpresa || DEFAULT_NOTIFICATION_BCC;
    const clienteNombre = client?.contacto || client?.nombre || "Cliente";
    const fileBaseName = getSafeFileSegment(client?.edificio || group?.nombre || tipoLabel);
    const resumen = report.descripcion || report.especificacion || report.observaciones || `Servicio de ${tipoLabel.toLowerCase()}`;

    const detailLines = (() => {
      if (report.tipo === "visita_tecnica") {
        return buildMultilineText([
          report.descripcion,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "recorrido") {
        return buildMultilineText([
          report.descripcion,
          report.puntoPartida ? `Punto de partida: ${report.puntoPartida}` : undefined,
          report.puntoLlegada ? `Punto de llegada: ${report.puntoLlegada}` : undefined,
          report.tipoRecorrido ? `Tipo de recorrido: ${report.tipoRecorrido === "con_herramienta" ? "Con herramienta" : "Normal"}` : undefined,
          report.fotoHerramienta ? "Incluye evidencia fotográfica de herramienta." : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "actividad_grupal") {
        return buildMultilineText([
          report.descripcion,
          report.especificacion ? `Especificación: ${report.especificacion}` : undefined,
          group?.nombre ? `Grupo: ${group.nombre}` : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      return buildMultilineText([
        report.descripcion,
        report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
      ]);
    })();

    const template =
      report.tipo === "mantenimiento_preventivo"
        ? "maintenance-report"
        : report.tipo === "visita_tecnica"
          ? "technical-visit-report"
          : "approval-report";

    const templateData =
      report.tipo === "mantenimiento_preventivo"
        ? {
          companyName,
          clienteNombre,
          edificio,
          fecha: report.fecha,
          tecnicoNombre,
          observaciones: detailLines || resumen,
        }
        : report.tipo === "visita_tecnica"
          ? {
            companyName,
            clienteNombre,
            edificio,
            fecha: report.fecha,
            tecnicoNombre,
            tipoVisita: "aprobada",
            descripcion: report.descripcion,
            observaciones: report.observaciones,
          }
          : {
            companyName,
            clienteNombre,
            edificio,
            fecha: report.fecha,
            tecnicoNombre,
            tipoInforme: tipoLabel,
            resumen,
            observaciones: detailLines !== resumen ? detailLines : undefined,
          };

    return {
      client,
      operationalEmail,
      pdfData,
      template,
      templateData,
      subject: `Reporte de ${tipoLabel.toLowerCase()} - ${edificio}`,
      filename: `${getSafeFileSegment(tipoLabel)}_${fileBaseName}_${report.fecha}.pdf`,
      ccRecipients: [client?.correoAliado, operationalEmail].filter(Boolean),
    };
  };

  const handleDownloadPDF = async (report: ActivityReport) => {
    const { pdfData } = getReportContext(report);

    try {
      await generateReportePDF(pdfData);
    } catch (err) {
      console.error("Error generando PDF del informe técnico:", err);
      alert("Hubo un error al generar el PDF del informe.");
    }
  };

  const handleSendEmail = async (report: ActivityReport) => {
    const context = getReportEmailContext(report);

    if (!context.client?.correo) {
      alert("Este informe no tiene correo del cliente registrado.");
      return;
    }

    setSendingReportId(report.id);

    try {
      const pdfBase64 = await generateReportePDF(context.pdfData, true) as string;
      const base64Content = pdfBase64.split(",")[1];

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: context.client.correo,
          cc: context.ccRecipients,
          subject: context.subject,
          template: context.template,
          data: context.templateData,
          replyTo: context.operationalEmail,
          pdfAttachment: {
            filename: context.filename,
            base64: base64Content,
          },
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "No se pudo enviar el correo del informe.");
      }

      const sentAt = new Date().toISOString();
      await markReporteActividadEmailSent(report.id, sentAt);
      applySentState(report, sentAt);

      alert("Correo enviado correctamente.");
    } catch (err) {
      console.error("Error enviando correo del informe:", err);
      alert("Hubo un error al enviar el correo del informe.");
    } finally {
      setSendingReportId(null);
    }
  };

  const renderActionButtons = (report: ActivityReport) => (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          openReportDetail(report);
        }}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
        onClick={(event) => {
          event.stopPropagation();
          handleSendEmail(report);
        }}
        disabled={sendingReportId === report.id}
      >
        {sendingReportId === report.id ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-gold"
        onClick={(event) => {
          event.stopPropagation();
          handleDownloadPDF(report);
        }}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={(event) => {
          event.stopPropagation();
          setReportToDelete(report);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  const renderEmailStatusBadge = (report: ActivityReport) => (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        report.correoEnviado
          ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/30"
          : "bg-secondary text-muted-foreground border-border/50"
      )}
    >
      {report.correoEnviado ? (
        <><Send className="mr-0.5 h-3 w-3" />Enviado</>
      ) : (
        "Pendiente"
      )}
    </Badge>
  );

  const openReportDetail = (report: ActivityReport) => {
    setSelectedReport(report);
    setDetailOpen(true);
  };

  const filterReports = (list: ActivityReport[]) =>
    list.filter((r) => {
      const tech = users.find((u) => u.id === r.tecnicoId);
      const client = r.clienteId ? clients.find((c) => c.id === r.clienteId) : null;
      const normalizedSearch = search.toLowerCase();
      const matchSearch =
        tech?.nombre.toLowerCase().includes(normalizedSearch) ||
        tech?.apellido.toLowerCase().includes(normalizedSearch) ||
        client?.edificio?.toLowerCase().includes(normalizedSearch) ||
        client?.nombre?.toLowerCase().includes(normalizedSearch) ||
        r.descripcion.toLowerCase().includes(normalizedSearch) ||
        r.especificacion?.toLowerCase().includes(normalizedSearch);
      const matchGrupo = grupoFilter === "todos" || r.grupoId === grupoFilter;
      return matchSearch && matchGrupo;
    });

  if (loading) {
    return (
      <div>
        <AdminHeader title="Informes Técnicos" />
        <AdminPageLoader
          title="Cargando informes técnicos"
          message="Estamos preparando los reportes, técnicos, clientes y grupos."
          statsCount={4}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Informes Técnicos" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2.5">
                <Wrench className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{preventivos.length}</p>
                <p className="text-xs text-muted-foreground">Mant. Preventivos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                <ClipboardCheck className="h-5 w-5 text-cyan-neon" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{visitas.length}</p>
                <p className="text-xs text-muted-foreground">Visitas Técnicas</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <Route className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{recorridos.length}</p>
                <p className="text-xs text-muted-foreground">Recorridos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2.5">
                <Users className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{grupales.length}</p>
                <p className="text-xs text-muted-foreground">Act. Grupales</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Select value={grupoFilter} onValueChange={setGrupoFilter}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Grupo" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="preventivos" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger value="preventivos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
              <Wrench className="h-4 w-4 mr-2" />
              Mant. Preventivo
              <Badge className="ml-1.5 bg-blue-500/20 text-blue-400 text-[10px] border-0 px-1.5">{preventivos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="visitas" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Visitas Técnicas
              <Badge className="ml-1.5 bg-cyan-neon/20 text-cyan-neon text-[10px] border-0 px-1.5">{visitas.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="recorridos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
              <Route className="h-4 w-4 mr-2" />
              Recorridos
              <Badge className="ml-1.5 bg-emerald-500/20 text-emerald-400 text-[10px] border-0 px-1.5">{recorridos.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="grupales" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
              <Users className="h-4 w-4 mr-2" />
              Act. Grupales
              <Badge className="ml-1.5 bg-purple-500/20 text-purple-400 text-[10px] border-0 px-1.5">{grupales.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preventivos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-blue-400" />
                  Informes de Mantenimiento Preventivo
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Reportes generados desde el aplicativo para los mantenimientos programados desde la web. Incluyen firma del receptor, bitácora obligatoria y fotos.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Receptor</TableHead>
                      <TableHead className="text-muted-foreground">Bitácora</TableHead>
                      <TableHead className="text-muted-foreground">Fotos</TableHead>
                      <TableHead className="text-muted-foreground">Líder</TableHead>
                      <TableHead className="text-muted-foreground">Aprobación</TableHead>
                      <TableHead className="text-muted-foreground">Correo</TableHead>
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(preventivos).map((r) => {
                      const tech = usersById.get(r.tecnicoId);
                      const client = r.clienteId ? clientsById.get(r.clienteId) : null;
                      const leader = usersById.get(r.liderGrupoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r)}>
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-foreground/80">{client?.edificio}</p>
                            {r.especificacion && (
                              <p className="text-xs text-muted-foreground truncate">
                                Especificación: {r.especificacion}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell>
                            {r.datosReceptor ? (
                              <div className="flex items-center gap-1.5">
                                <PenLine className="h-3.5 w-3.5 text-gold" />
                                <div>
                                  <p className="text-xs text-foreground">{r.datosReceptor.nombre}</p>
                                  <p className="text-[10px] text-muted-foreground">{r.datosReceptor.cargo}</p>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.bitacora ? (
                              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                <BookOpen className="h-3 w-3 mr-0.5" />
                                Sí
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-secondary text-muted-foreground border-border/50">
                                No
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Image className="h-3 w-3" />
                              {getEvidenceCount(r)}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-foreground/80">
                            {leader?.nombre} {leader?.apellido}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                r.estadoAprobacionLider === "aprobado"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              )}
                            >
                              {r.estadoAprobacionLider === "aprobado" ? (
                                <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado</>
                              ) : (
                                <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>{renderActionButtons(r)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visitas">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-cyan-neon" />
                  Informes de Visitas Técnicas
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Visitas del día a día: imprevistos, garantías y emergencias. Al ser aprobada por el líder se convierte automáticamente en actividad y se reporta aquí.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Descripción</TableHead>
                      <TableHead className="text-muted-foreground">Fotos</TableHead>
                      <TableHead className="text-muted-foreground">Aprobación Líder</TableHead>
                      <TableHead className="text-muted-foreground">Correo</TableHead>
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(visitas).map((r) => {
                      const tech = usersById.get(r.tecnicoId);
                      const client = r.clienteId ? clientsById.get(r.clienteId) : null;
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r)}>
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {client?.edificio || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell className="text-sm text-foreground/80 max-w-56 truncate">
                            <div>
                              <p className="truncate">{r.descripcion}</p>
                              {r.especificacion && (
                                <p className="text-xs text-muted-foreground truncate">
                                  Especificación: {r.especificacion}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Image className="h-3 w-3" />
                              {getEvidenceCount(r)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                r.estadoAprobacionLider === "aprobado"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              )}
                            >
                              {r.estadoAprobacionLider === "aprobado" ? (
                                <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado → Actividad</>
                              ) : (
                                <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>{renderActionButtons(r)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recorridos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <Route className="h-5 w-5 text-emerald-400" />
                  Informes de Recorridos
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Recorridos reportados desde el aplicativo. Incluyen punto de partida, punto de llegada, modalidad (normal o con herramienta) y foto obligatoria de herramienta cuando aplica.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Partida</TableHead>
                      <TableHead className="text-muted-foreground">Llegada</TableHead>
                      <TableHead className="text-muted-foreground">Modalidad</TableHead>
                      <TableHead className="text-muted-foreground">Herramienta</TableHead>
                      <TableHead className="text-muted-foreground">Aprobación</TableHead>
                      <TableHead className="text-muted-foreground">Correo</TableHead>
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(recorridos).map((r) => {
                      const tech = usersById.get(r.tecnicoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r)}>
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 max-w-40">
                              <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="text-xs text-foreground/80 truncate">{r.puntoPartida}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 max-w-40">
                              <MapPin className="h-3.5 w-3.5 text-gold shrink-0" />
                              <span className="text-xs text-foreground/80 truncate">{r.puntoLlegada}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                r.tipoRecorrido === "con_herramienta"
                                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              )}
                            >
                              {r.tipoRecorrido === "con_herramienta" ? (
                                <><Package className="h-3 w-3 mr-0.5" />Con Herram.</>
                              ) : (
                                <><Route className="h-3 w-3 mr-0.5" />Normal</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.fotoHerramienta ? (
                              <span className="text-xs text-foreground/80 flex items-center gap-1">
                                <Image className="h-3 w-3 text-amber-400" /> Adjunta
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                r.estadoAprobacionLider === "aprobado"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              )}
                            >
                              {r.estadoAprobacionLider === "aprobado" ? "Aprobado" : "Pendiente"}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>{renderActionButtons(r)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="grupales">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-400" />
                  Actividades Grupales
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Actividades registradas por el líder desde el aplicativo móvil. Cada participante tiene su propio registro con porcentaje y valor calculado.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Descripción</TableHead>
                      <TableHead className="text-muted-foreground">Líder</TableHead>
                      <TableHead className="text-muted-foreground">Aprobación</TableHead>
                      <TableHead className="text-muted-foreground">Correo</TableHead>
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(grupales).map((r) => {
                      const tech = usersById.get(r.tecnicoId);
                      const group = groupsById.get(r.grupoId);
                      const leader = usersById.get(r.liderGrupoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r)}>
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{group?.nombre || "—"}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                            <div>
                              <p className="truncate">{r.descripcion}</p>
                              {r.especificacion && (
                                <p className="text-xs text-muted-foreground truncate">
                                  Especificación: {r.especificacion}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-foreground/80">
                            {leader?.nombre} {leader?.apellido}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                r.estadoAprobacionLider === "aprobado"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : r.estadoAprobacionLider === "rechazado"
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              )}
                            >
                              {r.estadoAprobacionLider === "aprobado" ? (
                                <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado</>
                              ) : r.estadoAprobacionLider === "rechazado" ? (
                                <>Rechazado</>
                              ) : (
                                <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>{renderActionButtons(r)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedReport(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Informe Técnico</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Vista completa del reporte seleccionado para revisión administrativa.
            </DialogDescription>
          </DialogHeader>
          {selectedReport && (() => {
            const tech = usersById.get(selectedReport.tecnicoId);
            const leader = usersById.get(selectedReport.liderGrupoId);
            const client = selectedReport.clienteId ? clientsById.get(selectedReport.clienteId) : null;
            const group = groupsById.get(selectedReport.grupoId);
            const totalFotos = getEvidenceCount(selectedReport);

            return (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="text-sm font-medium text-foreground">{getTipoLabel(selectedReport.tipo)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">{tech ? `${tech.nombre} ${tech.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Grupo</p>
                    <p className="text-sm font-medium text-foreground">{group?.nombre || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Líder</p>
                    <p className="text-sm font-medium text-foreground">{leader ? `${leader.nombre} ${leader.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fecha}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Costo técnico</p>
                    <p className="text-sm font-medium text-gold">{formatCurrency(selectedReport.costoActividad)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Estado aprobación</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.estadoAprobacionLider}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fecha aprobación</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fechaAprobacionLider || "Pendiente"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fotos</p>
                    <p className="text-sm font-medium text-foreground">{totalFotos}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Correo</p>
                    <div className="mt-1">{renderEmailStatusBadge(selectedReport)}</div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Último envío</p>
                    <p className="text-sm font-medium text-foreground">{formatDateTime(selectedReport.fechaUltimoEnvioCorreo)}</p>
                  </div>
                  {client && (
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                      <p className="text-xs text-muted-foreground">Cliente / Proyecto</p>
                      <p className="text-sm font-medium text-foreground">{client.nombre} — {client.edificio}</p>
                    </div>
                  )}
                  {client && (
                    <>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                        <p className="text-xs text-muted-foreground">Dirección</p>
                        <p className="text-sm font-medium text-foreground">{client.direccion || "Sin dirección registrada"}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                        <p className="text-xs text-muted-foreground">Correo del cliente</p>
                        <p className="text-sm font-medium text-foreground break-all">{client.correo || "Sin correo registrado"}</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground">{selectedReport.descripcion || "—"}</p>
                </div>

                {selectedReport.especificacion && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Especificación</p>
                    <p className="text-sm text-foreground">{selectedReport.especificacion}</p>
                  </div>
                )}

                {selectedReport.observaciones && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground">{selectedReport.observaciones}</p>
                  </div>
                )}

                {selectedReport.datosReceptor && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Receptor</p>
                    <p className="text-sm text-foreground">
                      {selectedReport.datosReceptor.nombre}
                      {selectedReport.datosReceptor.cedula ? ` · CC: ${selectedReport.datosReceptor.cedula}` : ""}
                      {selectedReport.datosReceptor.cargo ? ` · ${selectedReport.datosReceptor.cargo}` : ""}
                    </p>
                  </div>
                )}

                {(selectedReport.tipo === "mantenimiento_preventivo" || selectedReport.tipo === "visita_tecnica") && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Bitácora</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.bitacora ? "Sí" : "No"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Firma receptor</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.firmaReceptor ? "Registrada" : "No registrada"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Fotos evidencias</p>
                      <p className="text-sm font-medium text-foreground">{totalFotos}</p>
                    </div>
                  </div>
                )}

                {selectedReport.tipo === "recorrido" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Punto de partida</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.puntoPartida || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Punto de llegada</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.puntoLlegada || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Tipo de recorrido</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.tipoRecorrido || "—"}</p>
                    </div>
                  </div>
                )}

                {totalFotos > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">Evidencia fotográfica</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {selectedReport.fotosAntes && selectedReport.fotosAntes.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Antes ({selectedReport.fotosAntes.length})</p>
                          <div className="grid grid-cols-2 gap-2">
                            {selectedReport.fotosAntes.map((url, index) => (
                              <a key={`antes-${index}`} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border border-border/50 bg-secondary/20">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Antes ${index + 1}`} className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedReport.fotosDespues && selectedReport.fotosDespues.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Después ({selectedReport.fotosDespues.length})</p>
                          <div className="grid grid-cols-2 gap-2">
                            {selectedReport.fotosDespues.map((url, index) => (
                              <a key={`despues-${index}`} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border border-border/50 bg-secondary/20">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Después ${index + 1}`} className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedReport.fotoBitacora && (
                        <div className="space-y-2 md:col-span-2">
                          <p className="text-xs text-muted-foreground">Foto de bitácora</p>
                          <a
                            href={selectedReport.fotoBitacora}
                            target="_blank"
                            rel="noreferrer"
                            className="block max-w-md overflow-hidden rounded-md border border-border/50 bg-secondary/20"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={selectedReport.fotoBitacora} alt="Foto de bitácora" className="h-full w-full object-cover" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 border-t border-border/50 pt-2">
                  <Button
                    variant="outline"
                    className="gap-2 border-border/50 text-foreground/80"
                    onClick={() => handleSendEmail(selectedReport)}
                    disabled={sendingReportId === selectedReport.id}
                  >
                    {sendingReportId === selectedReport.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Enviar correo
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 border-border/50 text-foreground/80"
                    onClick={() => handleDownloadPDF(selectedReport)}
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
              ¿Seguro que deseas eliminar este informe? Esta acción no se puede deshacer.
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
              onClick={handleDeleteReport}
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
            <p className="text-sm text-foreground">Eliminando informe...</p>
          </div>
        </div>
      )}
    </div>
  );
}
