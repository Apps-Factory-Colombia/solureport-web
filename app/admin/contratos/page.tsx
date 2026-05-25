"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminHeader } from "@/components/layout/admin-header";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Download, FileText, DollarSign, CalendarDays, Building2, Plus, CheckCircle2, TrendingUp, DoorOpen, Car, Pencil, Trash2, AlertTriangle, ArrowRight, ChevronDown, ArrowLeft, X, } from "lucide-react";
import { MaintenanceContract, Client, MaintenanceParticipant, MaintenanceStatus, User } from "@/lib/types";
import { getContratos, createContrato, updateContrato, deleteContrato, updateMantenimientoContrato } from "@/lib/supabase/services/contratos";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { updateMantenimiento } from "@/lib/supabase/services/mantenimientos";
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

type ContractParticipantDraft = {
  usuarioId: string;
  porcentaje: string;
  valorCalculado: string;
};

type CalculatedContractParticipantDraft = {
  usuarioId: string;
  porcentaje: string;
  valorCalculado: string;
};

type ContractMaintenanceDraft = {
  mes: number;
  fechaProgramada: string;
  horaProgramada: string;
  valorTecnico: string;
  tecnicoId: string;
  participantDrafts: ContractParticipantDraft[];
  participantSearch: string;
  participantSelectorOpen: boolean;
};

function buildDefaultParticipantDrafts(tecnicoId?: string) {
  if (!tecnicoId) return [] as ContractParticipantDraft[];

  return [{
    usuarioId: tecnicoId,
    porcentaje: "100",
    valorCalculado: "0",
  }];
}

function calculateParticipantBreakdown(drafts: ContractParticipantDraft[], totalCost?: number) {
  const visibleDrafts = drafts.filter((draft) => !!draft.usuarioId);
  if (visibleDrafts.length === 0) {
    return {
      drafts: [] as CalculatedContractParticipantDraft[],
      totalCost: Math.max(0, Math.round(Number(totalCost ?? 0) || 0)),
      totalPercentage: 0,
      totalAssigned: 0,
      isBalanced: false,
    };
  }

  const normalizedDrafts = visibleDrafts.map((draft) => ({
    usuarioId: draft.usuarioId,
    porcentaje: Number((Math.max(0, Number(draft.porcentaje || 0) || 0)).toFixed(2)),
    valorCalculado: Math.max(0, Math.round(Number(draft.valorCalculado || 0) || 0)),
  }));
  const totalPercentage = Number(normalizedDrafts.reduce((sum, draft) => sum + draft.porcentaje, 0).toFixed(2));
  const calculatedDrafts = normalizedDrafts.map((draft) => ({
    usuarioId: draft.usuarioId,
    porcentaje: String(draft.porcentaje),
    valorCalculado: String(draft.valorCalculado),
  }));

  const totalAssigned = calculatedDrafts.reduce((sum, draft) => sum + (Number(draft.valorCalculado || 0) || 0), 0);
  const normalizedTotal = Math.max(0, Math.round(Number(totalCost ?? totalAssigned) || 0));

  return {
    drafts: calculatedDrafts,
    totalCost: normalizedTotal,
    totalPercentage,
    totalAssigned,
    isBalanced: calculatedDrafts.length > 0 && totalPercentage === 100 && totalAssigned === normalizedTotal,
  };
}

function recalculateParticipantValuesFromPercentages(drafts: ContractParticipantDraft[], totalCost: number) {
  const visibleDrafts = drafts.filter((draft) => !!draft.usuarioId);
  const totalAssigned = Math.max(0, Math.round(Number(totalCost) || 0));

  if (totalAssigned <= 0) {
    return visibleDrafts.map((draft) => ({ ...draft, valorCalculado: "0" }));
  }

  let assigned = 0;
  return visibleDrafts.map((draft, index) => {
    const porcentaje = Math.max(0, Number(draft.porcentaje || 0) || 0);
    const valorCalculado = index === visibleDrafts.length - 1
      ? Math.max(0, totalAssigned - assigned)
      : Math.max(0, Math.round((porcentaje / 100) * totalAssigned));

    assigned += valorCalculado;

    return {
      ...draft,
      porcentaje: String(porcentaje),
      valorCalculado: String(valorCalculado),
    };
  });
}

