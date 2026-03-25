"use client";

import { useState, useEffect } from "react";
import { Maintenance, MaintenanceStatus, Client, User } from "@/lib/types";
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
  });
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [technicianQuery, setTechnicianQuery] = useState("");
  const [isTechnicianListOpen, setIsTechnicianListOpen] = useState(false);

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
      setTechnicianQuery("");
      setIsTechnicianListOpen(false);
    }
  }, [open]);

  useEffect(() => {
    const selectedTechnician = technicians.find(
      (user) => user.id === formData.tecnicoId
    );

    if (!selectedTechnician) {
      if (!formData.tecnicoId) {
        setTechnicianQuery("");
      }
      return;
    }

    setTechnicianQuery(
      `${selectedTechnician.nombre} ${selectedTechnician.apellido}`
    );
  }, [technicians, formData.tecnicoId]);

  useEffect(() => {
    if (maintenance) {
      setFormData({
        clienteId: maintenance.clienteId,
        tecnicoId: maintenance.tecnicoId,
        fechaProgramada: maintenance.fechaProgramada,
        horaProgramada: maintenance.horaProgramada || "",
        estado: maintenance.estado,
        observaciones: maintenance.observaciones || "",
      });
    } else {
      setFormData({
        clienteId: "",
        tecnicoId: "",
        fechaProgramada: "",
        horaProgramada: "",
        estado: "programado",
        observaciones: "",
      });
    }
  }, [maintenance, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === formData.clienteId);
    let proximaFecha: string | undefined;

    if (client) {
      const fecha = new Date(formData.fechaProgramada);
      fecha.setMonth(fecha.getMonth() + client.frecuenciaMantenimiento);
      proximaFecha = fecha.toISOString().split("T")[0];
    }

    onSave({
      ...formData,
      id: maintenance?.id || `m${Date.now()}`,
      proximaFecha,
      fechaCreacion:
        maintenance?.fechaCreacion || new Date().toISOString().split("T")[0],
    });
    onOpenChange(false);
  };

  const filteredTechnicians = technicians.filter((user) => {
    const fullName = `${user.nombre} ${user.apellido}`.toLowerCase();
    return fullName.includes(technicianQuery.trim().toLowerCase());
  });

  const handleTechnicianSelect = (user: User) => {
    setFormData({ ...formData, tecnicoId: user.id });
    setTechnicianQuery(`${user.nombre} ${user.apellido}`);
    setIsTechnicianListOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {maintenance ? "Editar Mantenimiento" : "Nuevo Mantenimiento"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground/80">Cliente</Label>
            <Select
              value={formData.clienteId}
              onValueChange={(v) =>
                setFormData({ ...formData, clienteId: v })
              }
            >
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.edificio} - {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Líder o Técnico Asignado</Label>
            <div className="relative">
              <Input
                value={technicianQuery}
                onFocus={() => setIsTechnicianListOpen(true)}
                onChange={(e) => {
                  setTechnicianQuery(e.target.value);
                  setIsTechnicianListOpen(true);
                  setFormData({ ...formData, tecnicoId: "" });
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsTechnicianListOpen(false);
                  }, 120);
                }}
                placeholder="Buscar y seleccionar líder o técnico"
                className="bg-secondary/50 border-border/50"
              />
              {isTechnicianListOpen && (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                  {filteredTechnicians.length > 0 ? (
                    filteredTechnicians.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleTechnicianSelect(user)}
                        className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-secondary/60"
                      >
                        {user.nombre} {user.apellido}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No se encontraron líderes o técnicos.
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
