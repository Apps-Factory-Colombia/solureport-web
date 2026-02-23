"use client";

import { useState, useEffect } from "react";
import { Activity } from "@/lib/types";
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

interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity?: Activity | null;
  onSave: (activity: Partial<Activity>) => void;
}

export function ActivityDialog({
  open,
  onOpenChange,
  activity,
  onSave,
}: ActivityDialogProps) {
  const [formData, setFormData] = useState({
    codigo: "",
    descripcion: "",
    valorEconomico: 0,
    estado: "activo" as "activo" | "inactivo",
  });

  useEffect(() => {
    if (activity) {
      setFormData({
        codigo: activity.codigo,
        descripcion: activity.descripcion,
        valorEconomico: activity.valorEconomico,
        estado: activity.estado,
      });
    } else {
      setFormData({
        codigo: "",
        descripcion: "",
        valorEconomico: 0,
        estado: "activo",
      });
    }
  }, [activity, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const historialPrecios = activity
      ? activity.valorEconomico !== formData.valorEconomico
        ? [
            ...activity.historialPrecios,
            {
              fecha: new Date().toISOString().split("T")[0],
              valorAnterior: activity.valorEconomico,
              valorNuevo: formData.valorEconomico,
            },
          ]
        : activity.historialPrecios
      : [];

    onSave({
      ...formData,
      id: activity?.id || `a${Date.now()}`,
      historialPrecios,
      fechaCreacion:
        activity?.fechaCreacion || new Date().toISOString().split("T")[0],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {activity ? "Editar Actividad" : "Nueva Actividad"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground/80">Código</Label>
            <Input
              value={formData.codigo}
              onChange={(e) =>
                setFormData({ ...formData, codigo: e.target.value })
              }
              placeholder="Ej: ACT-008"
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Descripción</Label>
            <Textarea
              value={formData.descripcion}
              onChange={(e) =>
                setFormData({ ...formData, descripcion: e.target.value })
              }
              placeholder="Descripción de la actividad..."
              className="bg-secondary/50 border-border/50 min-h-[80px]"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Valor Económico (COP)</Label>
              <Input
                type="number"
                value={formData.valorEconomico}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    valorEconomico: Number(e.target.value),
                  })
                }
                className="bg-secondary/50 border-border/50"
                min={0}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Estado</Label>
              <Select
                value={formData.estado}
                onValueChange={(v: "activo" | "inactivo") =>
                  setFormData({ ...formData, estado: v })
                }
              >
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
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
              {activity ? "Guardar Cambios" : "Crear Actividad"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
