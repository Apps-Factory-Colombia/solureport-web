"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { getPeriodos } from "@/lib/supabase/services/liquidacion";
import {
    CleanupMode,
    CleanupModule,
    CleanupPreview,
    executeManualCleanup,
    previewManualCleanup,
} from "@/lib/supabase/services/depuracion";
import { LiquidationPeriod } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
    CalendarRange,
    CheckCircle2,
    DatabaseZap,
    Loader2,
    ShieldAlert,
    Trash2,
} from "lucide-react";

const cleanupModuleConfig: Array<{ id: CleanupModule; title: string; description: string }> = [
    {
        id: "mantenimientos_preventivos",
        title: "Mantenimientos preventivos",
        description: "Elimina mantenimientos base, reportes preventivos, espejos en informes técnicos y sus archivos asociados.",
    },
    {
        id: "visitas_tecnicas",
        title: "Visitas técnicas",
        description: "Elimina visitas, espejos en informes técnicos, fotos, firmas y demás archivos asociados.",
    },
    {
        id: "recorridos",
        title: "Recorridos",
        description: "Elimina recorridos, espejos técnicos, imágenes y demás archivos asociados.",
    },
    {
        id: "actividades_grupales",
        title: "Actividades grupales",
        description: "Elimina registros base, participantes y espejos de actividades grupales en informes técnicos.",
    },
    {
        id: "aprobaciones",
        title: "Aprobaciones",
        description: "Elimina la cola de aprobación y los lotes cerrados del líder en el rango o cierre seleccionado.",
    },
    {
        id: "liquidacion",
        title: "Liquidación",
        description: "Elimina items de liquidación y acumulados del líder ligados al rango o cierre seleccionado.",
    },
    {
        id: "asistencia",
        title: "Asistencia",
        description: "Elimina registros de asistencia por fecha.",
    },
    {
        id: "notificaciones",
        title: "Notificaciones",
        description: "Elimina notificaciones administrativas y operativas por fecha.",
    },
];

function getTodayDateString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDays(baseDate: string, amount: number) {
    const parsed = new Date(`${baseDate}T00:00:00`);
    parsed.setDate(parsed.getDate() + amount);
    return parsed.toISOString().slice(0, 10);
}

function getPeriodLabel(period: LiquidationPeriod) {
    const base = `${period.fechaInicio} al ${period.fechaFin}`;
    if (period.estado === "cerrado") {
        return `${base} · Cerrado ${period.fechaCierre || "sin fecha"}`;
    }

    return `${base} · Abierto`;
}

function buildDefaultModuleState() {
    return cleanupModuleConfig.reduce<Record<CleanupModule, boolean>>((acc, item) => {
        acc[item.id] = item.id === "visitas_tecnicas" || item.id === "recorridos" || item.id === "mantenimientos_preventivos";
        return acc;
    }, {} as Record<CleanupModule, boolean>);
}

