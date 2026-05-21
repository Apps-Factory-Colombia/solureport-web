"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { ClientDialog } from "@/components/clientes/client-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Building2,
  Mail,
  Phone,
  Loader2,
} from "lucide-react";
import { Client } from "@/lib/types";
import { getClientes, createCliente, updateCliente, deleteCliente } from "@/lib/supabase/services/clientes";
import { getMantenimientos } from "@/lib/supabase/services/mantenimientos";
import { Maintenance } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([getClientes(), getMantenimientos()]);
      setClients(c);
      setMaintenances(m);
    } catch (err) {
      console.error("Error cargando clientes:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredClients = clients.filter(
    (c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.edificio.toLowerCase().includes(search.toLowerCase()) ||
      c.contacto.toLowerCase().includes(search.toLowerCase()) ||
      c.nitCedula.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentClients = filteredClients.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const handleSave = async (clientData: Partial<Client>) => {
    try {
      if (editingClient) {
        await updateCliente(editingClient.id, clientData);
      } else {
        await createCliente(clientData);
      }
      setEditingClient(null);
      await loadData();
    } catch (err) {
      console.error("Error guardando cliente:", err);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingClientId(id);
    try {
      await deleteCliente(id);
      setClientToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando cliente:", err);
      const message = err instanceof Error
        ? err.message
        : "No se pudo eliminar el cliente. Verifica relaciones activas.";
      alert(message);
    } finally {
      setDeletingClientId(null);
    }
  };

  const getMaintenanceCount = (clientId: string) =>
    maintenances.filter((m) => m.clienteId === clientId).length;

  if (loading) {
    return (
      <div>
        <AdminHeader title="Gestión de Clientes" />
        <AdminPageLoader
          title="Cargando clientes"
          message="Estamos preparando el directorio de clientes y su actividad asociada."
          showStats={false}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Gestión de Clientes" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, NIT o administrador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Button
            onClick={() => {
              setEditingClient(null);
              setDialogOpen(true);
            }}
            className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            Nuevo Cliente
          </Button>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Cliente</TableHead>
                  <TableHead className="text-muted-foreground">NIT / Cédula</TableHead>
                  <TableHead className="text-muted-foreground">Contacto</TableHead>
                  <TableHead className="text-muted-foreground">Dirección</TableHead>
                  <TableHead className="text-muted-foreground">Mantenimientos</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  <TableHead className="text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentClients.map((client) => (
                  <TableRow
                    key={client.id}
                    className="border-border/50 hover:bg-secondary/30"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-neon/10">
                          <Building2 className="h-4 w-4 text-cyan-neon" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {client.edificio}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {client.nombre}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-foreground/80">
                      {client.nitCedula || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm text-foreground/80">
                          {client.contacto}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {client.correo}
                          </span>
                        </div>
                        {client.correoAliado && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            Aliado: {client.correoAliado}
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {client.telefono}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                      {client.direccion}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-gold/10 text-gold border-gold/20 text-xs"
                      >
                        {getMaintenanceCount(client.id)} registros
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          client.estado === "activo"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}
                      >
                        {client.estado === "activo" ? "Activo" : "Inactivo"}
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
                              setEditingClient(client);
                              setDialogOpen(true);
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setClientToDelete(client)}
                            className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
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
      </div>

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSave}
      />

      <Dialog
        open={!!clientToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingClientId) setClientToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que quieres eliminar el cliente <strong>{clientToDelete?.edificio || clientToDelete?.nombre}</strong>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setClientToDelete(null)}
              disabled={!!deletingClientId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => clientToDelete && handleDelete(clientToDelete.id)}
              disabled={!!deletingClientId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingClientId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingClientId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deletingClientId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando cliente...</p>
          </div>
        </div>
      )}
    </div>
  );
}
