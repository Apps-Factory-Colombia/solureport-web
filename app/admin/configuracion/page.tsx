"use client";

import { useState, useEffect } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CalendarDays,
  Save,
  Plus,
  Pencil,
  Trash2,
  DollarSign,
  Percent,
  Star,
  Route,
} from "lucide-react";
import { CompanySettings, LiquidationPeriod } from "@/lib/types";
import { getConfiguracion, updateConfiguracion } from "@/lib/supabase/services/configuracion";
import { createPeriodo, deletePeriodo, getPeriodos, updatePeriodo } from "@/lib/supabase/services/liquidacion";
import { cn } from "@/lib/utils";

export default function ConfiguracionPage() {
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [costoRevisionLider, setCostoRevisionLider] = useState("");
  const [porcentajeExtraLider, setPorcentajeExtraLider] = useState("");
  const [extraLiderActivo, setExtraLiderActivo] = useState(true);
  const [costoRecorridoNormal, setCostoRecorridoNormal] = useState("");
  const [costoRecorridoHerramienta, setCostoRecorridoHerramienta] = useState("");
  const [porcentajeDescuentoTardanza, setPorcentajeDescuentoTardanza] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [periodoEstado, setPeriodoEstado] = useState<LiquidationPeriod["estado"]>("abierto");
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [deletingPeriodId, setDeletingPeriodId] = useState<string | null>(null);

  const loadPeriods = async () => {
    const p = await getPeriodos();
    setPeriods(p);
  };

  useEffect(() => {
    Promise.all([getConfiguracion(), loadPeriods()])
      .then(([s]) => {
        setCompanyName(s.nombre);
        setCompanyEmail(s.correoRemitente);
        setCostoRevisionLider(String(s.costoRevisionLider));
        setPorcentajeExtraLider(String(s.porcentajeExtraLider));
        setExtraLiderActivo(s.extraLiderActivo);
        setCostoRecorridoNormal(String(s.costoRecorridoNormal));
        setCostoRecorridoHerramienta(String(s.costoRecorridoHerramienta));
        setPorcentajeDescuentoTardanza(String(s.porcentajeDescuentoTardanza));
      })
      .catch((err) => console.error("Error cargando configuración:", err));
  }, []);

  const resetPeriodForm = () => {
    setPeriodoInicio("");
    setPeriodoFin("");
    setPeriodoEstado("abierto");
    setEditingPeriodId(null);
  };

  const handleSavePeriod = async () => {
    if (!periodoInicio || !periodoFin) {
      alert("Debes definir fecha de inicio y fin.");
      return;
    }

    if (periodoInicio > periodoFin) {
      alert("La fecha de inicio no puede ser mayor que la fecha de fin.");
      return;
    }

    setSavingPeriod(true);
    try {
      if (editingPeriodId) {
        await updatePeriodo(editingPeriodId, {
          fechaInicio: periodoInicio,
          fechaFin: periodoFin,
          estado: periodoEstado,
        });
      } else {
        await createPeriodo({
          fechaInicio: periodoInicio,
          fechaFin: periodoFin,
          estado: periodoEstado,
        });
      }

      await loadPeriods();
      resetPeriodForm();
    } catch (err) {
      console.error("Error guardando período:", err);
      alert("No se pudo guardar el período.");
    } finally {
      setSavingPeriod(false);
    }
  };

  const handleEditPeriod = (period: LiquidationPeriod) => {
    setEditingPeriodId(period.id);
    setPeriodoInicio(period.fechaInicio);
    setPeriodoFin(period.fechaFin);
    setPeriodoEstado(period.estado);
  };

  const handleDeletePeriod = async (periodId: string) => {
    if (!confirm("¿Seguro que deseas eliminar este período?")) return;

    setDeletingPeriodId(periodId);
    try {
      await deletePeriodo(periodId);
      await loadPeriods();
      if (editingPeriodId === periodId) {
        resetPeriodForm();
      }
    } catch (err) {
      console.error("Error eliminando período:", err);
      alert("No se pudo eliminar el período.");
    } finally {
      setDeletingPeriodId(null);
    }
  };

  const handleSave = async () => {
    try {
      await updateConfiguracion({
        nombre: companyName,
        correoRemitente: companyEmail,
        costoRevisionLider: Number(costoRevisionLider),
        porcentajeExtraLider: Number(porcentajeExtraLider),
        extraLiderActivo,
        costoRecorridoNormal: Number(costoRecorridoNormal),
        costoRecorridoHerramienta: Number(costoRecorridoHerramienta),
        porcentajeDescuentoTardanza: Number(porcentajeDescuentoTardanza),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Error guardando configuraci\u00f3n:", err);
    }
  };

  return (
    <div>
      <AdminHeader title="Configuración General" />
      <div className="p-6 space-y-6">
        <Tabs defaultValue="periodos" className="space-y-6">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="periodos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Períodos
            </TabsTrigger>
            <TabsTrigger
              value="costos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Costos Aplicativo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="periodos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-foreground">
                  Períodos de Liquidación
                </CardTitle>
                <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs">
                  14 días por período
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Período</TableHead>
                      <TableHead className="text-muted-foreground">Fecha Inicio</TableHead>
                      <TableHead className="text-muted-foreground">Fecha Fin</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground">Fecha Cierre</TableHead>
                      <TableHead className="text-muted-foreground text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periods.map((period, i) => (
                      <TableRow key={period.id} className="border-border/50 hover:bg-secondary/30">
                        <TableCell className="font-medium text-foreground">
                          Período {periods.length - i}
                        </TableCell>
                        <TableCell className="text-sm text-foreground/80">{period.fechaInicio}</TableCell>
                        <TableCell className="text-sm text-foreground/80">{period.fechaFin}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              period.estado === "abierto"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-muted text-muted-foreground border-border/50"
                            )}
                          >
                            {period.estado === "abierto" ? "Abierto" : "Cerrado"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-foreground/80">
                          {period.fechaCierre || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEditPeriod(period)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeletePeriod(period.id)}
                              disabled={deletingPeriodId === period.id}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t border-border/50 p-4">
                  <p className="text-sm font-medium text-foreground mb-3">
                    {editingPeriodId ? "Editar Período" : "Nuevo Período"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Fecha Inicio</Label>
                      <Input
                        type="date"
                        value={periodoInicio}
                        onChange={(e) => setPeriodoInicio(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Fecha Fin</Label>
                      <Input
                        type="date"
                        value={periodoFin}
                        onChange={(e) => setPeriodoFin(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Estado</Label>
                      <select
                        value={periodoEstado}
                        onChange={(e) => setPeriodoEstado(e.target.value as LiquidationPeriod["estado"])}
                        className="h-10 w-full rounded-md border border-border/50 bg-secondary/50 px-3 text-sm"
                      >
                        <option value="abierto">Abierto</option>
                        <option value="cerrado">Cerrado</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSavePeriod}
                        disabled={savingPeriod}
                        className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                      >
                        <Plus className="h-4 w-4" />
                        {savingPeriod
                          ? "Guardando..."
                          : editingPeriodId
                            ? "Actualizar"
                            : "Crear"}
                      </Button>
                      {editingPeriodId && (
                        <Button
                          variant="outline"
                          onClick={resetPeriodForm}
                          className="border-border/50"
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="costos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground">
                  Costos del Aplicativo Móvil
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Star className="h-4 w-4 text-purple-400" />
                    Extra Líder
                  </h3>
                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Extra Líder Activo
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Habilitar el porcentaje extra para el líder sobre las actividades del grupo (excluye recorridos y primer integrante).
                      </p>
                    </div>
                    <Switch
                      checked={extraLiderActivo}
                      onCheckedChange={setExtraLiderActivo}
                    />
                  </div>
                  {extraLiderActivo && (
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Porcentaje Extra Líder (%)</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={porcentajeExtraLider}
                        onChange={(e) => setPorcentajeExtraLider(e.target.value)}
                        className="bg-secondary/50 border-border/50 max-w-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Este porcentaje se aplica sobre el valor total de las actividades (sin recorridos) desde el segundo integrante del grupo en adelante. Puede variar en cada cierre de actividades.
                      </p>
                    </div>
                  )}
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-gold" />
                    Costo Revisión Líder
                  </h3>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Costo por cada actividad revisada y aprobada ($)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={costoRevisionLider}
                      onChange={(e) => setCostoRevisionLider(e.target.value)}
                      className="bg-secondary/50 border-border/50 max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Este valor se paga al líder por cada actividad que revisa y aprueba. Es administrable y puede cambiar según la cantidad de actividades.
                    </p>
                  </div>
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Route className="h-4 w-4 text-emerald-400" />
                    Costos de Recorridos
                  </h3>
                  <div className="grid grid-cols-2 gap-4 max-w-lg">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Recorrido Normal ($)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={costoRecorridoNormal}
                        onChange={(e) => setCostoRecorridoNormal(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Recorrido con Herramienta ($)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={costoRecorridoHerramienta}
                        onChange={(e) => setCostoRecorridoHerramienta(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Estos valores se asignan automáticamente a los recorridos reportados desde el aplicativo según la modalidad seleccionada.
                  </p>
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Percent className="h-4 w-4 text-red-400" />
                    Descuento por Tardanza
                  </h3>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Porcentaje de descuento sobre actividades (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={porcentajeDescuentoTardanza}
                      onChange={(e) => setPorcentajeDescuentoTardanza(e.target.value)}
                      className="bg-secondary/50 border-border/50 max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Este porcentaje se descuenta de las actividades del técnico cuando se registra una tardanza.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSave}
                    className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                  >
                    <Save className="h-4 w-4" />
                    {saved ? "Guardado ✓" : "Guardar Cambios"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div >
  );
}
