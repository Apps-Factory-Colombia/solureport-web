"use client";

import { useMemo, useState, useEffect } from "react";
import { Maintenance, MaintenanceParticipant, MaintenanceStatus, Client, User } from "@/lib/types";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, X } from "lucide-react";

type ParticipantDraft = {
  usuarioId: string;
  porcentaje: string;
  valorCalculado: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function buildDefaultParticipantDrafts(tecnicoId?: string, costoTecnicoTotal?: number): ParticipantDraft[] {
  if (!tecnicoId) return [];

  return [{
    usuarioId: tecnicoId,
    porcentaje: "100",
    valorCalculado: String(Math.max(0, Math.round(Number(costoTecnicoTotal ?? 0) || 0))),
  }];
}

function normalizeParticipantDrafts(drafts: ParticipantDraft[]) {
  return drafts.map((draft) => ({
    ...draft,
    porcentaje: String(Math.max(0, Number(draft.porcentaje || 0) || 0)),
    valorCalculado: String(Math.max(0, Math.round(Number(draft.valorCalculado || 0) || 0))),
  }));
}

function redistributeParticipantValues(drafts: ParticipantDraft[], totalCost: number) {
  if (drafts.length === 0) return drafts;

  const normalizedDrafts = normalizeParticipantDrafts(drafts);
  const normalizedTotal = Math.max(0, Math.round(Number(totalCost) || 0));
  const totalPercentage = normalizedDrafts.reduce((sum, draft) => sum + (Number(draft.porcentaje || 0) || 0), 0);

  const percentages = totalPercentage > 0
    ? normalizedDrafts.map((draft, index) => {
      if (index === normalizedDrafts.length - 1) {
        const assigned = normalizedDrafts.slice(0, index).reduce((sum, item) => {
          const currentPercentage = Number(item.porcentaje || 0) || 0;
          return sum + Number(((currentPercentage / totalPercentage) * 100).toFixed(2));
        }, 0);

        return Number((100 - assigned).toFixed(2));
      }

      return Number((((Number(draft.porcentaje || 0) || 0) / totalPercentage) * 100).toFixed(2));
    })
    : normalizedDrafts.map((_, index) => index === normalizedDrafts.length - 1
      ? Number((100 - ((100 / normalizedDrafts.length) * index)).toFixed(2))
      : Number((100 / normalizedDrafts.length).toFixed(2))
    );

  let assigned = 0;

  return normalizedDrafts.map((draft, index) => {
    const porcentaje = Math.max(0, percentages[index] || 0);
    const valorCalculado = index === normalizedDrafts.length - 1
      ? Math.max(0, normalizedTotal - assigned)
      : Math.max(0, Math.round((porcentaje / 100) * normalizedTotal));

    assigned += valorCalculado;

    return {
      ...draft,
      porcentaje: String(porcentaje),
      valorCalculado: String(valorCalculado),
    };
  });
}

function syncParticipantPercentages(drafts: ParticipantDraft[], totalCost: number) {
  if (drafts.length === 0) return drafts;

  const normalizedDrafts = normalizeParticipantDrafts(drafts);
  const normalizedTotal = Math.max(0, Math.round(Number(totalCost) || 0));
  const totalAmount = normalizedDrafts.reduce((sum, draft) => sum + (Number(draft.valorCalculado || 0) || 0), 0);
  const isFullyAssigned = normalizedTotal > 0 && totalAmount === normalizedTotal;

  return normalizedDrafts.map((draft, index) => {
    const amount = Math.max(0, Number(draft.valorCalculado || 0) || 0);
    const porcentaje = normalizedTotal > 0
      ? isFullyAssigned && index === normalizedDrafts.length - 1
        ? Number((100 - normalizedDrafts.slice(0, index).reduce((sum, item) => {
          const currentAmount = Math.max(0, Number(item.valorCalculado || 0) || 0);
          return sum + Number(((currentAmount / normalizedTotal) * 100).toFixed(2));
        }, 0)).toFixed(2))
        : Number(((amount / normalizedTotal) * 100).toFixed(2))
      : Number((100 / normalizedDrafts.length).toFixed(2));

    return {
      ...draft,
      porcentaje: String(Math.max(0, porcentaje)),
      valorCalculado: String(amount),
    };
  });
}

interface MaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maintenance?: Maintenance | null;
  onSave: (maintenance: Partial<Maintenance>) => void;
}

