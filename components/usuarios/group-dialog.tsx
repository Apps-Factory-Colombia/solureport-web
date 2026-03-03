"use client";

import { useState, useEffect } from "react";
import { WorkGroup, User } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: WorkGroup | null;
  availableTechnicians: User[];
  onSave: (group: Partial<WorkGroup>) => void;
}

export function GroupDialog({
  open,
  onOpenChange,
  group,
  availableTechnicians,
  onSave,
}: GroupDialogProps) {
  const [nombre, setNombre] = useState("");
  const [liderId, setLiderId] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    if (group) {
      setNombre(group.nombre);
      setLiderId(group.liderId);
      setSelectedMembers(group.miembros);
    } else {
      setNombre("");
      setLiderId("");
      setSelectedMembers([]);
    }
  }, [group, open]);

  const handleToggleMember = (userId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : prev.length < 5
          ? [...prev, userId]
          : prev
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMembers.length < 2 || selectedMembers.length > 5) return;

    const finalMembers = selectedMembers.includes(liderId)
      ? selectedMembers
      : [liderId, ...selectedMembers];

    onSave({
      id: group?.id || `g${Date.now()}`,
      nombre,
      liderId,
      miembros: finalMembers,
      estado: "activo",
      fechaCreacion:
        group?.fechaCreacion || new Date().toISOString().split("T")[0],
    });
    onOpenChange(false);
  };

  const activeUsers = availableTechnicians.filter((u) => u.estado === "activo");

  const leaderOptions = activeUsers.filter(
    (u) => u.rol === "lider" || u.esLider
  );

  const memberOptions = activeUsers.filter(
    (u) => u.rol === "tecnico" || u.rol === "lider" || u.esLider
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {group ? "Editar Grupo" : "Nuevo Grupo de Trabajo"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground/80">Nombre del Grupo</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Equipo Alpha"
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Líder del Grupo</Label>
            <Select value={liderId} onValueChange={setLiderId}>
              <SelectTrigger className="bg-secondary/50 border-border/50">
                <SelectValue placeholder="Seleccionar líder" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {leaderOptions.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.nombre} {tech.apellido}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">
              Miembros ({selectedMembers.length}/5)
            </Label>
            <p className="text-xs text-muted-foreground">
              Mínimo 2, máximo 5 miembros por grupo
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedMembers.map((memberId) => {
                const member = memberOptions.find((t) => t.id === memberId);
                return (
                  <Badge
                    key={memberId}
                    variant="outline"
                    className="bg-gold/10 text-gold border-gold/20 gap-1"
                  >
                    {member?.nombre} {member?.apellido}
                    <button
                      type="button"
                      onClick={() => handleToggleMember(memberId)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2 rounded-lg border border-border/50 bg-secondary/30 p-3">
              {memberOptions.map((tech) => (
                <div
                  key={tech.id}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id={`member-${tech.id}`}
                    checked={selectedMembers.includes(tech.id)}
                    onCheckedChange={() => handleToggleMember(tech.id)}
                    disabled={
                      !selectedMembers.includes(tech.id) &&
                      selectedMembers.length >= 5
                    }
                  />
                  <label
                    htmlFor={`member-${tech.id}`}
                    className="text-sm text-foreground/80 cursor-pointer"
                  >
                    {tech.nombre} {tech.apellido}
                  </label>
                </div>
              ))}
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
              disabled={selectedMembers.length < 2 || !liderId || !nombre}
              className="bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {group ? "Guardar Cambios" : "Crear Grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
