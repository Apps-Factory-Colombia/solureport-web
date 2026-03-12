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
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  Image,
  PenLine,
  BookOpen,
  DollarSign,
  Trash2,
  Loader2,
  Users,
} from "lucide-react";
import { ActivityReport, User, Client, WorkGroup } from "@/lib/types";
import { deleteReporteActividadAdmin, getReportesActividad } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function InformesPage() {
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [reportToDelete, setReportToDelete] = useState<ActivityReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    Promise.all([getReportesActividad(), getUsuarios(), getClientes(), getGrupos()])
      .then(([r, u, c, g]) => { setReports(r); setUsers(u); setClients(c); setGroups(g); })
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

  const filterReports = (list: ActivityReport[]) =>
    list.filter((r) => {
      const tech = users.find((u) => u.id === r.tecnicoId);
      const client = r.clienteId ? clients.find((c) => c.id === r.clienteId) : null;
      const matchSearch =
        tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
        tech?.apellido.toLowerCase().includes(search.toLowerCase()) ||
        client?.edificio?.toLowerCase().includes(search.toLowerCase()) ||
        r.descripcion.toLowerCase().includes(search.toLowerCase());
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
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(preventivos).map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      const client = r.clienteId ? clients.find((c) => c.id === r.clienteId) : null;
                      const leader = users.find((u) => u.id === r.liderGrupoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-foreground/80">{client?.edificio}</p>
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
                              {(r.fotosAntes?.length || 0) + (r.fotosDespues?.length || 0)}
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
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setReportToDelete(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
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
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(visitas).map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      const client = r.clienteId ? clients.find((c) => c.id === r.clienteId) : null;
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {client?.edificio || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell className="text-sm text-foreground/80 max-w-56 truncate">
                            {r.descripcion}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Image className="h-3 w-3" />
                              {(r.fotosAntes?.length || 0) + (r.fotosDespues?.length || 0)}
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
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setReportToDelete(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
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
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(recorridos).map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
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
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setReportToDelete(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
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
                      <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterReports(grupales).map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      const group = groups.find((g) => g.id === r.grupoId);
                      const leader = users.find((u) => u.id === r.liderGrupoId);
                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell className="text-sm font-medium text-foreground">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{group?.nombre || "—"}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                            {r.descripcion}
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
                          <TableCell className="text-right font-semibold text-gold text-sm">
                            {formatCurrency(r.costoActividad)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setReportToDelete(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
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
