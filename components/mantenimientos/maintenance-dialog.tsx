"use client";

import { useState, useEffect } from "react";
import { Maintenance, MaintenanceStatus } from "@/lib/types";
import { mockClients, mockUsers } from "@/lib/data/mock-data";
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
    estado: "programado" as MaintenanceStatus,
    observaciones: "",
  });

  const technicians = mockUsers.filter(
    (u) => u.rol === "tecnico" && u.estado === "activo"
  );
  const clients = mockClients.filter((c) => c.estado === "activo");

  useEffect(() => {
    if (maintenance) {
      setFormData({
        clienteId: maintenance.clienteId,
        tecnicoId: maintenance.tecnicoId,
        fechaProgramada: maintenance.fechaProgramada,
        estado: maintenance.estado,
        observaciones: maintenance.observaciones || "",
      });
    } else {
      setFormData({
        clienteId: "",
        tecnicoId: "",
        fechaProgramada: "",
        estado: "programado",
        observaciones: "",
      });
    }
  }, [maintenance, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const client = mockClients.find((c) => c.id === formData.clienteId);
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
            <Label className="text-foreground/80">Técnico Asignado</Label>
            <Select
              value={formData.tecnicoId}
              onValueChange={(v) =>
                setFormData({ ...formData, tecnicoId: v })
              }
            >
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue placeholder="Seleccionar técnico" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {technicians.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre} {t.apellido}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Observaciones</Label>
            <Textarea
              value={formData.observaciones}
              onChange={(e) =>
                setFormData({ ...formData, observaciones: e.target.value })
              }
              placeholder="Observaciones del mantenimiento..."
              className="bg-secondary/50 border-border/50 min-h-[80px]"
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
