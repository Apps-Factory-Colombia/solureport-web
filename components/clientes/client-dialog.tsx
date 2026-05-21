"use client";

import { useState, useEffect } from "react";
import { Client } from "@/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client | null;
  onSave: (client: Partial<Client>) => void;
}

function getInitialFormData(client?: Client | null) {
  return {
    nombre: client?.nombre || "",
    nitCedula: client?.nitCedula || "",
    edificio: client?.edificio || "",
    direccion: client?.direccion || "",
    contacto: client?.contacto || "",
    correo: client?.correo || "",
    correoAliado: client?.correoAliado || "",
    telefono: client?.telefono || "",
    estado: client?.estado || ("activo" as "activo" | "inactivo"),
  };
}

export function ClientDialog({
  open,
  onOpenChange,
  client,
  onSave,
}: ClientDialogProps) {
  const [formData, setFormData] = useState(() => getInitialFormData(client));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFormData(getInitialFormData(client));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [client, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      id: client?.id || `c${Date.now()}`,
      fechaCreacion:
        client?.fechaCreacion || new Date().toISOString().split("T")[0],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {client ? "Editar Cliente" : "Nuevo Cliente"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label className="text-foreground/80">Nombre</Label>
              <Input
                value={formData.nombre}
                onChange={(e) =>
                  setFormData({ ...formData, nombre: e.target.value })
                }
                placeholder="Ej: Edificio Torres del Parque"
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">NIT o Cédula</Label>
              <Input
                value={formData.nitCedula}
                onChange={(e) =>
                  setFormData({ ...formData, nitCedula: e.target.value })
                }
                placeholder="Ej: 900123456-7"
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Edificio</Label>
              <Input
                value={formData.edificio}
                onChange={(e) =>
                  setFormData({ ...formData, edificio: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Nombre del administrador</Label>
              <Input
                value={formData.contacto}
                onChange={(e) =>
                  setFormData({ ...formData, contacto: e.target.value })
                }
                placeholder="Ej: Martha López (Administración)"
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Dirección</Label>
            <Input
              value={formData.direccion}
              onChange={(e) =>
                setFormData({ ...formData, direccion: e.target.value })
              }
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Correo</Label>
              <Input
                type="email"
                value={formData.correo}
                onChange={(e) =>
                  setFormData({ ...formData, correo: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Correo del aliado</Label>
              <Input
                type="email"
                value={formData.correoAliado}
                onChange={(e) =>
                  setFormData({ ...formData, correoAliado: e.target.value })
                }
                placeholder="Opcional"
                className="bg-secondary/50 border-border/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Teléfono directo del contacto</Label>
              <Input
                value={formData.telefono}
                onChange={(e) =>
                  setFormData({ ...formData, telefono: e.target.value })
                }
                placeholder="Ej: 3001234567"
                className="bg-secondary/50 border-border/50"
                required
              />

            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
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
              {client ? "Guardar Cambios" : "Crear Cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
