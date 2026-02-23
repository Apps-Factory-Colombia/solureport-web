"use client";

import { useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
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
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Building2,
  Mail,
  Phone,
  CalendarClock,
} from "lucide-react";
import { Client } from "@/lib/types";
import { mockClients, mockMaintenances } from "@/lib/data/mock-data";
import { cn } from "@/lib/utils";

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>(mockClients);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const filteredClients = clients.filter(
    (c) =>
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.edificio.toLowerCase().includes(search.toLowerCase()) ||
      c.contacto.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = (clientData: Partial<Client>) => {
    if (editingClient) {
      setClients((prev) =>
        prev.map((c) =>
          c.id === editingClient.id ? { ...c, ...clientData } : c
        )
      );
    } else {
      setClients((prev) => [...prev, clientData as Client]);
    }
    setEditingClient(null);
  };

  const handleDelete = (id: string) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
  };

  const getMaintenanceCount = (clientId: string) =>
    mockMaintenances.filter((m) => m.clienteId === clientId).length;

  return (
    <div>
      <AdminHeader title="Gestión de Clientes" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
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
                  <TableHead className="text-muted-foreground">Contacto</TableHead>
                  <TableHead className="text-muted-foreground">Dirección</TableHead>
                  <TableHead className="text-muted-foreground">Frecuencia</TableHead>
                  <TableHead className="text-muted-foreground">Mantenimientos</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  <TableHead className="text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
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
                      <div className="flex items-center gap-1.5 text-sm text-foreground/80">
                        <CalendarClock className="h-3.5 w-3.5 text-cyan-neon" />
                        Cada {client.frecuenciaMantenimiento} meses
                      </div>
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
                            onClick={() => handleDelete(client.id)}
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
          </CardContent>
        </Card>
      </div>

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editingClient}
        onSave={handleSave}
      />
    </div>
  );
}
