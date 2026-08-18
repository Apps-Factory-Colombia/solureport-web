"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { UserDialog } from "@/components/usuarios/user-dialog";
import { GroupDialog } from "@/components/usuarios/group-dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { getAvatarUrl } from "@/lib/utils/avatar";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
  Users,
  Shield,
  Crown,
  ShieldCheck,
  Bike,
  Route,
  Loader2,
} from "lucide-react";
import { User, UserScheduleDraft, WorkGroup } from "@/lib/types";
import { getUsuarios, createUsuario, updateUsuario, deleteUsuario } from "@/lib/data/services/usuarios";
import { getGrupos, createGrupo, updateGrupo, deleteGrupo } from "@/lib/data/services/grupos";
import { cn } from "@/lib/utils";

const rolLabels = {
  admin: { label: "Administrador", color: "bg-gold/10 text-gold border-gold/20" },
  tecnico: { label: "Técnico", color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20" },
  lider: { label: "Líder", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  supervisor: { label: "Supervisor", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
};

export default function UsuariosPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingGroup, setEditingGroup] = useState<WorkGroup | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<WorkGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [u, g] = await Promise.all([getUsuarios(), getGrupos()]);
      setUsers(u);
      setGroups(g);
    } catch (err) {
      console.error("Error cargando datos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredUsers = users.filter(
    (u) =>
      u.nombre.toLowerCase().includes(search.toLowerCase()) ||
      u.apellido.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentUsers = filteredUsers.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const handleSaveUser = async (userData: Partial<User> & { password?: string; horarios?: UserScheduleDraft[] }) => {
    if (editingUser) {
      await updateUsuario(editingUser.id, userData);
    } else {
      await createUsuario(userData);
    }
    await loadData();
    setEditingUser(null);
  };

  const handleDeleteGroup = async (id: string) => {
    setDeletingGroupId(id);
    try {
      await deleteGrupo(id);
      setGroupToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando grupo:", err);
      const message = err instanceof Error
        ? err.message
        : "No se pudo eliminar el grupo. Verifica relaciones activas.";
      alert(message);
    } finally {
      setDeletingGroupId(null);
    }
  };

  const handleDeleteUser = async (id: string) => {
    setDeletingUserId(id);
    try {
      await deleteUsuario(id);
      setUserToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando usuario:", err);
      const message = err instanceof Error
        ? err.message
        : "No se pudo eliminar el usuario. Verifica relaciones activas.";
      alert(message);
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleToggleStatus = async (id: string) => {
    const user = users.find((u) => u.id === id);
    if (!user) return;
    try {
      await updateUsuario(id, { estado: user.estado === "activo" ? "inactivo" : "activo" });
      await loadData();
    } catch (err) {
      console.error("Error cambiando estado:", err);
    }
  };

  const handleSaveGroup = async (groupData: Partial<WorkGroup>) => {
    try {
      if (editingGroup) {
        await updateGrupo(editingGroup.id, groupData);
      } else {
        await createGrupo(groupData);
      }
      setEditingGroup(null);
      await loadData();
    } catch (err) {
      console.error("Error guardando grupo:", err);
    }
  };

  if (loading) {
    return (
      <div>
        <AdminHeader title="Gestión de Usuarios" />
        <AdminPageLoader
          title="Cargando usuarios"
          message="Estamos preparando el listado de usuarios y grupos."
          showStats={false}
          rows={7}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Gestión de Usuarios" />
      <div className="p-6 space-y-6">
        <Tabs defaultValue="usuarios" className="space-y-6">
          <div className="flex items-center justify-between">
            <TabsList className="bg-secondary/50 border border-border/50">
              <TabsTrigger
                value="usuarios"
                className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
              >
                <Shield className="h-4 w-4 mr-2" />
                Usuarios
              </TabsTrigger>
              <TabsTrigger
                value="grupos"
                className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
              >
                <Users className="h-4 w-4 mr-2" />
                Grupos de Trabajo
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="usuarios" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuario..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-secondary/50 border-border/50"
                />
              </div>
              <Button
                onClick={() => {
                  setEditingUser(null);
                  setUserDialogOpen(true);
                }}
                className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
              >
                <Plus className="h-4 w-4" />
                Nuevo Usuario
              </Button>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Usuario</TableHead>
                      <TableHead className="text-muted-foreground">Correo</TableHead>
                      <TableHead className="text-muted-foreground">Teléfono</TableHead>
                      <TableHead className="text-muted-foreground">Rol</TableHead>
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentUsers.map((user) => {
                      const group = groups.find((g) =>
                        g.miembros.includes(user.id)
                      );
                      const displayRol = user.esLider ? "lider" : user.rol;
                      const rolConfig = rolLabels[displayRol] || rolLabels.tecnico;

                      return (
                        <TableRow
                          key={user.id}
                          className="border-border/50 hover:bg-secondary/30"
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 border border-border/50">
                                <AvatarImage src={getAvatarUrl(user.nombre, user.apellido, 36)} alt={`${user.nombre} ${user.apellido}`} />
                                <AvatarFallback className="bg-gold/10 text-gold text-xs">
                                  {user.nombre[0]}
                                  {user.apellido[0]}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-foreground flex items-center gap-1.5">
                                  {user.nombre} {user.apellido}
                                  {user.esLider && (
                                    <Crown className="h-3.5 w-3.5 text-gold" />
                                  )}
                                </p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  {user.esSupervisor && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-purple-500/10 text-purple-400 border-purple-500/20">
                                      <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />Sup.
                                    </Badge>
                                  )}
                                  {user.tieneMoto && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20">
                                      <Bike className="h-2.5 w-2.5 mr-0.5" />Moto
                                    </Badge>
                                  )}
                                  {user.tieneRecorrido && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                      <Route className="h-2.5 w-2.5 mr-0.5" />Rec.
                                    </Badge>
                                  )}
                                  {!user.esSupervisor && !user.tieneMoto && !user.tieneRecorrido && (
                                    <p className="text-xs text-muted-foreground">Desde {user.fechaCreacion}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {user.email}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {user.telefono}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn("text-xs", rolConfig.color)}
                            >
                              {rolConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {group?.nombre || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                user.estado === "activo"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border-red-500/20"
                              )}
                            >
                              {user.estado === "activo" ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="bg-card border-border"
                              >
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingUser(user);
                                    setUserDialogOpen(true);
                                  }}
                                  className="gap-2 cursor-pointer"
                                >
                                  <Pencil className="h-4 w-4" />
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleToggleStatus(user.id)}
                                  className="gap-2 cursor-pointer"
                                >
                                  {user.estado === "activo" ? (
                                    <>
                                      <UserX className="h-4 w-4" />
                                      Desactivar
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="h-4 w-4" />
                                      Activar
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setUserToDelete(user)}
                                  className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="p-4 border-t border-border/50 flex justify-end">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                        {Array.from({ length: totalPages }).map((_, i) => (
                          <PaginationItem key={i + 1}>
                            <PaginationLink
                              onClick={() => setCurrentPage(i + 1)}
                              isActive={currentPage === i + 1}
                              className="cursor-pointer"
                            >
                              {i + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="grupos" className="space-y-4">
            <div className="flex items-center justify-end">
              <Button
                onClick={() => {
                  setEditingGroup(null);
                  setGroupDialogOpen(true);
                }}
                className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
              >
                <Plus className="h-4 w-4" />
                Nuevo Grupo
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => {
                const leader = users.find((u) => u.id === group.liderId);
                const members = group.miembros
                  .map((id) => users.find((u) => u.id === id))
                  .filter(Boolean);
                const reporterCount = group.reporterosIds?.length ?? group.miembros.length;

                return (
                  <Card
                    key={group.id}
                    className="border-border/50 bg-card/80 backdrop-blur-sm hover:border-gold/20 transition-all duration-300"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg font-semibold text-foreground">
                          {group.nombre}
                        </CardTitle>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="bg-card border-border"
                          >
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingGroup(group);
                                setGroupDialogOpen(true);
                              }}
                              className="gap-2 cursor-pointer"
                            >
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setGroupToDelete(group)}
                              className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {leader && (
                        <div className="flex items-center gap-2 rounded-lg bg-gold/5 border border-gold/10 p-2">
                          <Crown className="h-4 w-4 text-gold" />
                          <span className="text-sm text-gold font-medium">
                            {leader.nombre} {leader.apellido}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-gold/10 text-gold border-gold/20 ml-auto"
                          >
                            Líder
                          </Badge>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {members.map(
                          (member) =>
                            member &&
                            member.id !== group.liderId && (
                              <div
                                key={member.id}
                                className="flex items-center gap-2 px-2 py-1.5"
                              >
                                <Avatar className="h-6 w-6 border border-border/50">
                                  <AvatarImage src={getAvatarUrl(member.nombre, member.apellido, 24)} alt={`${member.nombre} ${member.apellido}`} />
                                  <AvatarFallback className="bg-secondary text-xs text-muted-foreground">
                                    {member.nombre[0]}
                                    {member.apellido[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-sm text-foreground/80">
                                  {member.nombre} {member.apellido}
                                </span>
                              </div>
                            )
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-border/50">
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">
                            {group.miembros.length} miembros
                          </p>
                          <p className="text-xs text-cyan-neon/80">
                            {reporterCount} pueden reportar
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            group.estado === "activo"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-red-500/10 text-red-400 border-red-500/20"
                          )}
                        >
                          {group.estado === "activo" ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <UserDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        user={editingUser}
        onSave={handleSaveUser}
      />

      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        group={editingGroup}
        availableTechnicians={users}
        onSave={handleSaveGroup}
      />

      <Dialog
        open={!!userToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingUserId) setUserToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que quieres eliminar a <strong>{userToDelete?.nombre} {userToDelete?.apellido}</strong>? Esta acción también eliminará sus registros relacionados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setUserToDelete(null)}
              disabled={!!deletingUserId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => userToDelete && handleDeleteUser(userToDelete.id)}
              disabled={!!deletingUserId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingUserId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingUserId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!groupToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingGroupId) setGroupToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación de grupo</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que quieres eliminar el grupo <strong>{groupToDelete?.nombre}</strong>? Esta acción quitará también sus membresías.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setGroupToDelete(null)}
              disabled={!!deletingGroupId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => groupToDelete && handleDeleteGroup(groupToDelete.id)}
              disabled={!!deletingGroupId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingGroupId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingGroupId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deletingUserId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando usuario y sus datos relacionados...</p>
          </div>
        </div>
      )}

      {deletingGroupId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando grupo de trabajo...</p>
          </div>
        </div>
      )}
    </div>
  );
}
