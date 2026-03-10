"use client";

import { useState, useEffect } from "react";
import { User, UserRole, UserScheduleDraft, UserStatus } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { SCHEDULE_DAYS, UserScheduleEditor } from "@/components/usuarios/user-schedule-editor";

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
  onSave: (user: Partial<User> & { password?: string; horarios?: UserScheduleDraft[] }) => void;
}

function buildDefaultHorarios(user?: User | null): UserScheduleDraft[] {
  const currentSchedules = new Map((user?.horarios || []).map((horario) => [horario.diaSemana, horario]));

  return SCHEDULE_DAYS.map((day) => {
    const existing = currentSchedules.get(day.value);
    return {
      diaSemana: day.value,
      activo: existing?.activo ?? day.defaultActive,
      horaEntrada: existing?.horaEntrada || user?.horaEntrada || "07:00",
      horaSalida: existing?.horaSalida || user?.horaSalida || "17:00",
    };
  });
}

export function UserDialog({ open, onOpenChange, user, onSave }: UserDialogProps) {
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    rol: "tecnico" as UserRole,
    estado: "activo" as UserStatus,
    esLider: false,
    tieneRecorrido: false,
    tieneMoto: false,
    esSupervisor: false,
    horarios: buildDefaultHorarios(),
    password: "",
  });

  useEffect(() => {
    if (user) {
      setFormData({
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        telefono: user.telefono,
        rol: user.rol,
        estado: user.estado,
        esLider: user.esLider || false,
        tieneRecorrido: user.tieneRecorrido || false,
        tieneMoto: user.tieneMoto || false,
        esSupervisor: user.esSupervisor || false,
        horarios: buildDefaultHorarios(user),
        password: "",
      });
    } else {
      setFormData({
        nombre: "",
        apellido: "",
        email: "",
        telefono: "",
        rol: "tecnico",
        estado: "activo",
        esLider: false,
        tieneRecorrido: false,
        tieneMoto: false,
        esSupervisor: false,
        horarios: buildDefaultHorarios(),
        password: "",
      });
    }
  }, [user, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const shouldSendSchedules = formData.rol === "tecnico" || formData.rol === "lider";
    const activeSchedules = formData.horarios.filter((horario) => horario.activo);

    if (shouldSendSchedules) {
      for (const horario of activeSchedules) {
        if (!horario.horaEntrada || !horario.horaSalida) {
          alert(`Debes configurar hora de entrada y salida para ${horario.diaSemana}.`);
          return;
        }
      }
    }

    const payload: Partial<User> & { password?: string; horarios?: UserScheduleDraft[] } = {
      id: user?.id || `u${Date.now()}`,
      nombre: formData.nombre,
      apellido: formData.apellido,
      email: formData.email,
      telefono: formData.telefono,
      rol: formData.rol,
      estado: formData.estado,
      esLider: formData.esLider,
      tieneRecorrido: formData.tieneRecorrido,
      tieneMoto: formData.tieneMoto,
      esSupervisor: formData.esSupervisor,
      horarios: shouldSendSchedules ? formData.horarios : [],
      fechaCreacion: user?.fechaCreacion || new Date().toISOString().split("T")[0],
      password: formData.password,
    };

    if (user && !formData.password.trim()) {
      delete payload.password;
    }

    onSave(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {user ? "Editar Usuario" : "Nuevo Usuario"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Nombre</Label>
              <Input
                value={formData.nombre}
                onChange={(e) =>
                  setFormData({ ...formData, nombre: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Apellido</Label>
              <Input
                value={formData.apellido}
                onChange={(e) =>
                  setFormData({ ...formData, apellido: e.target.value })
                }
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Correo electrónico</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Teléfono</Label>
            <Input
              value={formData.telefono}
              onChange={(e) =>
                setFormData({ ...formData, telefono: e.target.value })
              }
              className="bg-secondary/50 border-border/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Contraseña</Label>
            <Input
              type="password"
              value={formData.password}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              className="bg-secondary/50 border-border/50"
              placeholder={user ? "Dejar en blanco para mantener la actual" : "Mínimo 6 caracteres"}
              minLength={6}
              required={!user}
            />
            <p className="text-xs text-muted-foreground">
              {user
                ? "Solo se actualiza si escribes una nueva contraseña"
                : "La contraseña debe tener al menos 6 caracteres"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-foreground/80">Rol</Label>
              <Select
                value={formData.rol}
                onValueChange={(value: UserRole) =>
                  setFormData({
                    ...formData,
                    rol: value,
                    esLider: value === "lider" ? true : formData.esLider,
                  })
                }
              >
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="lider">Líder</SelectItem>
                  <SelectItem value="tecnico">Técnico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Estado</Label>
              <Select
                value={formData.estado}
                onValueChange={(value: UserStatus) =>
                  setFormData({ ...formData, estado: value })
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

          {(formData.rol === "tecnico" || formData.rol === "lider") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
                <div>
                  <Label className="text-foreground/80">Líder de Grupo</Label>
                  <p className="text-xs text-muted-foreground">
                    Habilitar permisos de líder de grupo
                  </p>
                </div>
                <Switch
                  checked={formData.esLider}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, esLider: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
                <div>
                  <Label className="text-foreground/80">Supervisor</Label>
                  <p className="text-xs text-muted-foreground">
                    Asignar función de supervisor
                  </p>
                </div>
                <Switch
                  checked={formData.esSupervisor}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, esSupervisor: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3">
                <div>
                  <Label className="text-foreground/80">Recorrido con Moto</Label>
                  <p className="text-xs text-muted-foreground">
                    El técnico tiene moto para recorridos
                  </p>
                </div>
                <Switch
                  checked={formData.tieneMoto}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, tieneMoto: checked, tieneRecorrido: checked ? formData.tieneRecorrido : false })
                  }
                />
              </div>
              {formData.tieneMoto && (
                <div className="flex items-center justify-between rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3">
                  <div>
                    <Label className="text-foreground/80">Recorrido Habilitado</Label>
                    <p className="text-xs text-muted-foreground">
                      Habilitar compensación por rodamiento
                    </p>
                  </div>
                  <Switch
                    checked={formData.tieneRecorrido}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, tieneRecorrido: checked })
                    }
                  />
                </div>
              )}

              <UserScheduleEditor
                horarios={formData.horarios}
                onChange={(horarios) => setFormData({ ...formData, horarios })}
              />
            </div>
          )}

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
              {user ? "Guardar Cambios" : "Crear Usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