function recalculateParticipantPercentagesFromValues(drafts: ContractParticipantDraft[]) {
  const visibleDrafts = drafts.filter((draft) => !!draft.usuarioId);
  const totalAssigned = visibleDrafts.reduce((sum, draft) => sum + (Math.max(0, Math.round(Number(draft.valorCalculado || 0) || 0))), 0);

  if (totalAssigned <= 0) {
    return visibleDrafts.length === 1
      ? [{ ...visibleDrafts[0], porcentaje: "100" }]
      : visibleDrafts;
  }

  let assignedPercentage = 0;
  return visibleDrafts.map((draft, index) => {
    const value = Math.max(0, Math.round(Number(draft.valorCalculado || 0) || 0));
    const porcentaje = index === visibleDrafts.length - 1
      ? Number((100 - assignedPercentage).toFixed(2))
      : Number(((value / totalAssigned) * 100).toFixed(2));

    assignedPercentage = Number((assignedPercentage + porcentaje).toFixed(2));

    return {
      ...draft,
      porcentaje: String(Math.max(0, porcentaje)),
      valorCalculado: String(value),
    };
  });
}

function buildContractMaintenanceDraftKey(mes: number, fechaProgramada: string) {
  return `${mes}|${fechaProgramada}`;
}

export default function ContratosPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<MaintenanceContract[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
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
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createClientSelectorOpen, setCreateClientSelectorOpen] = useState(false);
  const [createClientSearch, setCreateClientSearch] = useState("");
  const [newClienteId, setNewClienteId] = useState("");
  const [newAnio, setNewAnio] = useState(String(new Date().getFullYear()));
  const [newMesInicio, setNewMesInicio] = useState("1");
  const [newDiaInicio, setNewDiaInicio] = useState("1");
  const [newPuertasPeatonales, setNewPuertasPeatonales] = useState("0");
  const [newPuertasVehiculares, setNewPuertasVehiculares] = useState("0");
  const [newValorPuertaPeatonal, setNewValorPuertaPeatonal] = useState("0");
  const [newValorPuertaVehicular, setNewValorPuertaVehicular] = useState("0");
  const [newCostoTotal, setNewCostoTotal] = useState("");
  const [newCantidad, setNewCantidad] = useState("3");
  const [createMaintenanceDrafts, setCreateMaintenanceDrafts] = useState<ContractMaintenanceDraft[]>([]);
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
  const [editValorPuertaPeatonal, setEditValorPuertaPeatonal] = useState("0");
  const [editValorPuertaVehicular, setEditValorPuertaVehicular] = useState("0");
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
    try {
      const [ct, cl, us] = await Promise.all([getContratos(), getClientes(), getUsuarios()]);
      setContracts(ct);
      setClients(cl);
      setUsers(us);
    } catch (err) {
      console.error("Error cargando contratos:", err);
    }
  };

  useEffect(() => { loadData(); }, []);

  const costoPorMant = newCostoTotal && newCantidad
    ? Math.round(Number(newCostoTotal) / Number(newCantidad))
    : 0;

  const assignableUsers = useMemo(
    () => users.filter((user) => user.estado === "activo" && (user.rol === "tecnico" || user.rol === "lider" || user.esLider)),
    [users]
  );

  const activeClients = useMemo(
    () => clients.filter((client) => client.estado === "activo"),
    [clients]
  );

  const filteredCreateClients = useMemo(() => {
    const query = createClientSearch.trim().toLowerCase();
    if (!query) return activeClients;

    return activeClients.filter((client) => {
      const searchableText = [
        client.edificio,
        client.nombre,
        client.contacto,
        client.nitCedula,
        client.correo,
      ].join(" ").toLowerCase();

      return searchableText.includes(query);
    });
  }, [activeClients, createClientSearch]);

  const selectedCreateClient = useMemo(
    () => clients.find((client) => client.id === newClienteId),
    [clients, newClienteId]
  );

  const selectedCreateClientLabel = selectedCreateClient
    ? `${selectedCreateClient.edificio || selectedCreateClient.nombre} — ${selectedCreateClient.nombre}`
    : "Seleccionar cliente";

  const valorConfiguradoPuertasNuevo =
    (Number(newPuertasPeatonales) || 0) * (Number(newValorPuertaPeatonal) || 0)
    + (Number(newPuertasVehiculares) || 0) * (Number(newValorPuertaVehicular) || 0);

  const valorConfiguradoPuertasEdicion =
    (Number(editPuertasPeatonales) || 0) * (Number(editValorPuertaPeatonal) || 0)
    + (Number(editPuertasVehiculares) || 0) * (Number(editValorPuertaVehicular) || 0);

  const resetCreateFlow = () => {
    setCreateStep(1);
    setCreateClientSelectorOpen(false);
    setCreateClientSearch("");
    setNewClienteId("");
    setNewAnio(String(new Date().getFullYear()));
    setNewMesInicio("1");
    setNewDiaInicio("1");
    setNewPuertasPeatonales("0");
    setNewPuertasVehiculares("0");
    setNewValorPuertaPeatonal("0");
    setNewValorPuertaVehicular("0");
    setNewCostoTotal("");
    setNewCantidad("3");
    setCreateMaintenanceDrafts([]);
  };

  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      resetCreateFlow();
    }
  };

  useEffect(() => {
    if (!createOpen) return;
    const client = clients.find((item) => item.id === newClienteId);
    if (!client) return;

    setNewPuertasPeatonales(String(client.puertasPeatonales || 0));
    setNewPuertasVehiculares(String(client.puertasVehiculares || 0));
  }, [clients, createOpen, newClienteId]);

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

  const buildMaintenanceDrafts = (
    cantidad: number,
    anio: number,
    mesInicio: number,
    dia: number,
    previousDrafts: ContractMaintenanceDraft[] = []
  ) => {
    const previousByKey = new Map(
      previousDrafts.map((draft) => [buildContractMaintenanceDraftKey(draft.mes, draft.fechaProgramada), draft])
    );

    return buildMantenimientos(cantidad, anio, mesInicio, dia).map((maintenance) => {
      const key = buildContractMaintenanceDraftKey(maintenance.mes, maintenance.fechaProgramada);
      const previous = previousByKey.get(key);

      return {
        mes: maintenance.mes,
        fechaProgramada: maintenance.fechaProgramada,
        horaProgramada: previous?.horaProgramada || "",
        valorTecnico: previous?.valorTecnico || "0",
        tecnicoId: previous?.tecnicoId || "",
        participantDrafts: previous?.participantDrafts || [],
        participantSearch: previous?.participantSearch || "",
        participantSelectorOpen: false,
      } satisfies ContractMaintenanceDraft;
    });
  };

  const updateCreateMaintenanceDraft = (
    targetIndex: number,
    updater: (draft: ContractMaintenanceDraft) => ContractMaintenanceDraft
  ) => {
    setCreateMaintenanceDrafts((current) => current.map((draft, index) => index === targetIndex ? updater(draft) : draft));
  };

  const ensureTechnicianParticipant = (draft: ContractMaintenanceDraft, tecnicoId: string) => {
    if (!tecnicoId) return draft;

    const visibleParticipants = draft.participantDrafts.filter((participant) => !!participant.usuarioId);
    if (visibleParticipants.length === 0) {
      return {
        ...draft,
        tecnicoId,
        participantDrafts: buildDefaultParticipantDrafts(tecnicoId),
      };
    }

    if (visibleParticipants.some((participant) => participant.usuarioId === tecnicoId)) {
      return {
        ...draft,
        tecnicoId,
        participantDrafts: visibleParticipants.length === 1
          ? [{ ...visibleParticipants[0], porcentaje: "100" }]
          : visibleParticipants,
      };
    }

    return {
      ...draft,
      tecnicoId,
      participantDrafts: [...visibleParticipants, { usuarioId: tecnicoId, porcentaje: "0", valorCalculado: "0" }],
    };
  };

  const handleCreateStepContinue = () => {
    if (!newClienteId) {
      window.alert("Selecciona un cliente para continuar.");
      return;
    }

    const cantidad = Number(newCantidad);
    const anio = Number(newAnio);
    const costoTotal = Number(newCostoTotal);
    const mesInicio = Number(newMesInicio);
    const diaInicio = Number(newDiaInicio);

    if (!Number.isFinite(anio) || anio < 2000) {
      window.alert("Ingresa un año válido.");
      return;
    }

    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 12) {
      window.alert("La cantidad de mantenimientos debe estar entre 1 y 12.");
      return;
    }

    if (!Number.isFinite(diaInicio) || diaInicio < 1 || diaInicio > 28) {
      window.alert("El día de inicio debe estar entre 1 y 28.");
      return;
    }

    if (!Number.isFinite(costoTotal) || costoTotal <= 0) {
      window.alert("Ingresa un costo total anual mayor a cero.");
      return;
    }

    setCreateMaintenanceDrafts((current) => buildMaintenanceDrafts(cantidad, anio, mesInicio, diaInicio, current));
    setCreateStep(2);
  };

  const handleCreateParticipantToggle = (targetIndex: number, userId: string, checked: boolean) => {
    updateCreateMaintenanceDraft(targetIndex, (draft) => {
      const visibleParticipants = draft.participantDrafts.filter((participant) => !!participant.usuarioId);
      const nextParticipants = checked
        ? [...visibleParticipants, { usuarioId: userId, porcentaje: visibleParticipants.length === 0 ? "100" : "0", valorCalculado: "0" }]
        : visibleParticipants.filter((participant) => participant.usuarioId !== userId);

      if (nextParticipants.length === 1) {
        nextParticipants[0] = { ...nextParticipants[0], porcentaje: "100" };
      }

      const nextTechnicianId = checked
        ? (draft.tecnicoId || userId)
        : draft.tecnicoId === userId
          ? (nextParticipants[0]?.usuarioId || "")
          : draft.tecnicoId;

      return ensureTechnicianParticipant({
        ...draft,
        tecnicoId: nextTechnicianId,
        participantDrafts: nextParticipants,
      }, nextTechnicianId);
    });
  };

  const handleCopyDraftConfigurationToAll = (targetIndex: number) => {
    setCreateMaintenanceDrafts((current) => {
      const source = current[targetIndex];
      if (!source) return current;

      return current.map((draft, index) => index === targetIndex
        ? draft
        : {
          ...draft,
          tecnicoId: source.tecnicoId,
          horaProgramada: source.horaProgramada,
          valorTecnico: source.valorTecnico,
          participantDrafts: source.participantDrafts.map((participant) => ({ ...participant })),
          participantSearch: "",
          participantSelectorOpen: false,
        });
    });
  };

  const validateCreateMaintenanceDrafts = () => {
    if (createMaintenanceDrafts.length === 0) {
      window.alert("Configura al menos un mantenimiento antes de crear el contrato.");
      return false;
    }

    for (let index = 0; index < createMaintenanceDrafts.length; index += 1) {
      const draft = createMaintenanceDrafts[index];
      const technicalValue = Math.max(0, Math.round(Number(draft.valorTecnico || 0) || 0));
      const summary = calculateParticipantBreakdown(draft.participantDrafts, technicalValue);

      if (!draft.tecnicoId) {
        window.alert(`Selecciona un técnico responsable para el mantenimiento ${index + 1}.`);
        return false;
      }

      if (draft.valorTecnico.trim() === "" || Number.isNaN(Number(draft.valorTecnico))) {
        window.alert(`Ingresa un valor técnico válido para el mantenimiento ${index + 1}.`);
        return false;
      }

      if (!summary.isBalanced) {
        window.alert(`El reparto de participantes del mantenimiento ${index + 1} debe sumar 100% y coincidir con ${formatCurrency(technicalValue)}.`);
        return false;
      }
    }

    return true;
  };

  const handleCreateContract = async () => {
    if (!newClienteId || !newCostoTotal || !newCantidad) return;
    if (!validateCreateMaintenanceDrafts()) return;
    setCreating(true);
    try {
      const anio = Number(newAnio);
      const cantidad = Number(newCantidad);
      const costoTotal = Number(newCostoTotal);
      const mesInicio = Number(newMesInicio);
      const diaInicio = Number(newDiaInicio);
      const costoPorMantenimiento = Math.round(costoTotal / cantidad);
      const mantenimientos = createMaintenanceDrafts.map((draft) => ({
        id: `temp-${draft.mes}-${draft.fechaProgramada}`,
        mes: draft.mes,
        fechaProgramada: draft.fechaProgramada,
        tecnicoId: draft.tecnicoId,
        estado: "programado" as const,
        valorRecaudado: 0,
      }));

      const createdContract = await createContrato({
        clienteId: newClienteId,
        anio,
        mesInicio,
        diaInicio,
        puertasPeatonales: Number(newPuertasPeatonales) || 0,
        puertasVehiculares: Number(newPuertasVehiculares) || 0,
        valorPuertaPeatonal: Number(newValorPuertaPeatonal) || 0,
        valorPuertaVehicular: Number(newValorPuertaVehicular) || 0,
        costoTotalAnual: costoTotal,
        cantidadMantenimientos: cantidad,
        costoPorMantenimiento,
        mantenimientosRealizados: mantenimientos,
        estado: "activo",
      });

      const selectedClient = clients.find((client) => client.id === newClienteId);

      const createdMaintenancesByKey = new Map(
        createdContract.mantenimientosRealizados.map((maintenance) => [
          buildContractMaintenanceDraftKey(maintenance.mes, maintenance.fechaProgramada),
          maintenance,
        ])
      );

      await Promise.all(createMaintenanceDrafts.map(async (draft) => {
        const createdMaintenance = createdMaintenancesByKey.get(buildContractMaintenanceDraftKey(draft.mes, draft.fechaProgramada));
        if (!createdMaintenance) return;

        const technicalValue = Math.max(0, Math.round(Number(draft.valorTecnico || 0) || 0));
        const participantSummary = calculateParticipantBreakdown(draft.participantDrafts, technicalValue);
        await updateMantenimiento(createdMaintenance.id, {
          tecnicoId: draft.tecnicoId,
          fechaProgramada: draft.fechaProgramada,
          horaProgramada: draft.horaProgramada || undefined,
          estado: "programado" as MaintenanceStatus,
          costoTecnicoTotal: technicalValue,
          participantes: participantSummary.drafts.map((participant): MaintenanceParticipant => ({
            usuarioId: participant.usuarioId,
            porcentaje: Number(participant.porcentaje || 0) || 0,
            valorCalculado: Number(participant.valorCalculado || 0) || 0,
          })),
        });
      }));

      setCreateOpen(false);
      resetCreateFlow();
      setCreatedContractInfo({
        cliente: selectedClient?.edificio || selectedClient?.nombre || "el cliente seleccionado",
        cantidad: createMaintenanceDrafts.length,
      });
      await loadData();
    } catch (err) {
      console.error("Error creando contrato:", err);
    } finally {
      setCreating(false);
    }
  };

  const openUnifiedModal = (ct: MaintenanceContract) => {
    setSelectedContract(ct);
    setEditClienteId(ct.clienteId);
    setEditAnio(String(ct.anio));
    setEditMesInicio(String(ct.mesInicio || 1));
    setEditDiaInicio(String(ct.diaInicio || 1));
    setEditCostoTotal(String(ct.costoTotalAnual));
    setEditCantidad(String(ct.cantidadMantenimientos));
    setEditEstado(ct.estado);
    setEditPuertasPeatonales(String(ct.puertasPeatonales || 0));
    setEditPuertasVehiculares(String(ct.puertasVehiculares || 0));
    setEditValorPuertaPeatonal(String(ct.valorPuertaPeatonal || 0));
    setEditValorPuertaVehicular(String(ct.valorPuertaVehicular || 0));
    setEditRegenerarMants(false);
    setDetailOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedContract || !editClienteId || !editCostoTotal) return;
    setSaving(true);
    try {
      const cantidad = Number(editCantidad);
      const costoTotal = Number(editCostoTotal);
      const updated = await updateContrato(selectedContract.id, {
        clienteId: editClienteId,
        anio: Number(editAnio),
        mesInicio: Number(editMesInicio),
        diaInicio: Number(editDiaInicio),
        puertasPeatonales: Number(editPuertasPeatonales) || 0,
        puertasVehiculares: Number(editPuertasVehiculares) || 0,
        valorPuertaPeatonal: Number(editValorPuertaPeatonal) || 0,
        valorPuertaVehicular: Number(editValorPuertaVehicular) || 0,
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
              onClick={() => {
                resetCreateFlow();
                setCreateOpen(true);
              }}
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
                                {ct.puertasPeatonales}
                              </span>
                              <span className="flex items-center gap-1 text-foreground/80">
                                <Car className="h-3.5 w-3.5 text-gold" />
                                {ct.puertasVehiculares}
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
                              {ct.puertasPeatonales}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80 text-center">
                              {ct.puertasVehiculares}
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

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                      <p className="text-xs text-muted-foreground">Puertas peatonales</p>
                      <p className="text-sm font-medium text-foreground">
                        {selectedContract.puertasPeatonales} x {formatCurrency(selectedContract.valorPuertaPeatonal)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                      <p className="text-xs text-muted-foreground">Puertas vehiculares</p>
                      <p className="text-sm font-medium text-foreground">
                        {selectedContract.puertasVehiculares} x {formatCurrency(selectedContract.valorPuertaVehicular)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Valor configurado por puertas</span>
                      <span className="font-semibold text-cyan-neon">
                        {formatCurrency(
                          selectedContract.puertasPeatonales * selectedContract.valorPuertaPeatonal
                          + selectedContract.puertasVehiculares * selectedContract.valorPuertaVehicular
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Este valor es informativo y no reemplaza el valor total anual del contrato.
                    </p>
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
                        <Label className="text-foreground/80">Valor puerta peatonal ($)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={editValorPuertaPeatonal}
                          onChange={(e) => setEditValorPuertaPeatonal(e.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-foreground/80">Valor puerta vehicular ($)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={editValorPuertaVehicular}
                          onChange={(e) => setEditValorPuertaVehicular(e.target.value)}
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

                    <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Valor configurado por puertas</span>
                        <span className="font-semibold text-cyan-neon">{formatCurrency(valorConfiguradoPuertasEdicion)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        El valor total anual del contrato se mantiene independiente de esta configuración.
                      </p>
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
                          Recalculará las fechas de los mantenimientos en estado &quot;pendiente&quot; según la nueva configuración.
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

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-hidden bg-card border-border sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nuevo Contrato de Mantenimiento</DialogTitle>
            <div className="flex flex-wrap items-center gap-2 pt-3 text-xs">
              <Badge variant="outline" className={cn("border-border/50", createStep === 1 && "border-gold/40 bg-gold/10 text-gold")}>Paso 1: Contrato</Badge>
              <Badge variant="outline" className={cn("border-border/50", createStep === 2 && "border-gold/40 bg-gold/10 text-gold")}>Paso 2: Mantenimientos</Badge>
            </div>
          </DialogHeader>

          {createStep === 1 ? (
            <div className="space-y-5 overflow-y-auto pr-1">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Cliente</Label>
                    <Popover open={createClientSelectorOpen} onOpenChange={setCreateClientSelectorOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-between border-border/50 bg-secondary/50 text-foreground hover:bg-secondary/70">
                          <span className="truncate text-left">{selectedCreateClientLabel}</span>
                          <ChevronDown className="h-4 w-4 opacity-60" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(30rem,calc(100vw-2rem))] border-border bg-card p-3" align="start">
                        <div className="space-y-3">
                          <Input
                            value={createClientSearch}
                            onChange={(event) => setCreateClientSearch(event.target.value)}
                            placeholder="Buscar cliente, edificio, NIT o correo"
                            className="bg-secondary/50 border-border/50"
                          />
                          <ScrollArea className="h-56 rounded-md border border-border/50">
                            <div className="space-y-1 p-2">
                              {filteredCreateClients.map((client) => {
                                const isSelected = newClienteId === client.id;
                                return (
                                  <button
                                    key={client.id}
                                    type="button"
                                    className={cn(
                                      "flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-secondary/50",
                                      isSelected && "bg-gold/10 text-gold"
                                    )}
                                    onClick={() => {
                                      setNewClienteId(client.id);
                                      setCreateClientSelectorOpen(false);
                                      setCreateClientSearch("");
                                    }}
                                  >
                                    <span className="text-sm font-medium">{client.edificio || client.nombre}</span>
                                    <span className="text-xs text-muted-foreground">{client.nombre} · {client.nitCedula || "Sin NIT"}</span>
                                  </button>
                                );
                              })}
                              {filteredCreateClients.length === 0 && (
                                <p className="px-3 py-4 text-center text-xs text-muted-foreground">No hay clientes que coincidan con la búsqueda.</p>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Año</Label>
                      <Input type="number" value={newAnio} onChange={(e) => setNewAnio(e.target.value)} className="bg-secondary/50 border-border/50" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Cantidad de Mantenimientos</Label>
                      <Input type="number" min="1" max="12" value={newCantidad} onChange={(e) => setNewCantidad(e.target.value)} className="bg-secondary/50 border-border/50" />
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
                      <Input type="number" min="1" max="28" value={newDiaInicio} onChange={(e) => setNewDiaInicio(e.target.value)} className="bg-secondary/50 border-border/50" placeholder="1-28" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Puertas peatonales</Label>
                      <Input type="number" min="0" value={newPuertasPeatonales} onChange={(e) => setNewPuertasPeatonales(e.target.value)} className="bg-secondary/50 border-border/50" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Valor puertas peatonales ($)</Label>
                      <Input type="number" min="0" value={newValorPuertaPeatonal} onChange={(e) => setNewValorPuertaPeatonal(e.target.value)} className="bg-secondary/50 border-border/50" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Puertas vehiculares</Label>
                      <Input type="number" min="0" value={newPuertasVehiculares} onChange={(e) => setNewPuertasVehiculares(e.target.value)} className="bg-secondary/50 border-border/50" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Valor puertas vehiculares ($)</Label>
                      <Input type="number" min="0" value={newValorPuertaVehicular} onChange={(e) => setNewValorPuertaVehicular(e.target.value)} className="bg-secondary/50 border-border/50" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-foreground/80">Costo Total Anual ($)</Label>
                    <Input type="number" min="0" value={newCostoTotal} onChange={(e) => setNewCostoTotal(e.target.value)} className="bg-secondary/50 border-border/50" placeholder="Ej: 12000000" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 space-y-3">
                    <p className="text-sm font-semibold text-foreground">Resumen del contrato</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cliente</span>
                      <span className="max-w-[14rem] truncate text-right text-foreground">{selectedCreateClient?.edificio || selectedCreateClient?.nombre || "Sin seleccionar"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Mantenimientos</span>
                      <span className="text-foreground">{newCantidad || "0"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Costo total anual</span>
                      <span className="font-semibold text-gold">{newCostoTotal ? formatCurrency(Number(newCostoTotal)) : "—"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Referencia contrato por mantenimiento</span>
                      <span className="font-semibold text-gold">{costoPorMant > 0 ? formatCurrency(costoPorMant) : "—"}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      En el siguiente paso podrás asignar técnico, hora y participantes. El valor técnico real quedará pendiente para administración.
                    </p>
                  </div>

                  <div className="rounded-xl border border-cyan-neon/20 bg-cyan-neon/5 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Valor configurado por puertas</span>
                      <span className="font-semibold text-cyan-neon">{formatCurrency(valorConfiguradoPuertasNuevo)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Se guarda como referencia del contrato y no reemplaza el costo total anual.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5 overflow-hidden">
              <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Configura los mantenimientos antes de crear el contrato</p>
                    <p className="text-xs text-muted-foreground">
                      Cada mantenimiento quedará listo con técnico responsable y participantes correlacionados desde el inicio.
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-muted-foreground">Referencia del contrato</p>
                    <p className="font-semibold text-gold">{formatCurrency(costoPorMant)}</p>
                  </div>
                </div>
              </div>

              <ScrollArea className="h-[52vh] rounded-xl border border-border/50 p-0">
                <div className="space-y-4 p-4">
                  {createMaintenanceDrafts.map((draft, index) => {
                    const technicalValue = Math.max(0, Math.round(Number(draft.valorTecnico || 0) || 0));
                    const participantSummary = calculateParticipantBreakdown(draft.participantDrafts, technicalValue);
                    const selectedParticipantIds = new Set(draft.participantDrafts.filter((participant) => !!participant.usuarioId).map((participant) => participant.usuarioId));
                    const filteredAssignableUsers = assignableUsers.filter((user) => {
                      const query = draft.participantSearch.trim().toLowerCase();
                      if (!query) return true;
                      return `${user.nombre} ${user.apellido} ${user.email}`.toLowerCase().includes(query);
                    });

                    return (
                      <div key={buildContractMaintenanceDraftKey(draft.mes, draft.fechaProgramada)} className="rounded-xl border border-border/50 bg-secondary/20 p-4 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">Mantenimiento {index + 1} · {monthNames[draft.mes - 1]}</p>
                            <p className="text-xs text-muted-foreground">Se creará en estado programado y con reparto porcentual inicial.</p>
                          </div>
                          <Button type="button" variant="outline" className="border-border/50 bg-card text-xs" onClick={() => handleCopyDraftConfigurationToAll(index)}>
                            Copiar configuración al resto
                          </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-4">
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Fecha programada</Label>
                            <Input
                              type="date"
                              value={draft.fechaProgramada}
                              onChange={(event) => updateCreateMaintenanceDraft(index, (current) => ({ ...current, fechaProgramada: event.target.value }))}
                              className="bg-card border-border/50"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Hora programada</Label>
                            <Input
                              type="time"
                              value={draft.horaProgramada}
                              onChange={(event) => updateCreateMaintenanceDraft(index, (current) => ({ ...current, horaProgramada: event.target.value }))}
                              className="bg-card border-border/50"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Técnico responsable</Label>
                            <Select
                              value={draft.tecnicoId}
                              onValueChange={(value) => updateCreateMaintenanceDraft(index, (current) => ensureTechnicianParticipant({ ...current, tecnicoId: value }, value))}
                            >
                              <SelectTrigger className="bg-card border-border/50">
                                <SelectValue placeholder="Seleccionar técnico" />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border">
                                {assignableUsers.map((user) => (
                                  <SelectItem key={user.id} value={user.id}>{`${user.nombre} ${user.apellido}`}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-foreground/80">Valor técnico total</Label>
                            <Input
                              type="number"
                              min="0"
                              value={draft.valorTecnico}
                              onChange={(event) => updateCreateMaintenanceDraft(index, (current) => ({
                                ...current,
                                valorTecnico: event.target.value,
                                participantDrafts: recalculateParticipantValuesFromPercentages(
                                  current.participantDrafts,
                                  Number(event.target.value || 0)
                                ),
                              }))}
                              className="bg-card border-border/50"
                            />
                          </div>
                        </div>

                        <div className="rounded-lg border border-border/50 bg-card/70 p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">Participantes</p>
                              <p className="text-xs text-muted-foreground">Usa el valor técnico total para repartir por porcentaje, o ajusta valores individuales para recalcular el total.</p>
                            </div>
                            <Popover open={draft.participantSelectorOpen} onOpenChange={(open) => updateCreateMaintenanceDraft(index, (current) => ({ ...current, participantSelectorOpen: open }))}>
                              <PopoverTrigger asChild>
                                <Button type="button" variant="outline" className="border-border/50 bg-card text-xs">
                                  <Plus className="mr-2 h-4 w-4" />
                                  Agregar participantes
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] border-border bg-card p-3" align="end">
                                <div className="space-y-3">
                                  <Input
                                    value={draft.participantSearch}
                                    onChange={(event) => updateCreateMaintenanceDraft(index, (current) => ({ ...current, participantSearch: event.target.value }))}
                                    placeholder="Buscar técnico o líder"
                                    className="bg-secondary/50 border-border/50"
                                  />
                                  <ScrollArea className="h-56 rounded-md border border-border/50">
                                    <div className="space-y-1 p-2">
                                      {filteredAssignableUsers.map((user) => {
                                        const checked = selectedParticipantIds.has(user.id);
                                        return (
                                          <label key={user.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-secondary/50">
                                            <Checkbox checked={checked} onCheckedChange={(value) => handleCreateParticipantToggle(index, user.id, value === true)} />
                                            <div className="min-w-0">
                                              <p className="truncate text-sm text-foreground">{user.nombre} {user.apellido}</p>
                                              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                                            </div>
                                          </label>
                                        );
                                      })}
                                      {filteredAssignableUsers.length === 0 && (
                                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">No hay usuarios que coincidan con la búsqueda.</p>
                                      )}
                                    </div>
                                  </ScrollArea>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>

                          <div className="space-y-2">
                            {draft.participantDrafts.filter((participant) => !!participant.usuarioId).length === 0 ? (
                              <p className="rounded-md border border-dashed border-border/50 px-3 py-4 text-sm text-muted-foreground">
                                Agrega al menos un participante para este mantenimiento.
                              </p>
                            ) : (
                              draft.participantDrafts.filter((participant) => !!participant.usuarioId).map((participant) => {
                                const participantUser = assignableUsers.find((user) => user.id === participant.usuarioId);
                                const calculatedParticipant = participantSummary.drafts.find((item) => item.usuarioId === participant.usuarioId);

                                return (
                                  <div key={participant.usuarioId} className="grid gap-3 rounded-md border border-border/50 bg-secondary/30 p-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_2.5rem] md:items-center">
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{participantUser ? `${participantUser.nombre} ${participantUser.apellido}` : participant.usuarioId}</p>
                                      <p className="text-xs text-muted-foreground">{draft.tecnicoId === participant.usuarioId ? "Responsable principal" : "Participante"}</p>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">Porcentaje</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={participant.porcentaje}
                                        onChange={(event) => updateCreateMaintenanceDraft(index, (current) => ({
                                          ...current,
                                          participantDrafts: recalculateParticipantValuesFromPercentages(
                                            current.participantDrafts.map((item) => item.usuarioId === participant.usuarioId ? { ...item, porcentaje: event.target.value } : item),
                                            Number(current.valorTecnico || 0)
                                          ),
                                        }))}
                                        className="h-9 bg-card border-border/50"
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[11px] text-muted-foreground">Valor</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={calculatedParticipant?.valorCalculado || participant.valorCalculado || "0"}
                                        onChange={(event) => updateCreateMaintenanceDraft(index, (current) => {
                                          const nextParticipants = recalculateParticipantPercentagesFromValues(current.participantDrafts.map((item) => item.usuarioId === participant.usuarioId
                                            ? { ...item, valorCalculado: event.target.value }
                                            : item));
                                          const nextSummary = calculateParticipantBreakdown(nextParticipants);

                                          return {
                                            ...current,
                                            valorTecnico: String(nextSummary.totalAssigned),
                                            participantDrafts: nextParticipants,
                                          };
                                        })}
                                        className="h-9 bg-card border-border/50"
                                      />
                                    </div>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleCreateParticipantToggle(index, participant.usuarioId, false)}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          <div className={cn(
                            "rounded-md border px-3 py-3 text-xs",
                            participantSummary.isBalanced
                              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                              : "border-amber-500/20 bg-amber-500/5 text-amber-300"
                          )}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>Porcentaje total: {participantSummary.totalPercentage}%</span>
                              <span>Valor técnico total: {formatCurrency(technicalValue)}</span>
                            </div>
                            {!participantSummary.isBalanced && (
                              <p className="mt-1">Ajusta el reparto hasta completar 100% y {formatCurrency(technicalValue)}.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleCreateOpenChange(false)} className="text-muted-foreground">
              Cancelar
            </Button>
            {createStep === 2 && (
              <Button variant="outline" onClick={() => setCreateStep(1)} className="gap-2 border-border/50 bg-card text-foreground">
                <ArrowLeft className="h-4 w-4" />
                Volver al contrato
              </Button>
            )}
            <Button
              onClick={createStep === 1 ? handleCreateStepContinue : handleCreateContract}
              disabled={creating || !newClienteId || !newCostoTotal}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {creating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              ) : createStep === 1 ? (
                <ArrowRight className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {creating ? "Creando..." : createStep === 1 ? "Configurar mantenimientos" : "Crear contrato y mantenimientos"}
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
                      Se crearon y configuraron <span className="font-medium text-foreground">{createdContractInfo.cantidad}</span> mantenimientos asociados a este contrato.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ya quedaron correlacionados con técnico responsable y reparto inicial de participantes.
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