export default function DepuracionPage() {
    const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<CleanupMode>("date_range");
    const [startDate, setStartDate] = useState(() => shiftDays(getTodayDateString(), -14));
    const [endDate, setEndDate] = useState(() => getTodayDateString());
    const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
    const [deleteFiles, setDeleteFiles] = useState(true);
    const [deletePeriods, setDeletePeriods] = useState(false);
    const [moduleState, setModuleState] = useState<Record<CleanupModule, boolean>>(() => buildDefaultModuleState());
    const [preview, setPreview] = useState<CleanupPreview | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [confirmationText, setConfirmationText] = useState("");
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getPeriodos()
            .then((result) => {
                setPeriods(result);
                setSelectedPeriodId((current) => current || result[0]?.id || "");
            })
            .catch((error) => {
                console.error("Error cargando periodos para depuración:", error);
                setErrorMessage("No se pudieron cargar los cierres disponibles.");
            })
            .finally(() => setLoading(false));
    }, []);

    const selectedModules = useMemo(
        () => cleanupModuleConfig.filter((item) => moduleState[item.id]).map((item) => item.id),
        [moduleState]
    );

    const canRun = selectedModules.length > 0 && (mode === "date_range" ? Boolean(startDate && endDate) : Boolean(selectedPeriodId));

    const handleToggleModule = (moduleId: CleanupModule, checked: boolean) => {
        setModuleState((current) => ({
            ...current,
            [moduleId]: checked,
        }));
        setPreview(null);
        setStatusMessage(null);
        setErrorMessage(null);
    };

    const buildFilters = () => ({
        mode,
        startDate,
        endDate,
        periodId: selectedPeriodId,
        modules: selectedModules,
        deleteFiles,
        deletePeriods,
    });

    const handlePreview = async () => {
        if (!canRun) {
            setErrorMessage("Completa el rango o selecciona un cierre y marca al menos un bloque de datos.");
            return;
        }

        setPreviewing(true);
        setErrorMessage(null);
        setStatusMessage(null);

        try {
            const result = await previewManualCleanup(buildFilters());
            setPreview(result);
            setConfirmationText("");
        } catch (error) {
            console.error("Error generando preview de depuración:", error);
            setErrorMessage(error instanceof Error ? error.message : "No se pudo analizar la depuración solicitada.");
            setPreview(null);
        } finally {
            setPreviewing(false);
        }
    };

    const handleExecute = async () => {
        if (!preview) {
            setErrorMessage("Primero debes analizar la eliminación.");
            return;
        }

        if (confirmationText.trim().toUpperCase() !== "ELIMINAR") {
            setErrorMessage("Escribe ELIMINAR para confirmar el borrado manual.");
            return;
        }

        setExecuting(true);
        setErrorMessage(null);
        setStatusMessage(null);

        try {
            const result = await executeManualCleanup(buildFilters());
            const deletedTotal = Object.values(result.deletedCounts).reduce((sum, value) => sum + value, 0);
            setStatusMessage(
                `Depuración ejecutada. Se eliminaron ${deletedTotal} registros compuestos entre ${result.range.startDate} y ${result.range.endDate}${result.deletedPeriods > 0 ? ` y ${result.deletedPeriods} cierres/períodos` : ""}.`
            );
            setPreview(null);
            setConfirmationText("");
            const refreshedPeriods = await getPeriodos();
            setPeriods(refreshedPeriods);
            if (selectedPeriodId && !refreshedPeriods.some((period) => period.id === selectedPeriodId)) {
                setSelectedPeriodId(refreshedPeriods[0]?.id || "");
            }
        } catch (error) {
            console.error("Error ejecutando depuración manual:", error);
            setErrorMessage(error instanceof Error ? error.message : "No se pudo completar la depuración manual.");
        } finally {
            setExecuting(false);
        }
    };

    if (loading) {
        return <AdminPageLoader title="Depuración" subtitle="Analizando cierres y bloques de datos" />;
    }

    return (
        <div className="min-h-screen bg-background">
            <AdminHeader title="Depuración Manual" />

            <main className="p-6 space-y-6">
                <Card className="border-amber-500/20 bg-amber-500/5">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-foreground">
                            <ShieldAlert className="h-5 w-5 text-amber-400" />
                            Eliminación manual por fechas o cierres
                        </CardTitle>
                        <CardDescription className="text-muted-foreground">
                            Esta pantalla permite depurar datos operativos y sus archivos asociados, como documentos, imágenes y evidencias. Primero analiza el alcance y luego confirma el borrado.
                        </CardDescription>
                    </CardHeader>
                </Card>

                {errorMessage && (
                    <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                        <ShieldAlert className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{errorMessage}</AlertDescription>
                    </Alert>
                )}

                {statusMessage && (
                    <Alert className="border-emerald-500/20 bg-emerald-500/10 text-emerald-50">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <AlertTitle className="text-emerald-200">Proceso completado</AlertTitle>
                        <AlertDescription className="text-emerald-100/90">{statusMessage}</AlertDescription>
                    </Alert>
                )}

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
                    <Card className="border-border/50 bg-card/80">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-foreground">
                                <DatabaseZap className="h-5 w-5 text-gold" />
                                Alcance de la depuración
                            </CardTitle>
                            <CardDescription className="text-muted-foreground">
                                Selecciona el criterio temporal y los módulos exactos que quieres borrar.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <Label className="text-foreground/80">Modo de filtro</Label>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <button
                                        type="button"
                                        className={cn(
                                            "rounded-xl border px-4 py-4 text-left transition-colors",
                                            mode === "date_range"
                                                ? "border-gold/40 bg-gold/10"
                                                : "border-border/50 bg-secondary/20 hover:bg-secondary/30"
                                        )}
                                        onClick={() => {
                                            setMode("date_range");
                                            setPreview(null);
                                        }}
                                    >
                                        <p className="text-sm font-semibold text-foreground">Rango manual</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Borra por fecha inicial y final definidas manualmente.</p>
                                    </button>
                                    <button
                                        type="button"
                                        className={cn(
                                            "rounded-xl border px-4 py-4 text-left transition-colors",
                                            mode === "period"
                                                ? "border-gold/40 bg-gold/10"
                                                : "border-border/50 bg-secondary/20 hover:bg-secondary/30"
                                        )}
                                        onClick={() => {
                                            setMode("period");
                                            setPreview(null);
                                        }}
                                    >
                                        <p className="text-sm font-semibold text-foreground">Cierre / período</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Usa un período de liquidación como alcance para la depuración.</p>
                                    </button>
                                </div>
                            </div>

                            {mode === "date_range" ? (
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label className="text-foreground/80">Fecha inicial</Label>
                                        <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-secondary/50 border-border/50" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-foreground/80">Fecha final</Label>
                                        <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="bg-secondary/50 border-border/50" />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label className="text-foreground/80">Período o cierre</Label>
                                    <Select value={selectedPeriodId} onValueChange={(value) => { setSelectedPeriodId(value); setPreview(null); }}>
                                        <SelectTrigger className="bg-secondary/50 border-border/50">
                                            <SelectValue placeholder="Selecciona un período" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-card border-border">
                                            {periods.map((period) => (
                                                <SelectItem key={period.id} value={period.id}>
                                                    {getPeriodLabel(period)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <Separator className="bg-border/50" />

                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <Label className="text-foreground/80">Bloques a eliminar</Label>
                                    <div className="flex items-center gap-2">
                                        <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/30" onClick={() => {
                                            setModuleState(cleanupModuleConfig.reduce<Record<CleanupModule, boolean>>((acc, item) => {
                                                acc[item.id] = true;
                                                return acc;
                                            }, {} as Record<CleanupModule, boolean>));
                                            setPreview(null);
                                        }}>
                                            Marcar todo
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {
                                            setModuleState(cleanupModuleConfig.reduce<Record<CleanupModule, boolean>>((acc, item) => {
                                                acc[item.id] = false;
                                                return acc;
                                            }, {} as Record<CleanupModule, boolean>));
                                            setPreview(null);
                                        }}>
                                            Limpiar selección
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    {cleanupModuleConfig.map((module) => (
                                        <label key={module.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-secondary/20 px-4 py-4 hover:bg-secondary/30">
                                            <Checkbox
                                                checked={moduleState[module.id]}
                                                onCheckedChange={(checked) => handleToggleModule(module.id, checked === true)}
                                                className="mt-1"
                                            />
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium text-foreground">{module.title}</p>
                                                <p className="text-xs text-muted-foreground">{module.description}</p>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/50 bg-card/80">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-foreground">
                                <CalendarRange className="h-5 w-5 text-cyan-400" />
                                Reglas de ejecución
                            </CardTitle>
                            <CardDescription className="text-muted-foreground">
                                Ajusta cómo se comporta el borrado y revisa las advertencias antes de ejecutarlo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <label className="flex items-start gap-3 rounded-xl border border-border/50 bg-secondary/20 px-4 py-4">
                                <Checkbox checked={deleteFiles} onCheckedChange={(checked) => { setDeleteFiles(checked === true); setPreview(null); }} className="mt-1" />
                                <div>
                                    <p className="text-sm font-medium text-foreground">Eliminar archivos tipo documentos, imágenes y demás</p>
                                    <p className="text-xs text-muted-foreground">Aplica a mantenimientos, reportes técnicos, visitas y recorridos cuando existan archivos asociados en storage.</p>
                                </div>
                            </label>

                            <label className="flex items-start gap-3 rounded-xl border border-border/50 bg-secondary/20 px-4 py-4">
                                <Checkbox checked={deletePeriods} onCheckedChange={(checked) => { setDeletePeriods(checked === true); setPreview(null); }} className="mt-1" />
                                <div>
                                    <p className="text-sm font-medium text-foreground">Eliminar también cierres/períodos afectados</p>
                                    <p className="text-xs text-muted-foreground">Solo úsalo si quieres borrar además los períodos de liquidación que queden dentro del filtro seleccionado.</p>
                                </div>
                            </label>

                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                                <p className="text-sm font-medium text-foreground">Confirmación obligatoria</p>
                                <p className="mt-1 text-xs text-muted-foreground">Después del análisis escribe ELIMINAR para habilitar la ejecución final.</p>
                                <Input
                                    value={confirmationText}
                                    onChange={(event) => setConfirmationText(event.target.value)}
                                    placeholder="Escribe ELIMINAR"
                                    className="mt-3 bg-secondary/50 border-border/50"
                                />
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row">
                                <Button type="button" className="gap-2 bg-gold hover:bg-gold/90 text-black" onClick={handlePreview} disabled={previewing || !canRun}>
                                    {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                                    {previewing ? "Analizando..." : "Analizar depuración"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    className="gap-2"
                                    onClick={handleExecute}
                                    disabled={executing || !preview || confirmationText.trim().toUpperCase() !== "ELIMINAR"}
                                >
                                    {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                    {executing ? "Eliminando..." : "Ejecutar eliminación"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {preview && (
                    <Card className="border-border/50 bg-card/80">
                        <CardHeader>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                    <CardTitle className="text-foreground">Resumen del análisis</CardTitle>
                                    <CardDescription className="text-muted-foreground">
                                        Ventana efectiva: {preview.range.startDate} al {preview.range.endDate}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
                                        {preview.items.reduce((sum, item) => sum + item.primaryCount + item.relatedCount, 0)} registros detectados
                                    </Badge>
                                    <Badge variant="outline" className="border-border/50 bg-secondary/30 text-foreground/80">
                                        {preview.matchedPeriods.length} períodos afectados
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            {preview.warnings.length > 0 && (
                                <Alert className="border-amber-500/20 bg-amber-500/10 text-amber-50">
                                    <ShieldAlert className="h-4 w-4 text-amber-400" />
                                    <AlertTitle className="text-amber-100">Advertencias</AlertTitle>
                                    <AlertDescription className="text-amber-50/90">
                                        {preview.warnings.map((warning) => (
                                            <p key={warning}>{warning}</p>
                                        ))}
                                    </AlertDescription>
                                </Alert>
                            )}

                            {preview.matchedPeriods.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-foreground">Cierres relacionados</p>
                                    <div className="flex flex-wrap gap-2">
                                        {preview.matchedPeriods.map((period) => (
                                            <Badge key={period.id} variant="outline" className="border-border/50 bg-secondary/30 text-foreground/80">
                                                {getPeriodLabel(period)}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                {preview.items.map((item) => (
                                    <div key={item.module} className="rounded-xl border border-border/50 bg-secondary/20 p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                                                <p className="text-xs text-muted-foreground">Principal: {item.primaryCount} · Relacionado: {item.relatedCount}</p>
                                            </div>
                                            <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
                                                {item.primaryCount + item.relatedCount}
                                            </Badge>
                                        </div>
                                        <div className="space-y-1">
                                            {item.details.map((detail) => (
                                                <p key={detail} className="text-xs text-foreground/80">{detail}</p>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}