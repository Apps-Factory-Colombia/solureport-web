"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  Ban,
  MessageSquareWarning,
  FileWarning,
  Percent,
  ImageIcon,
} from "lucide-react";
import { ArrivalRecord, User, CompanySettings } from "@/lib/types";
import { getLlegadas, updateLlegada } from "@/lib/supabase/services/llegadas";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { cn } from "@/lib/utils";

export default function LlegadasPage() {
  const [records, setRecords] = useState<ArrivalRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [messageOpen, setMessageOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ArrivalRecord | null>(null);
  const [messageType, setMessageType] = useState<"pedagogico" | "citacion_descargos">("pedagogico");
  const [messageText, setMessageText] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountPercent, setDiscountPercent] = useState("5");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, u, s] = await Promise.all([getLlegadas(), getUsuarios(), getConfiguracion()]);
      setRecords(r);
      setUsers(u);
      setCompanySettings(s);
      setDiscountPercent(String(s.porcentajeDescuentoTardanza));
    } catch (err) {
      console.error("Error cargando llegadas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, dateFilter, statusFilter]);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Control de Llegadas" />
        <AdminPageLoader
          title="Cargando llegadas"
          message="Estamos preparando los registros de asistencia y tardanzas."
          showStats={false}
          rows={6}
        />
      </div>
    );
  }

  const filtered = records.filter((r) => {
    const user = users.find((u) => u.id === r.usuarioId);
    const matchesSearch =
      user?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      user?.apellido.toLowerCase().includes(search.toLowerCase());
    const matchesDate = !dateFilter || r.fecha === dateFilter;
    const matchesStatus =
      statusFilter === "todos" ||
      (statusFilter === "tarde" && r.tarde) ||
      (statusFilter === "puntual" && !r.tarde);
    return matchesSearch && matchesDate && matchesStatus;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentRecords = filtered.slice(startIndex, endIndex);

  const todayRecords = records.filter(
    (r) => r.fecha === new Date().toISOString().split("T")[0]
  );
  const tardanzasHoy = todayRecords.filter((r) => r.tarde).length;
  const puntualesHoy = todayRecords.filter((r) => !r.tarde).length;
  const totalTarde = records.filter((r) => r.tarde).length;

  const handleSendMessage = async () => {
    if (!selectedRecord) return;
    try {
      await updateLlegada(selectedRecord.id, {
        mensajeEnviado: messageText,
        tipoMensaje: messageType,
      });

      const user = users.find((u) => u.id === selectedRecord.usuarioId);
      if (user) {
        await createNotificacion({
          usuarioId: user.id,
          titulo: messageType === "pedagogico" ? "Mensaje Pedagógico" : "Citación a Descargos",
          mensaje: messageText,
          tipo: "general",
          datos: { registroAsistenciaId: selectedRecord.id, tipoMensaje: messageType },
        });
      }

      setMessageOpen(false);
      setSelectedRecord(null);
      setMessageText("");
      await loadData();
    } catch (err) {
      console.error("Error enviando mensaje:", err);
    }
  };

  const handleApplyDiscount = async () => {
    if (!selectedRecord) return;
    try {
      await updateLlegada(selectedRecord.id, {
        descuentoAplicado: true,
        porcentajeDescuento: Number(discountPercent),
      });
      setDiscountOpen(false);
      setSelectedRecord(null);
      await loadData();
    } catch (err) {
      console.error("Error aplicando descuento:", err);
    }
  };

  const defaultPedagogicoMsg =
    "Se le recuerda la importancia de la puntualidad para el correcto desarrollo de las actividades programadas. Este mensaje tiene carácter formativo y busca el mejoramiento continuo del servicio.";
  const defaultCitacionMsg =
    "Por medio del presente se le cita a descargos por incumplimiento reiterado del horario laboral establecido. Favor presentarse en la oficina administrativa para dar explicación de los hechos.";

  return (
    <div>
      <AdminHeader title="Registro de Asistencia" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-emerald-400">{puntualesHoy}</p>
                <p className="text-xs text-muted-foreground">Puntuales Hoy</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-red-500/10 p-2.5">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-red-400">{tardanzasHoy}</p>
                <p className="text-xs text-muted-foreground">Tardanzas Hoy</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{totalTarde}</p>
                <p className="text-xs text-muted-foreground">Total Tardanzas (Período)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <Percent className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">
                  {companySettings?.porcentajeDescuentoTardanza || 5}%
                </p>
                <p className="text-xs text-muted-foreground">Descuento Configurado</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50"
              />
            </div>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-44 bg-secondary/50 border-border/50"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="puntual">Puntuales</SelectItem>
                <SelectItem value="tarde">Tardanzas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Empleado</TableHead>
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Entrada</TableHead>
                  <TableHead className="text-muted-foreground">Salida</TableHead>
                  <TableHead className="text-muted-foreground">Retraso</TableHead>
                  <TableHead className="text-muted-foreground">Evidencia</TableHead>
                  <TableHead className="text-muted-foreground">Mensaje</TableHead>
                  <TableHead className="text-muted-foreground">Descuento</TableHead>
                  <TableHead className="text-muted-foreground w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentRecords.map((record) => {
                  const user = users.find((u) => u.id === record.usuarioId);

                  return (
                    <TableRow
                      key={record.id}
                      className={cn(
                        "border-border/50 hover:bg-secondary/30",
                        record.tarde && "bg-red-500/3"
                      )}
                    >
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {user?.nombre} {user?.apellido}
                        </p>
                        <p className="text-xs text-muted-foreground">{user?.rol}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">{record.fecha}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Prog: {record.horaEsperada}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", record.tarde ? "text-red-400" : "text-emerald-400")}>
                              Real: {record.horaLlegada || "--:--"}
                            </span>
                            {record.estadoEntrada !== "no_reportado" && (
                              <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", record.tarde ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>
                                {record.tarde ? "Tarde" : "Puntual"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Prog: {record.horaSalidaProgramada || "--:--"}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", record.estadoSalida === "salida_anticipada" ? "text-amber-400" : "text-foreground/80")}>
                              Real: {record.horaSalidaReal || "--:--"}
                            </span>
                            {record.estadoSalida && record.estadoSalida !== "no_reportado" && (
                              <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", record.estadoSalida === "salida_anticipada" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>
                                {record.estadoSalida === "salida_anticipada" ? "Anticipada" : "Normal"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {record.tarde ? (
                          <Badge
                            variant="outline"
                            className="bg-red-500/10 text-red-400 border-red-500/20 text-xs"
                          >
                            +{record.minutosRetraso} min
                          </Badge>
                        ) : (
                          <span className="text-xs text-emerald-400">A tiempo</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.fotoObraUrl ? (
                          <button
                            type="button"
                            onClick={() => setImagePreviewUrl(record.fotoObraUrl || null)}
                            className="group relative h-12 w-12 overflow-hidden rounded-md border border-border/50 bg-secondary/40"
                          >
                            <img
                              src={record.fotoObraUrl}
                              alt={`Evidencia de asistencia de ${user?.nombre || "empleado"}`}
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            />
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            record.tarde
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          {record.tarde ? "Tarde" : "Puntual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {record.tipoMensaje ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              record.tipoMensaje === "pedagogico"
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-red-500/10 text-red-400 border-red-500/20"
                            )}
                          >
                            {record.tipoMensaje === "pedagogico"
                              ? "Pedagógico"
                              : "Citación"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.descuentoAplicado ? (
                          <Badge
                            variant="outline"
                            className="bg-gold/10 text-gold border-gold/20 text-xs"
                          >
                            -{record.porcentajeDescuento}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.tarde && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                              title="Enviar mensaje"
                              onClick={() => {
                                setSelectedRecord(record);
                                setMessageType("pedagogico");
                                setMessageText(defaultPedagogicoMsg);
                                setMessageOpen(true);
                              }}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              title="Aplicar descuento"
                              onClick={() => {
                                setSelectedRecord(record);
                                setDiscountPercent(
                                  String(record.porcentajeDescuento || companySettings?.porcentajeDescuentoTardanza || 5)
                                );
                                setDiscountOpen(true);
                              }}
                            >
                              <Percent className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="p-4 border-t border-border/50 flex justify-end">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <PaginationItem key={i + 1}>
                        <PaginationLink
                          onClick={() => setCurrentPage(i + 1)}
                          isActive={currentPage === i + 1}
                          className="cursor-pointer"
                        >
                          {i + 1}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Enviar Mensaje</DialogTitle>
          </DialogHeader>
          {selectedRecord && (() => {
            const user = users.find((u) => u.id === selectedRecord.usuarioId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{user?.nombre} {user?.apellido}</span>
                    {" — "}
                    Llegó a las {selectedRecord.horaLlegada} ({selectedRecord.minutosRetraso} min de retraso)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Tipo de Mensaje</Label>
                  <Select
                    value={messageType}
                    onValueChange={(v: "pedagogico" | "citacion_descargos") => {
                      setMessageType(v);
                      setMessageText(
                        v === "pedagogico" ? defaultPedagogicoMsg : defaultCitacionMsg
                      );
                    }}
                  >
                    <SelectTrigger className="bg-secondary/50 border-border/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="pedagogico">
                        <div className="flex items-center gap-2">
                          <MessageSquareWarning className="h-4 w-4 text-amber-400" />
                          Mensaje Pedagógico
                        </div>
                      </SelectItem>
                      <SelectItem value="citacion_descargos">
                        <div className="flex items-center gap-2">
                          <FileWarning className="h-4 w-4 text-red-400" />
                          Citación a Descargos
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Mensaje</Label>
                  <Textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="bg-secondary/50 border-border/50 min-h-[100px]"
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMessageOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSendMessage}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Send className="h-4 w-4" />
              Enviar Mensaje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedRecord?.descuentoAplicado ? "Editar Descuento" : "Aplicar Descuento por Tardanza"}
            </DialogTitle>
          </DialogHeader>
          {selectedRecord && (() => {
            const user = users.find((u) => u.id === selectedRecord.usuarioId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{user?.nombre} {user?.apellido}</span>
                    {" — "}
                    {selectedRecord.minutosRetraso} minutos de retraso
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Porcentaje de Descuento sobre Actividades</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se descontará este porcentaje de las actividades del técnico/líder en este período.
                  </p>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDiscountOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleApplyDiscount}
              className="gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              <Ban className="h-4 w-4" />
              {selectedRecord?.descuentoAplicado ? "Actualizar Descuento" : "Aplicar Descuento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(imagePreviewUrl)} onOpenChange={(open) => !open && setImagePreviewUrl(null)}>
        <DialogContent className="bg-card border-border sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ImageIcon className="h-5 w-5 text-gold" />
              Evidencia de asistencia
            </DialogTitle>
          </DialogHeader>
          {imagePreviewUrl && (
            <div className="overflow-hidden rounded-lg border border-border/50 bg-secondary/20">
              <img
                src={imagePreviewUrl}
                alt="Evidencia de asistencia"
                className="max-h-[70vh] w-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