export function MaintenanceDialog({
  open,
  onOpenChange,
  maintenance,
  onSave,
}: MaintenanceDialogProps) {
  const [formData, setFormData] = useState({
    clienteId: "",
    tecnicoId: "",
    fechaProgramada: "",
    horaProgramada: "",
    estado: "programado" as MaintenanceStatus,
    observaciones: "",
    costoTecnicoTotal: "0",
  });
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [isClientListOpen, setIsClientListOpen] = useState(false);
  const [participantDrafts, setParticipantDrafts] = useState<ParticipantDraft[]>([]);
  const [participantSearch, setParticipantSearch] = useState("");
  const [isParticipantListOpen, setIsParticipantListOpen] = useState(false);

  useEffect(() => {
    if (open) {
      Promise.all([getUsuarios(), getClientes()])
        .then(([users, cls]) => {
          setTechnicians(
            users.filter(
              (u) =>
                u.estado === "activo" &&
                (u.rol === "tecnico" || u.rol === "lider" || u.esLider)
            )
          );
          setClients(cls.filter((c) => c.estado === "activo"));
        })
        .catch((err) => console.error("Error cargando datos:", err));
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setClientQuery("");
      setIsClientListOpen(false);
      setParticipantSearch("");
      setIsParticipantListOpen(false);
    }
  }, [open]);

  useEffect(() => {
    const selectedClient = clients.find((client) => client.id === formData.clienteId);

    if (!selectedClient) {
      if (!formData.clienteId) {
        setClientQuery("");
      }
      return;
    }

    setClientQuery(`${selectedClient.edificio} - ${selectedClient.nombre}`);
  }, [clients, formData.clienteId]);

  useEffect(() => {
    if (maintenance) {
      setFormData({
        clienteId: maintenance.clienteId,
        tecnicoId: maintenance.tecnicoId,
        fechaProgramada: maintenance.fechaProgramada,
        horaProgramada: maintenance.horaProgramada || "",
        estado: maintenance.estado,
        observaciones: maintenance.observaciones || "",
        costoTecnicoTotal: String(Math.max(0, Math.round(Number(maintenance.costoTecnicoTotal ?? maintenance.valorRecaudado ?? 0) || 0))),
      });
      setParticipantDrafts(
        maintenance.participantes && maintenance.participantes.length > 0
          ? maintenance.participantes.map((participant) => ({
            usuarioId: participant.usuarioId,
            porcentaje: String(participant.porcentaje),
            valorCalculado: String(participant.valorCalculado),
          }))
          : buildDefaultParticipantDrafts(maintenance.tecnicoId, maintenance.costoTecnicoTotal)
      );
    } else {
      setFormData({
        clienteId: "",
        tecnicoId: "",
        fechaProgramada: "",
        horaProgramada: "",
        estado: "programado",
        observaciones: "",
        costoTecnicoTotal: "0",
      });
      setParticipantDrafts([]);
    }
  }, [maintenance, open]);

  const normalizedParticipantDrafts = useMemo(
    () => normalizeParticipantDrafts(participantDrafts).filter((draft) => !!draft.usuarioId),
    [participantDrafts]
  );

  const participantSummary = useMemo(() => {
    const totalCost = Math.max(0, Math.round(Number(formData.costoTecnicoTotal || 0) || 0));
    const totalPercentage = Number(normalizedParticipantDrafts.reduce((sum, draft) => sum + (Number(draft.porcentaje || 0) || 0), 0).toFixed(2));
    const totalAssigned = normalizedParticipantDrafts.reduce((sum, draft) => sum + (Number(draft.valorCalculado || 0) || 0), 0);

    return {
      totalCost,
      totalPercentage,
      totalAssigned,
      isBalanced: normalizedParticipantDrafts.length > 0 && totalPercentage === 100 && totalAssigned === totalCost,
    };
  }, [formData.costoTecnicoTotal, normalizedParticipantDrafts]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === formData.clienteId);
    let proximaFecha: string | undefined;

    if (client) {
      const fecha = new Date(formData.fechaProgramada);
      fecha.setMonth(fecha.getMonth() + client.frecuenciaMantenimiento);
      proximaFecha = fecha.toISOString().split("T")[0];
    }

    if (!participantSummary.isBalanced) {
      window.alert("Debes asignar participantes, hacer que sumen 100% y que el pago distribuido coincida con el costo total.");
      return;
    }

    onSave({
      ...formData,
      id: maintenance?.id || `m${Date.now()}`,
      proximaFecha,
      costoTecnicoTotal: participantSummary.totalCost,
      participantes: normalizedParticipantDrafts.map((draft): MaintenanceParticipant => ({
        usuarioId: draft.usuarioId,
        porcentaje: Number(draft.porcentaje || 0) || 0,
        valorCalculado: Number(draft.valorCalculado || 0) || 0,
      })),
      fechaCreacion:
        maintenance?.fechaCreacion || new Date().toISOString().split("T")[0],
    });
    onOpenChange(false);
  };

  const filteredClients = clients.filter((client) => {
    const query = clientQuery.trim().toLowerCase();
    const searchableText = `${client.edificio} ${client.nombre}`.toLowerCase();
    return searchableText.includes(query);
  });

  const handleClientSelect = (client: Client) => {
    setFormData({ ...formData, clienteId: client.id });
    setClientQuery(`${client.edificio} - ${client.nombre}`);
    setIsClientListOpen(false);
  };

  const handleParticipantToggle = (user: User, checked: boolean) => {
    setParticipantDrafts((current) => {
      const nextDrafts = checked
        ? [...current, { usuarioId: user.id, porcentaje: current.length === 0 ? "100" : "0", valorCalculado: current.length === 0 ? formData.costoTecnicoTotal : "0" }]
        : current.filter((draft) => draft.usuarioId !== user.id);

      const redistributed = redistributeParticipantValues(nextDrafts, Number(formData.costoTecnicoTotal || 0));
      const fallbackUserId = redistributed[0]?.usuarioId || user.id;
      if (checked && !formData.tecnicoId) {
        setFormData((previous) => ({ ...previous, tecnicoId: fallbackUserId }));
      } else if (!checked && formData.tecnicoId === user.id) {
        setFormData((previous) => ({ ...previous, tecnicoId: redistributed[0]?.usuarioId || "" }));
      }
      return redistributed;
    });

    if (checked) {
      setParticipantSearch("");
      setIsParticipantListOpen(false);
    }
  };

  const filteredParticipantOptions = technicians.filter((user) => {
    const search = participantSearch.trim().toLowerCase();
    if (!search) return true;
    const searchable = `${user.nombre} ${user.apellido} ${user.rol}`.toLowerCase();
    return searchable.includes(search);
  });

  const selectedParticipantLabels = normalizedParticipantDrafts.map((draft) => {
    const user = technicians.find((candidate) => candidate.id === draft.usuarioId);
    return {
      id: draft.usuarioId,
      label: user ? `${user.nombre} ${user.apellido}` : "Participante sin nombre",
    };
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-card border-border sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {maintenance ? "Editar Mantenimiento" : "Nuevo Mantenimiento"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground/80">Cliente</Label>
            <div className="relative">
              <Input
                value={clientQuery}
                onFocus={() => setIsClientListOpen(true)}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setIsClientListOpen(true);
                  setFormData({ ...formData, clienteId: "" });
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsClientListOpen(false);
                  }, 120);
                }}
                placeholder="Buscar y seleccionar cliente"
                className="bg-secondary/50 border-border/50"
              />
              {isClientListOpen && (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                  {filteredClients.length > 0 ? (
                    filteredClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleClientSelect(client)}
                        className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-secondary/60"
                      >
                        {client.edificio} - {client.nombre}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No se encontraron clientes.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Fecha Programada</Label>
              <Input
                type="date"
                value={formData.fechaProgramada}
                onChange={(e) =>
                  setFormData({ ...formData, fechaProgramada: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Hora Programada</Label>
              <Input
                type="time"
                value={formData.horaProgramada}
                onChange={(e) =>
                  setFormData({ ...formData, horaProgramada: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Estado</Label>
            <Select
              value={formData.estado}
              onValueChange={(v: MaintenanceStatus) =>
                setFormData({ ...formData, estado: v })
              }
            >
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="programado">Programado</SelectItem>
                <SelectItem value="en_ejecucion">En Ejecución</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Observaciones</Label>
            <Textarea
              value={formData.observaciones}
              onChange={(e) =>
                setFormData({ ...formData, observaciones: e.target.value })
              }
              placeholder="Observaciones del mantenimiento..."
              className="bg-secondary/50 border-border/50 min-h-20"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Costo técnico total</Label>
            <Input
              type="number"
              min="0"
              value={formData.costoTecnicoTotal}
              onChange={(e) => {
                const nextValue = e.target.value;
                setFormData({ ...formData, costoTecnicoTotal: nextValue });
                setParticipantDrafts((current) => redistributeParticipantValues(current, Number(nextValue || 0)));
              }}
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Participantes del mantenimiento</p>
              <p className="text-xs text-muted-foreground">Elige en un solo lugar los líderes o técnicos asignados y reparte el pago.</p>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={participantSearch}
                  onFocus={() => setIsParticipantListOpen(true)}
                  onChange={(event) => {
                    setParticipantSearch(event.target.value);
                    setIsParticipantListOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setIsParticipantListOpen(false);
                    }, 120);
                  }}
                  placeholder="Buscar líder o técnico"
                  className="bg-background/60 border-border/50 pl-9"
                />
              </div>

              {isParticipantListOpen && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/40 bg-background/40 p-2">
                  {filteredParticipantOptions.length > 0 ? filteredParticipantOptions.map((user) => {
                    const checked = normalizedParticipantDrafts.some((draft) => draft.usuarioId === user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleParticipantToggle(user, !checked)}
                        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60"
                      >
                        <div>
                          <p>{user.nombre} {user.apellido}</p>
                          <p className="text-xs text-muted-foreground">{user.rol}</p>
                        </div>
                        <Badge variant="outline" className={checked ? "border-gold/30 bg-gold/10 text-gold" : "border-border/50 text-muted-foreground"}>
                          {checked ? "Asignado" : "Agregar"}
                        </Badge>
                      </button>
                    );
                  }) : (
                    <div className="rounded-md border border-border/40 bg-background/40 px-3 py-6 text-center text-sm text-muted-foreground">
                      No se encontraron resultados.
                    </div>
                  )}
                </div>
              )}

              {selectedParticipantLabels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedParticipantLabels.map((participant) => (
                    <Badge key={participant.id} variant="outline" className="gap-1 border-gold/30 bg-gold/10 px-2 py-1 !text-white">
                      <span>{participant.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const user = technicians.find((candidate) => candidate.id === participant.id);
                          if (user) handleParticipantToggle(user, false);
                        }}
                        className="text-white/70 transition-colors hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {normalizedParticipantDrafts.length > 0 && (
              <div className="space-y-2">
                {normalizedParticipantDrafts.map((draft) => {
                  const user = technicians.find((item) => item.id === draft.usuarioId);
                  return (
                    <div key={draft.usuarioId} className="grid grid-cols-1 gap-3 rounded-md border border-border/40 bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_120px_140px]">
                      <div>
                        <p className="text-sm font-medium text-foreground">{user?.nombre} {user?.apellido}</p>
                        <p className="text-xs text-muted-foreground">{user?.rol === "lider" || user?.esLider ? "Líder" : "Técnico"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Porcentaje</Label>
                        <Input
                          type="number"
                          value={draft.porcentaje}
                          readOnly
                          tabIndex={-1}
                          className="bg-secondary/30 border-border/40 text-muted-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Pago</Label>
                        <Input
                          type="number"
                          min="0"
                          max={Math.max(0, participantSummary.totalCost - normalizedParticipantDrafts.reduce((sum, item) => item.usuarioId === draft.usuarioId ? sum : sum + (Number(item.valorCalculado || 0) || 0), 0))}
                          value={draft.valorCalculado}
                          onChange={(event) => {
                            const otherAssigned = normalizedParticipantDrafts.reduce((sum, item) => item.usuarioId === draft.usuarioId ? sum : sum + (Number(item.valorCalculado || 0) || 0), 0);
                            const maxAllowed = Math.max(0, participantSummary.totalCost - otherAssigned);
                            const nextAmount = Math.min(Math.max(0, Number(event.target.value || 0)), maxAllowed);
                            const nextDrafts = normalizedParticipantDrafts.map((item) => item.usuarioId === draft.usuarioId
                              ? { ...item, valorCalculado: String(nextAmount) }
                              : item);
                            setParticipantDrafts(syncParticipantPercentages(nextDrafts, participantSummary.totalCost));
                          }}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Participantes: {normalizedParticipantDrafts.length}</span>
              <span className={participantSummary.totalPercentage === 100 ? "text-foreground" : "text-amber-400"}>Porcentaje: {participantSummary.totalPercentage}%</span>
              <span className={participantSummary.totalAssigned === participantSummary.totalCost ? "text-foreground" : "text-amber-400"}>Pago repartido: {formatCurrency(participantSummary.totalAssigned)}</span>
              <span className="font-medium text-gold">Total: {formatCurrency(participantSummary.totalCost)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {maintenance ? "Guardar Cambios" : "Crear Mantenimiento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
