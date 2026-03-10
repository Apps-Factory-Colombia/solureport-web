"use client";

import { ScheduleDay, UserScheduleDraft } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const SCHEDULE_DAYS: Array<{ value: ScheduleDay; label: string; defaultActive: boolean }> = [
  { value: "lunes", label: "Lunes", defaultActive: true },
  { value: "martes", label: "Martes", defaultActive: true },
  { value: "miercoles", label: "Miércoles", defaultActive: true },
  { value: "jueves", label: "Jueves", defaultActive: true },
  { value: "viernes", label: "Viernes", defaultActive: true },
  { value: "sabado", label: "Sábado", defaultActive: false },
  { value: "domingo", label: "Domingo", defaultActive: false },
];

interface UserScheduleEditorProps {
  horarios: UserScheduleDraft[];
  onChange: (horarios: UserScheduleDraft[]) => void;
}

export function UserScheduleEditor({ horarios, onChange }: UserScheduleEditorProps) {
  const updateHorario = (diaSemana: ScheduleDay, updates: Partial<UserScheduleDraft>) => {
    const nextHorarios = horarios.map((horario) => {
      if (horario.diaSemana !== diaSemana) return horario;
      return { ...horario, ...updates };
    });
    onChange(nextHorarios);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/50 bg-secondary/10 p-4">
      <div className="space-y-1">
        <Label className="text-foreground/80">Configuración de horario por día</Label>
        <p className="text-xs text-muted-foreground">
          Define para cada día si el usuario trabaja y cuál es su hora de entrada y salida.
        </p>
      </div>

      <div className="space-y-3">
        {SCHEDULE_DAYS.map((day) => {
          const horario = horarios.find((item) => item.diaSemana === day.value);
          if (!horario) return null;

          return (
            <div key={day.value} className="rounded-xl border border-border/50 bg-card/70 p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">{day.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {horario.activo ? "Horario activo" : "Día sin jornada configurada"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Activo</span>
                  <Switch
                    checked={horario.activo}
                    onCheckedChange={(checked) => updateHorario(day.value, { activo: checked })}
                  />
                </div>
              </div>

              {horario.activo && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Hora de entrada</Label>
                      <Input
                        type="time"
                        value={horario.horaEntrada || ""}
                        onChange={(e) => updateHorario(day.value, { horaEntrada: e.target.value })}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-foreground/80">Hora de salida</Label>
                      <Input
                        type="time"
                        value={horario.horaSalida || ""}
                        onChange={(e) => updateHorario(day.value, { horaSalida: e.target.value })}
                        className="bg-secondary/50 border-border/50"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
