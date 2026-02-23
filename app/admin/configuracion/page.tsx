"use client";

import { useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Building2,
  Mail,
  FileText,
  CalendarDays,
  Bell,
  Save,
  Upload,
  Lock,
} from "lucide-react";
import { mockCompanySettings, mockLiquidationPeriods } from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";

export default function ConfiguracionPage() {
  const [companyName, setCompanyName] = useState(mockCompanySettings.nombre);
  const [companyEmail, setCompanyEmail] = useState(mockCompanySettings.correoRemitente);
  const [notifyOnCreate, setNotifyOnCreate] = useState(true);
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [notifyOnOverdue, setNotifyOnOverdue] = useState(true);
  const [notifyOnLiquidation, setNotifyOnLiquidation] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <AdminHeader title="Configuración General" />
      <div className="p-6 space-y-6">
        <Tabs defaultValue="empresa" className="space-y-6">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="empresa"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Building2 className="h-4 w-4 mr-2" />
              Empresa
            </TabsTrigger>
            <TabsTrigger
              value="plantilla"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <FileText className="h-4 w-4 mr-2" />
              Plantilla PDF
            </TabsTrigger>
            <TabsTrigger
              value="periodos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Períodos
            </TabsTrigger>
            <TabsTrigger
              value="notificaciones"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Bell className="h-4 w-4 mr-2" />
              Notificaciones
            </TabsTrigger>
          </TabsList>

          <TabsContent value="empresa">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground">
                  Datos de la Empresa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-start gap-6">
                  <div className="flex h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-border/50 bg-secondary/30">
                    <div className="text-center">
                      <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                      <span className="text-[10px] text-muted-foreground">Logo</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Nombre de la Empresa</Label>
                      <Input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Correo Remitente</Label>
                      <Input
                        type="email"
                        value={companyEmail}
                        onChange={(e) => setCompanyEmail(e.target.value)}
                        className="bg-secondary/50 border-border/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        Este correo se usará para enviar reportes y notificaciones a los clientes.
                      </p>
                    </div>
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

          <TabsContent value="plantilla">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground">
                  Plantilla del Reporte PDF
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-6">
                  <div className="aspect-[8.5/11] max-w-sm mx-auto rounded-lg border border-border/30 bg-white/5 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="h-8 w-24 rounded bg-gold/20" />
                      <div className="text-right">
                        <div className="h-3 w-32 rounded bg-foreground/10 mb-1" />
                        <div className="h-2 w-24 rounded bg-foreground/5" />
                      </div>
                    </div>
                    <Separator className="bg-gold/20" />
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded bg-foreground/10" />
                      <div className="h-3 w-3/4 rounded bg-foreground/10" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="aspect-video rounded bg-cyan-neon/10" />
                      <div className="aspect-video rounded bg-cyan-neon/10" />
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded bg-foreground/5" />
                      <div className="h-2 w-full rounded bg-foreground/5" />
                      <div className="h-2 w-2/3 rounded bg-foreground/5" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="aspect-video rounded bg-gold/10" />
                      <div className="aspect-video rounded bg-gold/10" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Encabezado del Reporte</Label>
                    <Textarea
                      defaultValue="REPORTE DE MANTENIMIENTO - SOLUCIONES & AUTOMATIZACIONES S.A.S."
                      className="bg-secondary/50 border-border/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Pie de Página</Label>
                    <Input
                      defaultValue="© 2025 SoluReport - Todos los derechos reservados"
                      className="bg-secondary/50 border-border/50"
                    />
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mockLiquidationPeriods.map((period, i) => (
                      <TableRow key={period.id} className="border-border/50 hover:bg-secondary/30">
                        <TableCell className="font-medium text-foreground">
                          Período {mockLiquidationPeriods.length - i}
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notificaciones">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground">
                  Configuración de Correos y Notificaciones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Mantenimiento Creado
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Notificar al técnico asignado cuando se crea un nuevo mantenimiento.
                      </p>
                    </div>
                    <Switch
                      checked={notifyOnCreate}
                      onCheckedChange={setNotifyOnCreate}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Mantenimiento Completado
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Notificar al administrador cuando un técnico completa un mantenimiento.
                      </p>
                    </div>
                    <Switch
                      checked={notifyOnComplete}
                      onCheckedChange={setNotifyOnComplete}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Mantenimiento Vencido
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Alertar cuando un mantenimiento programado ha pasado su fecha sin completarse.
                      </p>
                    </div>
                    <Switch
                      checked={notifyOnOverdue}
                      onCheckedChange={setNotifyOnOverdue}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Cierre de Liquidación
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Enviar resumen de liquidación a todos los técnicos al cerrar un período.
                      </p>
                    </div>
                    <Switch
                      checked={notifyOnLiquidation}
                      onCheckedChange={setNotifyOnLiquidation}
                    />
                  </div>
                </div>

                <Separator className="bg-border/50" />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gold" />
                    Plantilla de Correo
                  </h3>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Asunto del Reporte</Label>
                    <Input
                      defaultValue="Reporte de Mantenimiento - {cliente} - {fecha}"
                      className="bg-secondary/50 border-border/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Cuerpo del Correo</Label>
                    <Textarea
                      defaultValue={`Estimado/a {contacto},\n\nAdjunto encontrará el reporte de mantenimiento realizado el {fecha} en {edificio}.\n\nQuedamos atentos a cualquier observación.\n\nCordialmente,\n{empresa}`}
                      className="bg-secondary/50 border-border/50 min-h-[120px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Variables disponibles: {"{cliente}"}, {"{contacto}"}, {"{fecha}"}, {"{edificio}"}, {"{empresa}"}, {"{tecnico}"}
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
    </div>
  );
}
