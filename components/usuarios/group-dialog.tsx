"use client";

import { useState } from "react";
import { WorkGroup, User } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X } from "lucide-react";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: WorkGroup | null;
  availableTechnicians: User[];
  onSave: (group: Partial<WorkGroup>) => Promise<void> | void;
}

function buildInitialMembers(group?: WorkGroup | null) {
  return group?.miembros || [];
}

function buildInitialReporters(group?: WorkGroup | null) {
  return group?.reporterosIds || group?.miembros || [];
}

interface GroupDialogFormProps {
  group?: WorkGroup | null;
  availableTechnicians: User[];
  onOpenChange: (open: boolean) => void;
  onSave: (group: Partial<WorkGroup>) => Promise<void> | void;
}

function GroupDialogForm({
  group,
  availableTechnicians,
  onOpenChange,
  onSave,
}: GroupDialogFormProps) {
  const [nombre, setNombre] = useState(group?.nombre || "");
  const [liderId, setLiderId] = useState(group?.liderId || "");
  const [selectedMembers, setSelectedMembers] = useState<string[]>(buildInitialMembers(group));
  const [selectedReporters, setSelectedReporters] = useState<string[]>(buildInitialReporters(group));
  const [memberSearch, setMemberSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const totalMembers = Array.from(new Set(liderId ? [liderId, ...selectedMembers] : selectedMembers));
  const hasValidMemberCount = totalMembers.length >= 1;
  const activeUsers = availableTechnicians.filter((user) => user.estado === "activo");

  // Cualquier usuario operativo puede asumir o dejar de asumir el liderazgo
  // del grupo. El rol de la cuenta no debe ocultarlo del selector.
  const leaderOptions = activeUsers.filter((user) => user.rol !== "admin");

  const memberOptions = activeUsers.filter(
    (user) => user.rol !== "admin"
  );

  const filteredMemberOptions = memberOptions.filter((user) => {
    const fullName = `${user.nombre} ${user.apellido}`.toLowerCase();
    return fullName.includes(memberSearch.trim().toLowerCase());
  });

  const reporterOptions = totalMembers
    .map((memberId) => memberOptions.find((user) => user.id === memberId))
    .filter(Boolean) as User[];

  const filteredReporterOptions = reporterOptions.filter((user) => {
    const fullName = `${user.nombre} ${user.apellido}`.toLowerCase();
    return fullName.includes(memberSearch.trim().toLowerCase());
  });

  const selectedMemberUsers = selectedMembers
    .map((memberId) => memberOptions.find((user) => user.id === memberId))
    .filter(Boolean) as User[];

  const selectedReporterUsers = selectedReporters
    .map((reporterId) => reporterOptions.find((user) => user.id === reporterId))
    .filter(Boolean) as User[];

  const handleToggleMember = (userId: string) => {
    setSelectedMembers((prevMembers) => {
      const nextMembers = prevMembers.includes(userId)
        ? prevMembers.filter((id) => id !== userId)
        : [...prevMembers, userId];
      const nextTotalMembers = Array.from(new Set(liderId ? [liderId, ...nextMembers] : nextMembers));

      setSelectedReporters((prevReporters) => {
        const filteredReporters = prevReporters.filter((id) => nextTotalMembers.includes(id));

        if (!prevMembers.includes(userId) && !filteredReporters.includes(userId)) {
          filteredReporters.push(userId);
        }

        return filteredReporters;
      });

      return nextMembers;
    });
  };

  const handleToggleReporter = (userId: string) => {
    setSelectedReporters((prevReporters) =>
      prevReporters.includes(userId)
        ? prevReporters.filter((id) => id !== userId)
        : [...prevReporters, userId]
    );
  };

  const handleLeaderChange = (nextLeaderId: string) => {
    const normalizedLeaderId = nextLeaderId === "__sin_lider__" ? "" : nextLeaderId;
    const nextTotalMembers = Array.from(new Set(normalizedLeaderId ? [normalizedLeaderId, ...selectedMembers] : selectedMembers));

    setLiderId(normalizedLeaderId);
    setSelectedReporters((prevReporters) => {
      const filteredReporters = prevReporters.filter((id) => nextTotalMembers.includes(id));

      if (normalizedLeaderId && !filteredReporters.includes(normalizedLeaderId)) {
        filteredReporters.push(normalizedLeaderId);
      }

      return filteredReporters;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !hasValidMemberCount || !nombre) return;

    setSaving(true);
    setSaveError("");
    try {
      await onSave({
      id: group?.id || `g${Date.now()}`,
      nombre,
      liderId,
      miembros: totalMembers,
      reporterosIds: selectedReporters.filter((userId) => totalMembers.includes(userId)),
      estado: "activo",
      fechaCreacion: group?.fechaCreacion || new Date().toISOString().split("T")[0],
      });
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar el grupo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 max-h-[85vh] flex-1 flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle className="text-foreground">
          {group ? "Editar Grupo" : "Nuevo Grupo de Trabajo"}
        </DialogTitle>
      </DialogHeader>

      {saveError && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {saveError}
        </div>
      )}

      <ScrollArea className="mt-4 min-h-0 flex-1 pr-4">
        <div className="space-y-5 pb-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <div className="space-y-2 rounded-xl border border-border/50 bg-secondary/20 p-4">
              <Label className="text-foreground/80">Nombre del Grupo</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Equipo Alpha"
                className="bg-secondary/50 border-border/50"
                required
              />
            </div>

            <div className="space-y-2 rounded-xl border border-border/50 bg-secondary/20 p-4">
              <Label className="text-foreground/80">Líder del Grupo</Label>
              <Select value={liderId || "__sin_lider__"} onValueChange={handleLeaderChange} disabled={saving}>
                <SelectTrigger className="bg-secondary/50 border-border/50">
                  <SelectValue placeholder="Seleccionar líder" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="__sin_lider__">Sin líder</SelectItem>
                  {leaderOptions.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.nombre} {user.apellido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border/50 bg-secondary/20 p-4">
            <Label className="text-foreground/80">Buscar Usuario</Label>
            <Input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Buscar por nombre"
              className="bg-secondary/50 border-border/50"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-3 rounded-xl border border-gold/20 bg-gold/5 p-4">
              <div>
                <Label className="text-foreground/90">Miembros ({totalMembers.length})</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  El líder cuenta como miembro. Administra aquí quién pertenece al grupo.
                </p>
              </div>

              <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gold">Seleccionados</p>
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {selectedMemberUsers.length > 0 ? selectedMemberUsers.map((member) => (
                    <Badge
                      key={member.id}
                      variant="outline"
                      className="bg-gold/10 text-gold border-gold/20 gap-1"
                    >
                      {member.nombre} {member.apellido}
                      <button
                        type="button"
                        onClick={() => handleToggleMember(member.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )) : (
                    <p className="text-sm text-muted-foreground">No hay miembros seleccionados.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gold">Disponibles</p>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {filteredMemberOptions.length > 0 ? (
                    filteredMemberOptions.map((user) => (
                      <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50">
                        <Checkbox
                          id={`member-${user.id}`}
                          checked={selectedMembers.includes(user.id)}
                          onCheckedChange={() => handleToggleMember(user.id)}
                        />
                        <label
                          htmlFor={`member-${user.id}`}
                          className="text-sm text-foreground/80 cursor-pointer"
                        >
                          {user.nombre} {user.apellido}
                        </label>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No se encontraron miembros con esa búsqueda.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-cyan-neon/20 bg-cyan-neon/5 p-4">
              <div>
                <Label className="text-foreground/90">Quién Puede Reportar Actividades ({selectedReporters.length})</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Si dejas a todos seleccionados, el grupo conserva el comportamiento por defecto.
                </p>
              </div>

              <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-cyan-neon">Autorizados</p>
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {selectedReporterUsers.length > 0 ? selectedReporterUsers.map((reporter) => (
                    <Badge
                      key={reporter.id}
                      variant="outline"
                      className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 gap-1"
                    >
                      {reporter.nombre} {reporter.apellido}
                      <button
                        type="button"
                        onClick={() => handleToggleReporter(reporter.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )) : (
                    <p className="text-sm text-muted-foreground">No hay usuarios autorizados.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-cyan-neon">Miembros Elegibles</p>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {filteredReporterOptions.length > 0 ? (
                    filteredReporterOptions.map((user) => (
                      <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50">
                        <Checkbox
                          id={`reporter-${user.id}`}
                          checked={selectedReporters.includes(user.id)}
                          onCheckedChange={() => handleToggleReporter(user.id)}
                        />
                        <label
                          htmlFor={`reporter-${user.id}`}
                          className="text-sm text-foreground/80 cursor-pointer"
                        >
                          {user.nombre} {user.apellido}
                        </label>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Agrega miembros al grupo para definir quién puede reportar.</p>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter className="sticky bottom-0 z-10 mt-4 shrink-0 border-t border-border/50 bg-card pt-4">
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
          disabled={saving || !hasValidMemberCount || !nombre}
          className="bg-gold hover:bg-gold-dark text-background font-semibold"
        >
          {saving ? "Guardando…" : group ? "Guardar Cambios" : "Crear Grupo"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function GroupDialog({
  open,
  onOpenChange,
  group,
  availableTechnicians,
  onSave,
}: GroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] min-h-0 flex-col overflow-hidden bg-card border-border sm:max-w-5xl">
        <GroupDialogForm
          key={`${group?.id || "new"}-${open ? "open" : "closed"}`}
          group={group}
          availableTechnicians={availableTechnicians}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}
