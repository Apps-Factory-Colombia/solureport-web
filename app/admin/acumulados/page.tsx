"use client";

import { useState, useMemo, useEffect } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  DollarSign,
  CalendarDays,
  CheckCircle2,
  Clock,
  Star,
  Route,
  TrendingUp,
  ArrowRight,
  AlertTriangle,
  Users,
  Save,
  Search,
  ChevronDown,
  X,
} from "lucide-react";
import { LeaderAccumulation, LiquidationPeriod, LeaderApprovalBatch, ActivityReport, User, WorkGroup, CompanySettings } from "@/lib/types";
import { getAcumulacionesLider, getLotesAprobacion, getReportesActividad, upsertConfiguracionExtraLider } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getPeriodos } from "@/lib/supabase/services/liquidacion";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function AcumuladosPage() {
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [accumulations, setAccumulations] = useState<LeaderAccumulation[]>([]);
  const [batches, setBatches] = useState<LeaderApprovalBatch[]>([]);
  const [actReports, setActReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [leaderExtraDrafts, setLeaderExtraDrafts] = useState<Record<string, { porcentaje: string; activo: boolean; tecnicosExcluidosIds?: string[] }>>({});
  const [savingLeaderId, setSavingLeaderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [excludedSearchByLeader, setExcludedSearchByLeader] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const itemsPerPage = 5;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getPeriodos(), getAcumulacionesLider(), getLotesAprobacion(),
      getReportesActividad(), getUsuarios(), getGrupos(), getConfiguracion(),
    ]).then(([p, a, b, r, u, g, s]) => {
      setPeriods(p); setAccumulations(a); setBatches(b);
      setActReports(r); setUsers(u); setGroups(g); setCompanySettings(s);
      if (p.length > 0) setSelectedPeriodId(p[0].id);
    }).catch((err) => console.error("Error cargando acumulados:", err))
      .finally(() => setLoading(false));
  }, []);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const periodBatches = batches.filter(
    (b) => b.periodoId === selectedPeriodId
  );

  const periodReports = actReports.filter(
    (r) => r.periodoId === selectedPeriodId
  );

  const leaders = users.filter((u) => u.esLider);

  const periodAccumulationSettings = useMemo(() => {
    return accumulations.reduce<Map<string, LeaderAccumulation>>((acc, item) => {
      if (item.periodoId === selectedPeriodId) {
        acc.set(item.liderId, item);
      }
      return acc;
    }, new Map());
  }, [accumulations, selectedPeriodId]);

  // Computar acumulaciones desde reportes_actividad
  const defaultExtraPct = companySettings?.porcentajeExtraLider || 0;
  const defaultExtraActivo = companySettings?.extraLiderActivo ?? false;
  const costoRevision = companySettings?.costoRevisionLider || 0;

  const periodAccumulations = useMemo(() => {
    const accMap = new Map<string, {
      liderId: string;
      totalAprobadoPago: number;
      totalPendientePago: number;
      extraLider: number;
      totalRecorridos: number;
      totalAcumulado: number;
      porcentajeExtraLiderAplicado: number;
      extraLiderActivo: boolean;
      tecnicosExcluidosExtraIds?: string[];
      reportesAprobados: number;
    }>();

    leaders.forEach((leader) => {
      const persisted = periodAccumulationSettings.get(leader.id);
      accMap.set(leader.id, {
        liderId: leader.id,
        totalAprobadoPago: persisted?.totalAprobadoPago ?? 0,
        totalPendientePago: persisted?.totalPendientePago ?? 0,
        extraLider: persisted?.extraLider ?? 0,
        totalRecorridos: persisted?.totalRecorridos ?? 0,
        totalAcumulado: persisted?.totalAcumulado ?? 0,
        porcentajeExtraLiderAplicado: persisted?.porcentajeExtraLiderAplicado ?? defaultExtraPct,
        extraLiderActivo: persisted?.extraLiderActivo ?? defaultExtraActivo,
        tecnicosExcluidosExtraIds: persisted?.tecnicosExcluidosExtraIds,
        reportesAprobados: 0,
      });
    });

    // Agrupar reportes por líder
    periodReports.forEach((r) => {
      const liderId = r.liderGrupoId;
      if (!liderId) return;
      const persisted = periodAccumulationSettings.get(liderId);
      const acc = accMap.get(liderId) || {
        liderId,
        totalAprobadoPago: 0,
        totalPendientePago: 0,
        extraLider: 0,
        totalRecorridos: 0,
        totalAcumulado: 0,
        porcentajeExtraLiderAplicado: persisted?.porcentajeExtraLiderAplicado ?? defaultExtraPct,
        extraLiderActivo: persisted?.extraLiderActivo ?? defaultExtraActivo,
        tecnicosExcluidosExtraIds: persisted?.tecnicosExcluidosExtraIds,
        reportesAprobados: 0,
      };

      if (r.tipo === "recorrido") {
        acc.totalRecorridos += r.costoActividad;
      }

      if (r.estadoAprobacionLider === "aprobado") {
        acc.totalAprobadoPago += r.costoActividad;
        acc.reportesAprobados += 1;
      } else {
        acc.totalPendientePago += r.costoActividad;
      }

      accMap.set(liderId, acc);
    });

    // Calcular extra líder y totales
    accMap.forEach((acc) => {
      if (acc.extraLiderActivo && acc.porcentajeExtraLiderAplicado > 0) {
        // Extra se calcula sobre actividades aprobadas (excluidos recorridos) del grupo, excluyendo al técnico configurado.
        const group = groups.find((g) => g.liderId === acc.liderId);
        const groupMembers = group ? users.filter((u) => group.miembros.includes(u.id) && u.id !== acc.liderId) : [];
        const excludedTechnicianIds = acc.tecnicosExcluidosExtraIds?.length ? acc.tecnicosExcluidosExtraIds : groupMembers[0] ? [groupMembers[0].id] : [];
        let extraBase = 0;
        groupMembers.forEach((member) => {
          if (excludedTechnicianIds.includes(member.id)) return;
          const memberReports = periodReports.filter(
            (r) => r.tecnicoId === member.id && r.tipo !== "recorrido" && r.estadoAprobacionLider === "aprobado" && r.liderGrupoId === acc.liderId
          );
          extraBase += memberReports.reduce((s, r) => s + r.costoActividad, 0);
        });
        acc.extraLider = Math.round(extraBase * acc.porcentajeExtraLiderAplicado / 100);
      }
      acc.totalAcumulado = acc.totalAprobadoPago + acc.totalPendientePago + acc.extraLider + acc.totalRecorridos;
    });

    return Array.from(accMap.values());
  }, [periodReports, periodAccumulationSettings, defaultExtraPct, defaultExtraActivo, groups, users, leaders]);

  const handleLeaderExtraDraftChange = (
    liderId: string,
    updates: Partial<{ porcentaje: string; activo: boolean; tecnicosExcluidosIds?: string[] }>,
    current: { porcentajeExtraLiderAplicado: number; extraLiderActivo: boolean; tecnicosExcluidosExtraIds?: string[] },
  ) => {
    const existing = leaderExtraDrafts[liderId] || {
      porcentaje: String(current.porcentajeExtraLiderAplicado),
      activo: current.extraLiderActivo,
      tecnicosExcluidosIds: current.tecnicosExcluidosExtraIds,
    };

    setLeaderExtraDrafts((prev) => ({
      ...prev,
      [liderId]: {
        ...existing,
        ...updates,
      },
    }));
  };

  const handleSaveLeaderExtra = async (
    liderId: string,
    current: { porcentajeExtraLiderAplicado: number; extraLiderActivo: boolean; tecnicosExcluidosExtraIds?: string[] },
  ) => {
    if (!selectedPeriodId) return;

    const existingDraft = leaderExtraDrafts[liderId];
    const draft = existingDraft || {
      porcentaje: String(current.porcentajeExtraLiderAplicado),
      activo: current.extraLiderActivo,
      tecnicosExcluidosIds: current.tecnicosExcluidosExtraIds,
    };

    const porcentaje = Number(draft.porcentaje);
    if (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      alert("El porcentaje del extra líder debe estar entre 0 y 100.");
      return;
    }

    setSaveError(null);
    setSavingLeaderId(liderId);
    try {
      const updated = await upsertConfiguracionExtraLider(liderId, selectedPeriodId, {
        porcentajeExtraLiderAplicado: porcentaje,
        extraLiderActivo: draft.activo,
        tecnicosExcluidosExtraIds: existingDraft && Object.prototype.hasOwnProperty.call(existingDraft, "tecnicosExcluidosIds")
          ? draft.tecnicosExcluidosIds
          : current.tecnicosExcluidosExtraIds,
      });

      setAccumulations((prev) => {
        const exists = prev.some((item) => item.liderId === updated.liderId && item.periodoId === updated.periodoId);
        if (exists) {
          return prev.map((item) => item.liderId === updated.liderId && item.periodoId === updated.periodoId ? { ...item, ...updated } : item);
        }
        return [...prev, updated];
      });

      setLeaderExtraDrafts((prev) => {
        const next = { ...prev };
        delete next[liderId];
        return next;
      });
    } catch (error) {
      console.error("Error guardando configuración de extra líder:", error);
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar la configuración del extra líder para este líder.");
    } finally {
      setSavingLeaderId(null);
    }
  };

  const totalAprobado = periodAccumulations.reduce((s, a) => s + a.totalAprobadoPago, 0);
  const totalPendiente = periodAccumulations.reduce((s, a) => s + a.totalPendientePago, 0);
  const totalExtraLider = periodAccumulations.reduce((s, a) => s + a.extraLider, 0);
  const totalRecorridos = periodAccumulations.reduce((s, a) => s + a.totalRecorridos, 0);
  const grandTotal = periodAccumulations.reduce((s, a) => s + a.totalAcumulado, 0);

  const toggleCard = (liderId: string) => {
    setOpenCards((prev) => ({ ...prev, [liderId]: !prev[liderId] }));
  };

  const filteredAccumulations = useMemo(() => {
    if (!searchQuery.trim()) return periodAccumulations;
    const lowerQuery = searchQuery.toLowerCase();
    return periodAccumulations.filter((acc) => {
      const leader = users.find((u) => u.id === acc.liderId);
      if (!leader) return false;
      const fullName = `${leader.nombre} ${leader.apellido}`.toLowerCase();
      return fullName.includes(lowerQuery);
    });
  }, [periodAccumulations, searchQuery, users]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedPeriodId]);

  const totalPages = Math.ceil(filteredAccumulations.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentAccumulations = filteredAccumulations.slice(startIndex, endIndex);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Acumulados de Líderes" />
        <AdminPageLoader
          title="Cargando acumulados"
          message="Estamos preparando los acumulados, lotes de aprobación y reportes del período."
          statsCount={4}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Acumulados por Líder" />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
            <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs hidden sm:inline-flex">
              Configuración individual por líder
            </Badge>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar líder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-secondary/50 border-border/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalAprobado)}</p>
                <p className="text-[10px] text-muted-foreground">1. Total Aprobado Pago</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-amber-400">{formatCurrency(totalPendiente)}</p>
                <p className="text-[10px] text-muted-foreground">2. Total Pendiente Pago</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2.5">
                <Star className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-purple-400">{formatCurrency(totalExtraLider)}</p>
                <p className="text-[10px] text-muted-foreground">3. Extra Líder</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                <Route className="h-5 w-5 text-cyan-neon" />
              </div>
              <div>
                <p className="text-lg font-bold text-cyan-neon">{formatCurrency(totalRecorridos)}</p>
                <p className="text-[10px] text-muted-foreground">4. Total Recorridos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gold/20 bg-gold/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <TrendingUp className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-lg font-bold text-gold">{formatCurrency(grandTotal)}</p>
                <p className="text-[10px] text-muted-foreground">5. Total Acumulado</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {saveError && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No se pudo guardar la configuración</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        {periodAccumulations.length === 0 && (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No hay datos de acumulados para este período. Los acumulados se calculan a partir de los reportes de actividad registrados.</p>
            </CardContent>
          </Card>
        )}

        {filteredAccumulations.length === 0 && periodAccumulations.length > 0 && (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No se encontraron líderes que coincidan con "{searchQuery}".</p>
            </CardContent>
          </Card>
        )}

        {currentAccumulations.map((acc) => {
          const leader = users.find((u) => u.id === acc.liderId);
          const group = groups.find((g) => g.liderId === acc.liderId);
          const batch = periodBatches.find((b) => b.liderId === acc.liderId);
          const leaderReports = periodReports.filter((r) => r.liderGrupoId === acc.liderId);
          const approvedReports = leaderReports.filter((r) => r.estadoAprobacionLider === "aprobado");
          const pendingReports = leaderReports.filter((r) => r.estadoAprobacionLider === "pendiente");
          const recorridoReports = leaderReports.filter((r) => r.tipo === "recorrido");
          const nonRecorridoReports = approvedReports.filter((r) => r.tipo !== "recorrido");

          const groupMembers = group ? users.filter((u) => group.miembros.includes(u.id) && u.id !== acc.liderId) : [];
          const defaultExcludedIds = groupMembers[0] ? [groupMembers[0].id] : [];
          const draft = leaderExtraDrafts[acc.liderId];
          const draftPercentage = draft?.porcentaje ?? String(acc.porcentajeExtraLiderAplicado);
          const draftActive = draft?.activo ?? acc.extraLiderActivo;
          const resolvedExcludedIds = draft?.tecnicosExcluidosIds ?? acc.tecnicosExcluidosExtraIds ?? defaultExcludedIds;
          const excludedSearch = excludedSearchByLeader[acc.liderId] || "";
          const filteredGroupMembers = groupMembers.filter((member) =>
            `${member.nombre} ${member.apellido}`.toLowerCase().includes(excludedSearch.toLowerCase())
          );
          const isOpen = openCards[acc.liderId] ?? false;

          return (
            <Card key={acc.liderId} className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
              <Collapsible open={isOpen} onOpenChange={() => toggleCard(acc.liderId)}>
                <CardHeader className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
                          <span className="sr-only">Toggle</span>
                        </Button>
                      </CollapsibleTrigger>
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10">
                        <Users className="h-5 w-5 text-gold" />
                      </div>
                      <div>
                        <CardTitle className="text-base text-foreground flex items-center gap-2">
                          {leader?.nombre} {leader?.apellido}
                          {leader?.esSupervisor && (
                            <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] h-5 py-0">
                              Supervisor
                            </Badge>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground font-normal">{group?.nombre || "Sin grupo"} · Líder</p>
                      </div>
                    </div>

                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-bold text-gold">{formatCurrency(acc.totalAcumulado)}</p>
                      <p className="text-[10px] text-muted-foreground">Total Acumulado</p>
                    </div>
                  </div>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="space-y-6 pt-0 border-t border-border/20 mt-2">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                        <p className="text-lg font-bold text-emerald-400">{formatCurrency(acc.totalAprobadoPago)}</p>
                        <p className="text-[10px] text-muted-foreground">Aprobado Pago</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                        <p className="text-lg font-bold text-amber-400">{formatCurrency(acc.totalPendientePago)}</p>
                        <p className="text-[10px] text-muted-foreground">Pendiente Pago</p>
                        {acc.totalPendientePago > 0 && (
                          <p className="text-[9px] text-amber-400 mt-1 flex items-center justify-center gap-0.5">
                            <ArrowRight className="h-3 w-3" /> Arrastre
                          </p>
                        )}
                      </div>
                      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-center">
                        <p className="text-lg font-bold text-purple-400">{formatCurrency(acc.extraLider)}</p>
                        <p className="text-[10px] text-muted-foreground">Extra Líder</p>
                        <p className="text-[9px] text-purple-400/70 mt-1">
                          {acc.extraLiderActivo ? `${acc.porcentajeExtraLiderAplicado}% activo` : "Inactivo"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3 text-center">
                        <p className="text-lg font-bold text-cyan-neon">{formatCurrency(acc.totalRecorridos)}</p>
                        <p className="text-[10px] text-muted-foreground">Recorridos</p>
                      </div>
                      <div className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-center sm:hidden">
                        <p className="text-lg font-bold text-gold">{formatCurrency(acc.totalAcumulado)}</p>
                        <p className="text-[10px] text-muted-foreground">Total Acumulado</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Star className="h-4 w-4 text-purple-400" />
                        Configuración y Cálculo Extra Líder
                      </p>
                      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Porcentaje para este líder (%)</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={draftPercentage}
                              onChange={(e) => handleLeaderExtraDraftChange(acc.liderId, { porcentaje: e.target.value }, acc)}
                              className="max-w-xs bg-secondary/50 border-border/50"
                            />
                            <p className="text-xs text-muted-foreground">
                              Este valor solo afecta a {leader?.nombre} en el período seleccionado.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Técnicos excluidos de comisión</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full justify-between border-border/50 bg-secondary/50 text-foreground hover:bg-secondary/70"
                                  disabled={groupMembers.length === 0}
                                >
                                  <span className="truncate">
                                    {resolvedExcludedIds.length > 0 ? `${resolvedExcludedIds.length} técnico(s) excluido(s)` : "Seleccionar técnicos"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 opacity-60" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 border-border bg-card p-3" align="start">
                                <div className="space-y-3">
                                  <Input
                                    placeholder="Buscar técnico..."
                                    value={excludedSearch}
                                    onChange={(e) =>
                                      setExcludedSearchByLeader((prev) => ({
                                        ...prev,
                                        [acc.liderId]: e.target.value,
                                      }))
                                    }
                                    className="bg-secondary/50 border-border/50"
                                  />
                                  <ScrollArea className="h-52 rounded-md border border-border/50">
                                    <div className="space-y-1 p-2">
                                      {filteredGroupMembers.map((member) => {
                                        const checked = resolvedExcludedIds.includes(member.id);
                                        return (
                                          <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary/50">
                                            <Checkbox
                                              checked={checked}
                                              onCheckedChange={(nextChecked) => {
                                                const nextExcludedIds = nextChecked
                                                  ? [...resolvedExcludedIds, member.id]
                                                  : resolvedExcludedIds.filter((id) => id !== member.id);
                                                handleLeaderExtraDraftChange(
                                                  acc.liderId,
                                                  { tecnicosExcluidosIds: nextExcludedIds },
                                                  acc,
                                                );
                                              }}
                                            />
                                            <span className="text-sm text-foreground/80">{member.nombre} {member.apellido}</span>
                                          </label>
                                        );
                                      })}
                                      {filteredGroupMembers.length === 0 && (
                                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">No hay técnicos que coincidan con la búsqueda.</p>
                                      )}
                                    </div>
                                  </ScrollArea>
                                  {resolvedExcludedIds.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                      {resolvedExcludedIds.map((excludedId) => {
                                        const excludedMember = groupMembers.find((member) => member.id === excludedId);
                                        if (!excludedMember) return null;
                                        return (
                                          <Badge key={excludedId} variant="outline" className="gap-1 border-border/50 bg-secondary/40 text-xs text-foreground/80">
                                            {excludedMember.nombre} {excludedMember.apellido}
                                            <button
                                              type="button"
                                              className="ml-1"
                                              onClick={() => handleLeaderExtraDraftChange(
                                                acc.liderId,
                                                { tecnicosExcluidosIds: resolvedExcludedIds.filter((id) => id !== excludedId) },
                                                acc,
                                              )}
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </Badge>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                            <p className="text-xs text-muted-foreground">
                              Los técnicos seleccionados no participarán en la base del extra líder.
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-secondary/30 px-4 py-2">
                            <span className="text-sm text-foreground/80">Activo</span>
                            <Switch
                              checked={draftActive}
                              onCheckedChange={(checked) => handleLeaderExtraDraftChange(acc.liderId, { activo: checked }, acc)}
                            />
                          </div>
                          <Button
                            type="button"
                            onClick={() => handleSaveLeaderExtra(acc.liderId, acc)}
                            disabled={savingLeaderId === acc.liderId}
                            className="bg-gold hover:bg-gold-dark text-background font-semibold w-full md:w-auto"
                          >
                            <Save className="h-4 w-4 mr-2" />
                            {savingLeaderId === acc.liderId ? "Guardando..." : "Guardar Cambios"}
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2 text-sm">
                        <p className="text-xs text-muted-foreground">
                          El extra líder corresponde a un <span className="text-purple-400 font-bold">{acc.porcentajeExtraLiderAplicado}%</span> del valor total de las actividades aprobadas, excluidos recorridos y excluyendo a los técnicos seleccionados para este líder en el período.
                        </p>
                        {groupMembers.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic mt-2">No hay integrantes en el grupo de este líder.</p>
                        ) : (
                          <div className="grid grid-cols-1 gap-1 mt-2">
                            {groupMembers.map((member, idx) => {
                              const memberReports = nonRecorridoReports.filter(
                                (r) => r.tecnicoId === member.id
                              );
                              const memberTotal = memberReports.reduce((s, r) => s + r.costoActividad, 0);
                              const isExcluded = resolvedExcludedIds.includes(member.id);
                              const extraApplied = isExcluded ? 0 : Math.round(memberTotal * acc.porcentajeExtraLiderAplicado / 100);

                              return (
                                <div
                                  key={member.id}
                                  className={cn(
                                    "flex items-center justify-between rounded px-3 py-1.5",
                                    isExcluded ? "bg-muted/30" : "bg-purple-500/5"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-[10px] w-5 h-5 p-0 flex items-center justify-center",
                                        isExcluded
                                          ? "bg-muted text-muted-foreground border-border/50"
                                          : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                      )}
                                    >
                                      {idx + 1}
                                    </Badge>
                                    <span className="text-sm text-foreground/80">
                                      {member.nombre} {member.apellido}
                                    </span>
                                    {isExcluded && (
                                      <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground border-border/50">
                                        Excluido
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">
                                      Actividades: {formatCurrency(memberTotal)}
                                    </span>
                                    {!isExcluded && (
                                      <span className="text-xs font-medium text-purple-400">
                                        +{formatCurrency(extraApplied)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {acc.reportesAprobados > 0 && costoRevision > 0 && (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-gold" />
                          Costo por Revisión de Actividades
                        </p>
                        <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Costo por revisión</p>
                              <p className="font-medium text-foreground">{formatCurrency(costoRevision)}</p>
                              <p className="text-[10px] text-muted-foreground">Administrable</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Revisiones realizadas</p>
                              <p className="font-medium text-foreground">{acc.reportesAprobados}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Total costo líder</p>
                              <p className="font-bold text-gold">{formatCurrency(costoRevision * acc.reportesAprobados)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {acc.totalPendientePago > 0 && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                        <p className="text-xs text-amber-400">
                          <strong>Arrastre de período:</strong> Al cerrar este período, {formatCurrency(acc.totalPendientePago)} pendiente de pago se trasladará automáticamente al siguiente período quincenal.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}

        {totalPages > 1 && (
          <div className="flex justify-end">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      onClick={() => setCurrentPage(page)}
                      isActive={currentPage === page}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </div>
  );
}
