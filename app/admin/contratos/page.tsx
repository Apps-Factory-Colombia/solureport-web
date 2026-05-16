"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Download, FileText, DollarSign, CalendarDays, Building2, Plus, CheckCircle2, Clock, TrendingUp, DoorOpen, Car, Pencil, Trash2, AlertTriangle, ArrowRight, } from "lucide-react";
import { MaintenanceContract, Client } from "@/lib/types";
import { getContratos, createContrato, updateContrato, deleteContrato, updateMantenimientoContrato } from "@/lib/supabase/services/contratos";
import { getClientes, updateCliente } from "@/lib/supabase/services/clientes";
import { cn } from "@/lib/utils";
import { generateTablePDF } from "@/lib/utils/pdf-generator";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function ContratosPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<MaintenanceContract[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedContract, setSelectedContract] = useState<MaintenanceContract | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportType, setExportType] = useState<"mensual" | "anual">("mensual");
  const [exportFechaInicio, setExportFechaInicio] = useState("");
  const [exportFechaFin, setExportFechaFin] = useState("");
  const [exportClienteId, setExportClienteId] = useState<string>("todos");
  const [exportMes, setExportMes] = useState<string>(String(new Date().getMonth() + 1));
  const [createOpen, setCreateOpen] = useState(false);
  const [newClienteId, setNewClienteId] = useState("");
  const [newAnio, setNewAnio] = useState(String(new Date().getFullYear()));
  const [newMesInicio, setNewMesInicio] = useState("1");
  const [newDiaInicio, setNewDiaInicio] = useState("1");
  const [newCostoTotal, setNewCostoTotal] = useState("");
  const [newCantidad, setNewCantidad] = useState("3");
  const [creating, setCreating] = useState(false);
  const [createdContractInfo, setCreatedContractInfo] = useState<{ cliente: string; cantidad: number } | null>(null);

  // Estados para edición del contrato general en el modal unificado
  const [editClienteId, setEditClienteId] = useState("");
  const [editAnio, setEditAnio] = useState("");
  const [editMesInicio, setEditMesInicio] = useState("1");
  const [editDiaInicio, setEditDiaInicio] = useState("1");
  const [editCostoTotal, setEditCostoTotal] = useState("");
  const [editCantidad, setEditCantidad] = useState("3");
  const [editEstado, setEditEstado] = useState<"activo" | "cerrado">("activo");
  const [editPuertasPeatonales, setEditPuertasPeatonales] = useState("0");
  const [editPuertasVehiculares, setEditPuertasVehiculares] = useState("0");
  const [editRegenerarMants, setEditRegenerarMants] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteContract, setDeleteContract] = useState<MaintenanceContract | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edición inline de mantenimientos en el detalle
  const [editingMantId, setEditingMantId] = useState<string | null>(null);
  const [mantEditEstado, setMantEditEstado] = useState<"pendiente" | "programado" | "realizado">("pendiente");
  const [mantEditFechaProg, setMantEditFechaProg] = useState("");
  const [mantEditFechaReal, setMantEditFechaReal] = useState("");
  const [mantEditValor, setMantEditValor] = useState("");
  const [savingMant, setSavingMant] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ct, cl] = await Promise.all([getContratos(), getClientes()]);
      setContracts(ct);
      setClients(cl);
    } catch (err) {
      console.error("Error cargando contratos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const costoPorMant = newCostoTotal && newCantidad
    ? Math.round(Number(newCostoTotal) / Number(newCantidad))
    : 0;

  const buildMantenimientos = (cantidad: number, anio: number, mesInicio: number, dia: number) => {
    const intervalo = Math.floor(12 / cantidad);
    return Array.from({ length: cantidad }, (_, i) => {
      const mesNum = ((mesInicio - 1 + i * intervalo) % 12) + 1;
      const anioMant = anio + Math.floor((mesInicio - 1 + i * intervalo) / 12);
      const diaStr = String(Math.min(dia, 28)).padStart(2, "0");
      const mesStr = String(mesNum).padStart(2, "0");
      return {
        id: `temp-${i}`,
        mes: mesNum,
        fechaProgramada: `${anioMant}-${mesStr}-${diaStr}`,
        estado: "pendiente" as const,
        valorRecaudado: 0,
      };
    });
  };

  const handleCreateContract = async () => {
    if (!newClienteId || !newCostoTotal || !newCantidad) return;
    setCreating(true);
    try {
      const anio = Number(newAnio);
      const cantidad = Number(newCantidad);
      const costoTotal = Number(newCostoTotal);
      const mesInicio = Number(newMesInicio);
      const diaInicio = Number(newDiaInicio);
      const costoPorMantenimiento = Math.round(costoTotal / cantidad);
      const mantenimientos = buildMantenimientos(cantidad, anio, mesInicio, diaInicio);

      const createdContract = await createContrato({
        clienteId: newClienteId,
        anio,
        mesInicio,
        diaInicio,
        costoTotalAnual: costoTotal,
        cantidadMantenimientos: cantidad,
        costoPorMantenimiento,
        mantenimientosRealizados: mantenimientos,
        estado: "activo",
      });

      const selectedClient = clients.find((client) => client.id === newClienteId);

      setCreateOpen(false);
      setNewClienteId("");
      setNewCostoTotal("");
      setNewCantidad("3");
      setNewMesInicio("1");
      setNewDiaInicio("1");
      setCreatedContractInfo({
        cliente: selectedClient?.edificio || selectedClient?.nombre || "el cliente seleccionado",
        cantidad: createdContract.mantenimientosRealizados.length,
      });
      await loadData();
    } catch (err) {
      console.error("Error creando contrato:", err);
    } finally {
      setCreating(false);
    }
  };

  const openUnifiedModal = (ct: MaintenanceContract) => {
    const client = clients.find((item) => item.id === ct.clienteId);
    setSelectedContract(ct);
    setEditClienteId(ct.clienteId);
    setEditAnio(String(ct.anio));
    setEditMesInicio(String(ct.mesInicio || 1));
    setEditDiaInicio(String(ct.diaInicio || 1));
    setEditCostoTotal(String(ct.costoTotalAnual));
    setEditCantidad(String(ct.cantidadMantenimientos));
    setEditEstado(ct.estado);
    setEditPuertasPeatonales(String(client?.puertasPeatonales ?? 0));
    setEditPuertasVehiculares(String(client?.puertasVehiculares ?? 0));
    setEditRegenerarMants(false);
    setDetailOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedContract || !editClienteId || !editCostoTotal) return;
    setSaving(true);
    try {
      const cantidad = Number(editCantidad);
      const costoTotal = Number(editCostoTotal);
      await updateCliente(editClienteId, {
        puertasPeatonales: Number(editPuertasPeatonales) || 0,
        puertasVehiculares: Number(editPuertasVehiculares) || 0,
      });

      const updated = await updateContrato(selectedContract.id, {
        clienteId: editClienteId,
        anio: Number(editAnio),
        mesInicio: Number(editMesInicio),
        diaInicio: Number(editDiaInicio),
        costoTotalAnual: costoTotal,
        cantidadMantenimientos: cantidad,
        costoPorMantenimiento: Math.round(costoTotal / cantidad),
        estado: editEstado,
        regenerarMantenimientos: editRegenerarMants,
      });
      setSelectedContract(updated);
      await loadData();
    } catch (err) {
      console.error("Error editando contrato:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenMantEdit = (m: MaintenanceContract["mantenimientosRealizados"][0]) => {
    setEditingMantId(m.id);
    setMantEditEstado(m.estado);
    setMantEditFechaProg(m.fechaProgramada);
    setMantEditFechaReal(m.fechaRealizado || "");
    setMantEditValor(String(m.valorRecaudado));
  };

  const handleSaveMant = async (mantId: string) => {
    setSavingMant(true);
    try {
      const updated = await updateMantenimientoContrato(mantId, {
        estado: mantEditEstado,
        fechaProgramada: mantEditFechaProg,
        fechaRealizado: mantEditFechaReal || undefined,
        valorRecaudado: Number(mantEditValor) || 0,
      });
      // Actualizar selectedContract en memoria sin recargar todo
      setSelectedContract((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          mantenimientosRealizados: prev.mantenimientosRealizados.map((m) =>
            m.id === mantId ? updated : m
          ),
        };
      });
      // Sincronizar en la lista principal
      setContracts((prev) =>
        prev.map((ct) => {
          if (!ct.mantenimientosRealizados.some((m) => m.id === mantId)) return ct;
          return {
            ...ct,
            mantenimientosRealizados: ct.mantenimientosRealizados.map((m) =>
              m.id === mantId ? updated : m
            ),
          };
        })
      );
      setEditingMantId(null);
    } catch (err) {
      console.error("Error guardando mantenimiento:", err);
    } finally {
      setSavingMant(false);
    }
  };

  const handleExportInformeMensual = (contract: MaintenanceContract, mes: number) => {
    const client = clients.find((c) => c.id === contract.clienteId);
    const mantsDelMes = contract.mantenimientosRealizados.filter((m) => m.mes === mes);
    const totalMes = mantsDelMes.reduce((s, m) => s + m.valorRecaudado, 0);
    const totalAcumulado = contract.mantenimientosRealizados
      .filter((m) => m.mes <= mes)
      .reduce((s, m) => s + m.valorRecaudado, 0);

    const rows = mantsDelMes.length > 0
      ? mantsDelMes.map((m) => [
        monthNames[m.mes - 1],
        m.fechaProgramada,
        m.fechaRealizado || "No registrada",
        m.estado.charAt(0).toUpperCase() + m.estado.slice(1),
        formatCurrency(m.valorRecaudado),
      ])
      : [["", "", "Sin mantenimientos en este mes", "", ""]];

    generateTablePDF({
      titulo: `INFORME MENSUAL - ${monthNames[mes - 1].toUpperCase()} ${contract.anio}`,
      subtitulo: `Contrato de Mantenimiento Preventivo · ${client?.edificio || client?.nombre || ""}`,
      empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
      periodo: `${monthNames[mes - 1]} de ${contract.anio}`,
      summary: [
        { label: "Valor Total Anual Contrato", value: formatCurrency(contract.costoTotalAnual) },
        { label: `Total Recaudado ${monthNames[mes - 1]}`, value: formatCurrency(totalMes) },
        { label: "Acumulado a la fecha", value: formatCurrency(totalAcumulado) },
      ],
      headers: ["Mes", "Fecha Programada", "Fecha Realizado", "Estado", "Valor"],
      rows,
      totales: mantsDelMes.length > 0 ? ["", "", "", "Total del mes", formatCurrency(totalMes)] : undefined,
      fileName: `informe_mensual_${(client?.edificio || "cliente").replace(/\s+/g, "_")}_${monthNames[mes - 1].toLowerCase()}_${contract.anio}`,
    });
  };

  const handleExportCierreAnual = (contract: MaintenanceContract) => {
    const client = clients.find((c) => c.id === contract.clienteId);
    const totalRecaudado = contract.mantenimientosRealizados.reduce((s, m) => s + m.valorRecaudado, 0);
    const rows: string[][] = [];
    let currentMes = 0;
    let mesTotal = 0;

    contract.mantenimientosRealizados.forEach((m, i) => {
      if (m.mes !== currentMes && currentMes > 0) {
        rows.push(["", "", "", `Cierre ${monthNames[currentMes - 1]}`, formatCurrency(mesTotal)]);
        mesTotal = 0;
      }
      currentMes = m.mes;
      mesTotal += m.valorRecaudado;
      rows.push([
        monthNames[m.mes - 1],
        m.fechaProgramada,
        m.fechaRealizado || "—",
        m.estado.charAt(0).toUpperCase() + m.estado.slice(1),
        formatCurrency(m.valorRecaudado),
      ]);
      if (i === contract.mantenimientosRealizados.length - 1) {
        rows.push(["", "", "", `Cierre ${monthNames[currentMes - 1]}`, formatCurrency(mesTotal)]);
        rows.push(["", "", "", "Valor Total Anual Contrato", formatCurrency(contract.costoTotalAnual)]);
      }
    });

    generateTablePDF({
      titulo: `CIERRE ANUAL ${contract.anio}`,
      subtitulo: `Mantenimiento Preventivo · ${client?.edificio || client?.nombre || ""}`,
      empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
      periodo: `Año ${contract.anio}`,
      summary: [
        { label: "Valor Total Anual Contrato", value: formatCurrency(contract.costoTotalAnual) },
        { label: "Total Recaudado", value: formatCurrency(totalRecaudado) },
        { label: "Saldo Pendiente", value: formatCurrency(contract.costoTotalAnual - totalRecaudado) },
      ],
      headers: ["Mes", "Fecha Programada", "Fecha Realizado", "Estado", "Valor"],
      rows,
      totales: ["", "", "", "Total Anual", formatCurrency(totalRecaudado)],
      fileName: `cierre_anual_${(client?.edificio || "cliente").replace(/\s+/g, "_")}_${contract.anio}`,
    });
  };

  const handleDeleteContract = async () => {
    if (!deleteContract) return;
    setDeleting(true);
    try {
      await deleteContrato(deleteContract.id);
      setDeleteOpen(false);
      setDeleteContract(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando contrato:", err);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = contracts.filter((ct) => {
    const client = clients.find((c) => c.id === ct.clienteId);
    return (
      client?.edificio.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase())
    );
  });

  const totalAnual = contracts.reduce((sum, ct) => sum + ct.costoTotalAnual, 0);
  const totalRecaudado = contracts.reduce(
    (sum, ct) =>
      sum + ct.mantenimientosRealizados.reduce((s, m) => s + m.valorRecaudado, 0),
    0
  );
  const totalMantenimientos = contracts.reduce(
    (sum, ct) => sum + ct.cantidadMantenimientos,
    0
  );
  const realizados = contracts.reduce(
    (sum, ct) =>
      sum + ct.mantenimientosRealizados.filter((m) => m.estado === "realizado").length,
    0
  );

  const resumenMensual = useMemo(() => {
    const meses: Record<number, { recaudado: number; programados: number; realizados: number }> = {};
    for (let i = 1; i <= 12; i++) {
      meses[i] = { recaudado: 0, programados: 0, realizados: 0 };
    }
    contracts.forEach((ct) => {
      ct.mantenimientosRealizados.forEach((m) => {
        meses[m.mes].programados += 1;
        meses[m.mes].recaudado += m.valorRecaudado;
        if (m.estado === "realizado") meses[m.mes].realizados += 1;
      });
    });
    return meses;
  }, [contracts]);

  const handleExport = () => {
    const filteredMaintenance: Array<{
      contrato: MaintenanceContract;
      mantenimiento: MaintenanceContract["mantenimientosRealizados"][0];
    }> = [];

    contracts.forEach((ct) => {
      if (exportClienteId !== "todos" && ct.clienteId !== exportClienteId) return;
      ct.mantenimientosRealizados.forEach((m) => {
        const fechaM = m.fechaProgramada;
        if (exportFechaInicio && fechaM < exportFechaInicio) return;
        if (exportFechaFin && fechaM > exportFechaFin) return;
        filteredMaintenance.push({ contrato: ct, mantenimiento: m });
      });
    });

    const totalValorFiltrado = filteredMaintenance.reduce((s, fm) => s + fm.mantenimiento.valorRecaudado, 0);
    const uniqueContractIds = [...new Set(filteredMaintenance.map((fm) => fm.contrato.id))];
    const totalAnualContratos = uniqueContractIds.reduce((s, id) => {
      const ct = contracts.find((c) => c.id === id);
      return s + (ct?.costoTotalAnual || 0);
    }, 0);

    const rows: string[][] = [];

    if (exportType === "mensual") {
      const byMonth: Record<string, typeof filteredMaintenance> = {};
      filteredMaintenance.forEach((fm) => {
        const monthKey = fm.mantenimiento.fechaProgramada.slice(0, 7);
        if (!byMonth[monthKey]) byMonth[monthKey] = [];
        byMonth[monthKey].push(fm);
      });

      Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).forEach(([monthKey, items]) => {
        items.forEach(({ contrato, mantenimiento }) => {
          const client = clients.find((c) => c.id === contrato.clienteId);
          rows.push([
            client?.nombre || "—",
            client?.edificio || "—",
            mantenimiento.fechaProgramada,
            mantenimiento.estado,
            formatCurrency(mantenimiento.valorRecaudado),
            formatCurrency(contrato.costoTotalAnual),
          ]);
        });
        const monthTotal = items.reduce((s, fm) => s + fm.mantenimiento.valorRecaudado, 0);
        const [year, month] = monthKey.split("-");
        rows.push(["", "", `Cierre ${monthNames[Number(month) - 1]} ${year}`, "", formatCurrency(monthTotal), ""]);
      });
    } else {
      filteredMaintenance.forEach(({ contrato, mantenimiento }) => {
        const client = clients.find((c) => c.id === contrato.clienteId);
        rows.push([
          client?.nombre || "—",
          client?.edificio || "—",
          mantenimiento.fechaProgramada,
          mantenimiento.estado,
          formatCurrency(mantenimiento.valorRecaudado),
          formatCurrency(contrato.costoTotalAnual),
        ]);
      });
      rows.push(["", "", "", "Valor Total Anual Contratos", "", formatCurrency(totalAnualContratos)]);
    }

    const clientLabel = exportClienteId === "todos"
      ? "Todos los clientes"
      : (clients.find((c) => c.id === exportClienteId)?.edificio || "Cliente seleccionado");

    generateTablePDF({
      titulo: `REPORTE DE CONTRATOS - ${exportType === "mensual" ? "Cierre Mensual" : "Cierre Anual"}`,
      empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
      periodo: `${exportFechaInicio || "Inicio"} a ${exportFechaFin || "Fin"} · ${clientLabel}`,
      summary: [
        { label: "Mantenimientos", value: String(filteredMaintenance.length) },
        { label: "Total recaudado", value: formatCurrency(totalValorFiltrado) },
        { label: "Valor anual contratos", value: formatCurrency(totalAnualContratos) },
      ],
      headers: ["Cliente", "Edificio", "Fecha", "Estado", "Valor", "Valor Anual"],
      rows,
      totales: ["TOTAL", "", `${filteredMaintenance.length} registros`, "", formatCurrency(totalValorFiltrado), formatCurrency(totalAnualContratos)],
    });
    setExportOpen(false);
  };

  return (
    <div>
      <AdminHeader title="Contratos de Mantenimiento Preventivo" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <DollarSign className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">{formatCurrency(totalAnual)}</p>
                <p className="text-xs text-muted-foreground">Valor Total Anual</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-emerald-400">{formatCurrency(totalRecaudado)}</p>
                <p className="text-xs text-muted-foreground">Recaudado a la Fecha</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                <CalendarDays className="h-5 w-5 text-cyan-neon" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{totalMantenimientos}</p>
                <p className="text-xs text-muted-foreground">Mantenimientos Programados</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{realizados} / {totalMantenimientos}</p>
                <p className="text-xs text-muted-foreground">Realizados</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setExportOpen(true)}
              variant="outline"
              className="gap-2 border-border/50 text-foreground/80"
            >
              <Download className="h-4 w-4" />
              Exportar PDF
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Plus className="h-4 w-4" />
              Nuevo Contrato
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-neon/20 bg-cyan-neon/5 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-cyan-neon/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-cyan-neon" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                El contrato ya genera sus mantenimientos automáticamente
              </p>
              <p className="text-sm text-muted-foreground">
                Al crear un contrato se crean de una vez los mantenimientos programados según la cantidad, mes y día de inicio. No necesitas crearlos por separado en la vista de mantenimientos.
              </p>
              <button
                type="button"
                onClick={() => router.push("/admin/mantenimientos")}
                className="inline-flex items-center gap-1 text-sm font-medium text-cyan-neon hover:underline"
              >
                Ir a programación de mantenimientos
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <Tabs defaultValue="contratos" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="contratos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <FileText className="h-4 w-4 mr-2" />
              Contratos
            </TabsTrigger>
            <TabsTrigger
              value="mensual"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Cierre Mensual
            </TabsTrigger>
            <TabsTrigger
              value="anual"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Cierre Anual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contratos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Puertas</TableHead>
                      <TableHead className="text-muted-foreground">Año / Inicio</TableHead>
                      <TableHead className="text-muted-foreground">Costo Anual</TableHead>
                      <TableHead className="text-muted-foreground">Costo/Mant.</TableHead>
                      <TableHead className="text-muted-foreground">Avance</TableHead>
                      <TableHead className="text-muted-foreground">Recaudado</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((ct) => {
                      const client = clients.find((c) => c.id === ct.clienteId);
                      const done = ct.mantenimientosRealizados.filter(
                        (m) => m.estado === "realizado"
                      ).length;
                      const recaudado = ct.mantenimientosRealizados.reduce(
                        (s, m) => s + m.valorRecaudado,
                        0
                      );

                      return (
                        <TableRow
                          key={ct.id}
                          className="border-border/50 hover:bg-secondary/30 cursor-pointer"
                          onClick={() => openUnifiedModal(ct)}
                          data-no-detail="false"
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-neon/10">
                                <Building2 className="h-4 w-4 text-cyan-neon" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{client?.edificio}</p>
                                <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="flex items-center gap-1 text-foreground/80">
                                <DoorOpen className="h-3.5 w-3.5 text-cyan-neon" />
                                {client?.puertasPeatonales}
                              </span>
                              <span className="flex items-center gap-1 text-foreground/80">
                                <Car className="h-3.5 w-3.5 text-gold" />
                                {client?.puertasVehiculares}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            <span className="font-medium">{ct.anio}</span>
                            <span className="text-xs text-muted-foreground ml-1">desde {monthNames[(ct.mesInicio || 1) - 1]}</span>
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-gold">
                            {formatCurrency(ct.costoTotalAnual)}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {formatCurrency(ct.costoPorMantenimiento)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden max-w-20">
                                <div
                                  className="h-full bg-gold rounded-full transition-all"
                                  style={{
                                    width: `${(done / ct.cantidadMantenimientos) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {done}/{ct.cantidadMantenimientos}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-emerald-400">
                            {formatCurrency(recaudado)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                ct.estado === "activo"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-muted text-muted-foreground border-border/50"
                              )}
                            >
                              {ct.estado === "activo" ? "Activo" : "Cerrado"}
                            </Badge>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-gold hover:bg-gold/10"
                                onClick={() => openUnifiedModal(ct)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-red-400"
                                onClick={() => { setDeleteContract(ct); setDeleteOpen(true); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
          </TabsContent>

          <TabsContent value="mensual">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground">
                  Recaudación Mes a Mes - {new Date().getFullYear()}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Mes</TableHead>
                      <TableHead className="text-muted-foreground">Programados</TableHead>
                      <TableHead className="text-muted-foreground">Realizados</TableHead>
                      <TableHead className="text-muted-foreground text-right">Recaudado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(resumenMensual).map(([mes, data]) => (
                      <TableRow key={mes} className="border-border/50 hover:bg-secondary/30">
                        <TableCell className="font-medium text-foreground">
                          {monthNames[Number(mes) - 1]}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs"
                          >
                            {data.programados}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              data.realizados > 0
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-secondary text-muted-foreground border-border/50"
                            )}
                          >
                            {data.realizados}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-gold">
                          {data.recaudado > 0 ? formatCurrency(data.recaudado) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-border/50 bg-gold/5">
                      <TableCell className="font-bold text-foreground">Total Anual</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs font-bold">
                          {Object.values(resumenMensual).reduce((s, d) => s + d.programados, 0)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs font-bold">
                          {Object.values(resumenMensual).reduce((s, d) => s + d.realizados, 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-bold text-gold text-lg">
                        {formatCurrency(Object.values(resumenMensual).reduce((s, d) => s + d.recaudado, 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="anual">
            <div className="space-y-4">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground">
                    Cierre Anual - Resumen por Cliente
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Cliente</TableHead>
                        <TableHead className="text-muted-foreground">P. Peatonales</TableHead>
                        <TableHead className="text-muted-foreground">P. Vehiculares</TableHead>
                        <TableHead className="text-muted-foreground">Costo Anual</TableHead>
                        <TableHead className="text-muted-foreground">Recaudado</TableHead>
                        <TableHead className="text-muted-foreground">Pendiente</TableHead>
                        <TableHead className="text-muted-foreground">Progreso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contracts.map((ct) => {
                        const client = clients.find((c) => c.id === ct.clienteId);
                        const recaudado = ct.mantenimientosRealizados.reduce(
                          (s, m) => s + m.valorRecaudado,
                          0
                        );
                        const pendiente = ct.costoTotalAnual - recaudado;
                        const pct = Math.round((recaudado / ct.costoTotalAnual) * 100);

                        return (
                          <TableRow key={ct.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell>
                              <p className="font-medium text-foreground">{client?.edificio}</p>
                              <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80 text-center">
                              {client?.puertasPeatonales}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80 text-center">
                              {client?.puertasVehiculares}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-gold">
                              {formatCurrency(ct.costoTotalAnual)}
                            </TableCell>
                            <TableCell className="text-sm font-semibold text-emerald-400">
                              {formatCurrency(recaudado)}
                            </TableCell>
                            <TableCell className="text-sm text-amber-400">
                              {formatCurrency(pendiente)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden max-w-24">
                                  <div
                                    className="h-full bg-gold rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium text-gold">{pct}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="border-border/50 bg-gold/5">
                        <TableCell className="font-bold text-foreground">Totales</TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="font-bold text-gold">
                          {formatCurrency(totalAnual)}
                        </TableCell>
                        <TableCell className="font-bold text-emerald-400">
                          {formatCurrency(totalRecaudado)}
                        </TableCell>
                        <TableCell className="font-bold text-amber-400">
                          {formatCurrency(totalAnual - totalRecaudado)}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-bold text-gold">
                            {Math.round((totalRecaudado / totalAnual) * 100)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-foreground text-xl">Gestión de Contrato</DialogTitle>
          </DialogHeader>

          {selectedContract && (() => {
            const client = clients.find((c) => c.id === selectedContract.clienteId);
            const recaudado = selectedContract.mantenimientosRealizados.reduce(
              (s, m) => s + m.valorRecaudado,
              0
            );

            return (
              <Tabs defaultValue="detalle" className="w-full">
                <div className="px-6 border-b border-border/50">
                  <TabsList className="bg-transparent p-0 h-auto space-x-6">
                    <TabsTrigger
                      value="detalle"
                      className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none px-0 pb-3 pt-2 text-muted-foreground data-[state=active]:text-gold font-semibold"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Detalle y Avance
                    </TabsTrigger>
                    <TabsTrigger
                      value="configuracion"
                      className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none px-0 pb-3 pt-2 text-muted-foreground data-[state=active]:text-gold font-semibold"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Configuración
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="detalle" className="p-6 m-0 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Cliente</p>
                      <p className="text-sm font-medium text-foreground">{client?.nombre}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Edificio</p>
                      <p className="text-sm font-medium text-foreground">{client?.edificio}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Costo Total Anual</p>
                      <p className="text-lg font-bold text-gold">{formatCurrency(selectedContract.costoTotalAnual)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Costo por Mantenimiento</p>
                      <p className="text-lg font-bold text-foreground">{formatCurrency(selectedContract.costoPorMantenimiento)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Recaudado</span>
                      <span className="font-bold text-emerald-400">{formatCurrency(recaudado)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pendiente</span>
                      <span className="font-bold text-amber-400">{formatCurrency(selectedContract.costoTotalAnual - recaudado)}</span>
                    </div>
                    <div className="pt-1 space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Avance mantenimientos</span>
                        <span className="font-medium text-foreground">
                          {selectedContract.mantenimientosRealizados.filter((m) => m.estado === "realizado").length}
                          {" / "}
                          {selectedContract.cantidadMantenimientos}
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gold rounded-full transition-all"
                          style={{
                            width: `${(selectedContract.mantenimientosRealizados.filter((m) => m.estado === "realizado").length / selectedContract.cantidadMantenimientos) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{
                            width: `${selectedContract.costoTotalAnual > 0 ? (recaudado / selectedContract.costoTotalAnual) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Recaudación financiera</span>
                        <span className="font-medium text-emerald-400">
                          {selectedContract.costoTotalAnual > 0
                            ? Math.round((recaudado / selectedContract.costoTotalAnual) * 100)
                            : 0}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">Mantenimientos del Contrato</h4>
                    <div className="space-y-2">
                      {selectedContract.mantenimientosRealizados.map((m) => {
                        const isEditing = editingMantId === m.id;
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "rounded-lg border p-3 transition-colors",
                              isEditing
                                ? "border-gold/40 bg-gold/5 shadow-sm"
                                : "border-border/50 bg-secondary/20 hover:bg-secondary/40"
                            )}
                          >
                            {isEditing ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-gold">{monthNames[m.mes - 1]}</span>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs text-muted-foreground"
                                      onClick={() => setEditingMantId(null)}
                                      disabled={savingMant}
                                    >
                                      Cancelar
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs bg-gold hover:bg-gold-dark text-background font-semibold"
                                      onClick={() => handleSaveMant(m.id)}
                                      disabled={savingMant}
                                    >
                                      {savingMant ? (
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-background border-t-transparent mr-1" />
                                      ) : null}
                                      Guardar
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Estado</label>
                                    <Select
                                      value={mantEditEstado}
                                      onValueChange={(v: "pendiente" | "programado" | "realizado") => setMantEditEstado(v)}
                                    >
                                      <SelectTrigger className="h-8 bg-secondary/50 border-border/50 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-card border-border">
                                        <SelectItem value="pendiente">Pendiente</SelectItem>
                                        <SelectItem value="programado">Programado</SelectItem>
                                        <SelectItem value="realizado">Realizado</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Valor recaudado ($)</label>
                                    <Input
                                      type="number"
                                      min="0"
                                      value={mantEditValor}
                                      onChange={(e) => setMantEditValor(e.target.value)}
                                      className="h-8 bg-secondary/50 border-border/50 text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Fecha programada</label>
                                    <Input
                                      type="date"
                                      value={mantEditFechaProg}
                                      onChange={(e) => setMantEditFechaProg(e.target.value)}
                                      className="h-8 bg-secondary/50 border-border/50 text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Fecha realizado</label>
                                    <Input
                                      type="date"
                                      value={mantEditFechaReal}
                                      onChange={(e) => setMantEditFechaReal(e.target.value)}
                                      className="h-8 bg-secondary/50 border-border/50 text-xs"
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-semibold text-foreground w-24">{monthNames[m.mes - 1]}</span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs",
                                      m.estado === "realizado"
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        : m.estado === "programado"
                                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    )}
                                  >
                                    {m.estado.charAt(0).toUpperCase() + m.estado.slice(1)}
                                  </Badge>
                                  <div className="text-xs text-muted-foreground flex flex-col sm:flex-row sm:gap-3">
                                    <span>Prog: {m.fechaProgramada}</span>
                                    {m.fechaRealizado && <span className="text-emerald-400">Real: {m.fechaRealizado}</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={cn("text-sm font-semibold", m.valorRecaudado > 0 ? "text-gold" : "text-muted-foreground")}>
                                    {m.valorRecaudado > 0 ? formatCurrency(m.valorRecaudado) : "—"}
                                  </span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:text-gold hover:bg-gold/10"
                                    onClick={() => handleOpenMantEdit(m)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-border/50">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Download className="h-4 w-4 text-gold" />
                      Exportar Informes para Cliente
                    </h4>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Mes</label>
                        <Select value={exportMes} onValueChange={setExportMes}>
                          <SelectTrigger className="w-40 bg-secondary/50 border-border/50 text-sm h-9">
                            <SelectValue placeholder="Seleccionar mes" />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {monthNames.map((m, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 h-9 border-gold/30 text-gold hover:bg-gold/10"
                        onClick={() => handleExportInformeMensual(selectedContract, Number(exportMes))}
                      >
                        <Download className="h-4 w-4" />
                        Informe Mensual
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 h-9 border-cyan-neon/30 text-cyan-neon hover:bg-cyan-neon/10"
                        onClick={() => handleExportCierreAnual(selectedContract)}
                      >
                        <Download className="h-4 w-4" />
                        Cierre Anual
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      El informe mensual incluye el valor total anual del contrato, los mantenimientos del mes seleccionado con fecha y valor, y el acumulado a la fecha.
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="configuracion" className="p-6 m-0 space-y-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Cliente</Label>
                      <Select value={editClienteId} onValueChange={setEditClienteId}>
                        <SelectTrigger className="bg-secondary/50 border-border/50">
                          <SelectValue placeholder="Seleccionar cliente" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {clients.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.edificio} — {c.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Año</Label>
                        <Input
                          type="number"
                          value={editAnio}
                          onChange={(e) => setEditAnio(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Cantidad Mantenimientos</Label>
                        <Input
                          type="number"
                          min="1"
                          max="12"
                          value={editCantidad}
                          onChange={(e) => setEditCantidad(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Mes de inicio</Label>
                        <Select value={editMesInicio} onValueChange={setEditMesInicio}>
                          <SelectTrigger className="bg-secondary/50 border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {monthNames.map((m, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Día del mes</Label>
                        <Input
                          type="number"
                          min="1"
                          max="28"
                          value={editDiaInicio}
                          onChange={(e) => setEditDiaInicio(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                          placeholder="1-28"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Costo Total Anual ($)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={editCostoTotal}
                          onChange={(e) => setEditCostoTotal(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Puertas Peatonales</Label>
                        <Input
                          type="number"
                          min="0"
                          value={editPuertasPeatonales}
                          onChange={(e) => setEditPuertasPeatonales(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Puertas Vehiculares</Label>
                        <Input
                          type="number"
                          min="0"
                          value={editPuertasVehiculares}
                          onChange={(e) => setEditPuertasVehiculares(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Estado</Label>
                        <Select value={editEstado} onValueChange={(v: "activo" | "cerrado") => setEditEstado(v)}>
                          <SelectTrigger className="bg-secondary/50 border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="activo">Activo</SelectItem>
                            <SelectItem value="cerrado">Cerrado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 mt-4">
                      <input
                        type="checkbox"
                        id="regenerar"
                        checked={editRegenerarMants}
                        onChange={(e) => setEditRegenerarMants(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-gold"
                      />
                      <div>
                        <label htmlFor="regenerar" className="text-sm font-medium text-foreground cursor-pointer">
                          Regenerar fechas programadas pendientes
                        </label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Recalculará las fechas de los mantenimientos en estado "pendiente" según la nueva configuración.
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-border/50 mt-6">
                      <Button
                        onClick={handleSaveEdit}
                        disabled={saving || !editClienteId || !editCostoTotal}
                        className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                      >
                        {saving ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {saving ? "Guardando..." : "Guardar Configuración"}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nuevo Contrato de Mantenimiento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Cliente</Label>
              <Select value={newClienteId} onValueChange={setNewClienteId}>
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {clients.filter((c) => c.estado === "activo").map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.edificio} — {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground/80">Año</Label>
                <Input
                  type="number"
                  value={newAnio}
                  onChange={(e) => setNewAnio(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Cantidad de Mantenimientos</Label>
                <Input
                  type="number"
                  min="1"
                  max="12"
                  value={newCantidad}
                  onChange={(e) => setNewCantidad(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground/80">Mes de inicio</Label>
                <Select value={newMesInicio} onValueChange={setNewMesInicio}>
                  <SelectTrigger className="bg-secondary/50 border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {monthNames.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Día del mes</Label>
                <Input
                  type="number"
                  min="1"
                  max="28"
                  value={newDiaInicio}
                  onChange={(e) => setNewDiaInicio(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                  placeholder="1-28"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Costo Total Anual ($)</Label>
              <Input
                type="number"
                min="0"
                value={newCostoTotal}
                onChange={(e) => setNewCostoTotal(e.target.value)}
                className="bg-secondary/50 border-border/50"
                placeholder="Ej: 12000000"
              />
            </div>
            {costoPorMant > 0 && (
              <div className="rounded-lg border border-gold/20 bg-gold/5 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Costo por mantenimiento:</span>
                  <span className="font-bold text-gold">{formatCurrency(costoPorMant)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {newCantidad} mantenimientos distribuidos cada {Math.floor(12 / Number(newCantidad))} mes(es) desde {monthNames[Number(newMesInicio) - 1]}, día {newDiaInicio}.
                </p>
              </div>
            )}
            <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-neon" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Este contrato generará automáticamente los mantenimientos
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cuando pulses <span className="font-medium text-foreground">Crear Contrato</span>, se crearán también los {newCantidad || "0"} mantenimientos asociados y luego podrás revisarlos desde <span className="font-medium text-foreground">Mantenimientos</span>.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateContract}
              disabled={creating || !newClienteId || !newCostoTotal}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {creating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {creating ? "Creando..." : "Crear Contrato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Exportar Reporte</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Tipo de Reporte</Label>
              <Select
                value={exportType}
                onValueChange={(v: "mensual" | "anual") => setExportType(v)}
              >
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="mensual">Cierre Mensual</SelectItem>
                  <SelectItem value="anual">Cierre Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Cliente (opcional)</Label>
              <Select value={exportClienteId} onValueChange={setExportClienteId}>
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue placeholder="Todos los clientes" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="todos">Todos los clientes</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.edificio || c.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground/80">Fecha Inicio</Label>
                <Input
                  type="date"
                  value={exportFechaInicio}
                  onChange={(e) => setExportFechaInicio(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Fecha Fin</Label>
                <Input
                  type="date"
                  value={exportFechaFin}
                  onChange={(e) => setExportFechaFin(e.target.value)}
                  className="bg-secondary/50 border-border/50"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              El PDF incluirá el valor total anual de cada contrato, los mantenimientos realizados en el rango de fechas con su valor individual, y los totales por cierre mensual y anual.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleExport}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Eliminar Contrato ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Eliminar Contrato
            </DialogTitle>
          </DialogHeader>
          {deleteContract && (() => {
            const client = clients.find((c) => c.id === deleteContract.clienteId);
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  ¿Estás seguro de que deseas eliminar el contrato de{" "}
                  <span className="font-semibold text-foreground">{client?.edificio || client?.nombre}</span>?
                  Esta acción eliminará también todos los mantenimientos asociados y no se puede deshacer.
                </p>
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Año:</span>
                    <span className="text-foreground font-medium">{deleteContract.anio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Costo anual:</span>
                    <span className="text-gold font-medium">{formatCurrency(deleteContract.costoTotalAnual)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mantenimientos:</span>
                    <span className="text-foreground font-medium">{deleteContract.cantidadMantenimientos}</span>
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDeleteContract}
              disabled={deleting}
              className="gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              {deleting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deleting ? "Eliminando..." : "Eliminar Contrato"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdContractInfo} onOpenChange={(open) => { if (!open) setCreatedContractInfo(null); }}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Contrato creado correctamente</DialogTitle>
          </DialogHeader>
          {createdContractInfo && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{createdContractInfo.cliente}</p>
                    <p className="text-sm text-muted-foreground">
                      Se generaron automáticamente <span className="font-medium text-foreground">{createdContractInfo.cantidad}</span> mantenimientos asociados a este contrato.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Puedes revisarlos o programarlos ahora mismo desde la vista de mantenimientos.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreatedContractInfo(null)}
              className="text-muted-foreground"
            >
              Seguir en contratos
            </Button>
            <Button
              onClick={() => {
                setCreatedContractInfo(null);
                router.push("/admin/mantenimientos");
              }}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              Ir a mantenimientos
              <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
