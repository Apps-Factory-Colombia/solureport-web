"use client";

import { useState, useMemo, useEffect } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Badge } from "@/components/ui/badge";
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
  Percent,
  Users,
} from "lucide-react";
import { LeaderAccumulation, LiquidationPeriod, LeaderApprovalBatch, ActivityReport, User, WorkGroup, CompanySettings } from "@/lib/types";
import { getAcumulacionesLider, getLotesAprobacion, getReportesActividad } from "@/lib/supabase/services/reportes-actividad";
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

  // Computar acumulaciones desde reportes_actividad
  const extraPct = companySettings?.porcentajeExtraLider || 0;
  const extraActivo = companySettings?.extraLiderActivo ?? false;
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
      reportesAprobados: number;
    }>();

    // Agrupar reportes por líder
    periodReports.forEach((r) => {
      const liderId = r.liderGrupoId;
      if (!liderId) return;
      const acc = accMap.get(liderId) || {
        liderId,
        totalAprobadoPago: 0,
        totalPendientePago: 0,
        extraLider: 0,
        totalRecorridos: 0,
        totalAcumulado: 0,
        porcentajeExtraLiderAplicado: extraPct,
        extraLiderActivo: extraActivo,
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
      if (extraActivo && extraPct > 0) {
        // Extra se calcula sobre actividades aprobadas (excluidos recorridos) del grupo desde el 2do integrante
        const group = groups.find((g) => g.liderId === acc.liderId);
        const groupMembers = group ? users.filter((u) => group.miembros.includes(u.id) && u.id !== acc.liderId) : [];
        let extraBase = 0;
        groupMembers.forEach((member, idx) => {
          if (idx === 0) return; // Primer integrante excluido
          const memberReports = periodReports.filter(
            (r) => r.tecnicoId === member.id && r.tipo !== "recorrido" && r.estadoAprobacionLider === "aprobado" && r.liderGrupoId === acc.liderId
          );
          extraBase += memberReports.reduce((s, r) => s + r.costoActividad, 0);
        });
        acc.extraLider = Math.round(extraBase * extraPct / 100);
      }
      acc.totalAcumulado = acc.totalAprobadoPago + acc.totalPendientePago + acc.extraLider + acc.totalRecorridos;
    });

    return Array.from(accMap.values());
  }, [periodReports, extraPct, extraActivo, groups, users]);

  const totalAprobado = periodAccumulations.reduce((s, a) => s + a.totalAprobadoPago, 0);
  const totalPendiente = periodAccumulations.reduce((s, a) => s + a.totalPendientePago, 0);
  const totalExtraLider = periodAccumulations.reduce((s, a) => s + a.extraLider, 0);
  const totalRecorridos = periodAccumulations.reduce((s, a) => s + a.totalRecorridos, 0);
  const grandTotal = periodAccumulations.reduce((s, a) => s + a.totalAcumulado, 0);

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
          {companySettings?.extraLiderActivo ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
              Extra Líder Activo ({companySettings?.porcentajeExtraLider}%)
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border/50 text-xs">
              Extra Líder Inactivo
            </Badge>
          )}
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

        {periodAccumulations.length === 0 && (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No hay datos de acumulados para este período. Los acumulados se calculan a partir de los reportes de actividad registrados.</p>
            </CardContent>
          </Card>
        )}

        {periodAccumulations.map((acc) => {
          const leader = users.find((u) => u.id === acc.liderId);
          const group = groups.find((g) => g.liderId === acc.liderId);
          const batch = periodBatches.find((b) => b.liderId === acc.liderId);
          const leaderReports = periodReports.filter((r) => r.liderGrupoId === acc.liderId);
          const approvedReports = leaderReports.filter((r) => r.estadoAprobacionLider === "aprobado");
          const pendingReports = leaderReports.filter((r) => r.estadoAprobacionLider === "pendiente");
          const recorridoReports = leaderReports.filter((r) => r.tipo === "recorrido");
          const nonRecorridoReports = approvedReports.filter((r) => r.tipo !== "recorrido");

          const groupMembers = group ? users.filter((u) => group.miembros.includes(u.id) && u.id !== acc.liderId) : [];

          return (
            <Card key={acc.liderId} className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg text-foreground flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10">
                      <Users className="h-5 w-5 text-gold" />
                    </div>
                    <div>
                      <p>{leader?.nombre} {leader?.apellido}</p>
                      <p className="text-xs text-muted-foreground font-normal">{group?.nombre} · Líder</p>
                    </div>
                  </CardTitle>
                  {leader?.esSupervisor && (
                    <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-xs">
                      Supervisor
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-5 gap-3">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                    <p className="text-lg font-bold text-emerald-400">{formatCurrency(acc.totalAprobadoPago)}</p>
                    <p className="text-[10px] text-muted-foreground">Aprobado Pago</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                    <p className="text-lg font-bold text-amber-400">{formatCurrency(acc.totalPendientePago)}</p>
                    <p className="text-[10px] text-muted-foreground">Pendiente Pago</p>
                    {acc.totalPendientePago > 0 && (
                      <p className="text-[9px] text-amber-400 mt-1 flex items-center justify-center gap-0.5">
                        <ArrowRight className="h-3 w-3" /> Pasa al siguiente período
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
                  <div className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-center">
                    <p className="text-lg font-bold text-gold">{formatCurrency(acc.totalAcumulado)}</p>
                    <p className="text-[10px] text-muted-foreground">Total Acumulado</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Star className="h-4 w-4 text-purple-400" />
                    Cálculo Extra Líder
                  </p>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      El extra líder corresponde a un <span className="text-purple-400 font-bold">{acc.porcentajeExtraLiderAplicado}%</span> del valor total de las actividades (excluidos recorridos) desde el <span className="text-foreground font-medium">segundo integrante</span> del grupo en adelante. El primer integrante queda excluido.
                    </p>
                    <div className="grid grid-cols-1 gap-1 mt-2">
                      {groupMembers.map((member, idx) => {
                        const memberReports = nonRecorridoReports.filter(
                          (r) => r.tecnicoId === member.id
                        );
                        const memberTotal = memberReports.reduce((s, r) => s + r.costoActividad, 0);
                        const isExcluded = idx === 0;
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}
