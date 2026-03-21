"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { ActivityDialog } from "@/components/catalogo/activity-dialog";
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
  History,
} from "lucide-react";
import { Activity } from "@/lib/types";
import { getActividades, createActividad, updateActividad, deleteActividad } from "@/lib/supabase/services/actividades";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function CatalogoPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyActivity, setHistoryActivity] = useState<Activity | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getActividades();
      setActivities(data);
    } catch (err) {
      console.error("Error cargando actividades:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = activities.filter(
    (a) =>
      a.codigo.toLowerCase().includes(search.toLowerCase()) ||
      a.descripcion.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentActivities = filtered.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const handleSave = async (data: Partial<Activity>) => {
    try {
      if (editingActivity) {
        await updateActividad(editingActivity.id, data);
      } else {
        await createActividad(data);
      }
      setEditingActivity(null);
      await loadData();
    } catch (err) {
      console.error("Error guardando actividad:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteActividad(id);
      await loadData();
    } catch (err) {
      console.error("Error eliminando actividad:", err);
    }
  };

  if (loading) {
    return (
      <div>
        <AdminHeader title="Catálogo de Actividades" />
        <AdminPageLoader
          title="Cargando catálogo"
          message="Estamos preparando las actividades y sus valores configurados."
          showStats={false}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Catálogo de Actividades" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar actividad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Button
            onClick={() => {
              setEditingActivity(null);
              setDialogOpen(true);
            }}
            className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            Nueva Actividad
          </Button>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Código</TableHead>
                  <TableHead className="text-muted-foreground">Descripción</TableHead>
                  <TableHead className="text-muted-foreground">Valor</TableHead>
                  <TableHead className="text-muted-foreground">Cambios</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  <TableHead className="text-muted-foreground w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentActivities.map((activity) => (
                  <TableRow
                    key={activity.id}
                    className="border-border/50 hover:bg-secondary/30"
                  >
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20 text-xs font-mono"
                      >
                        {activity.codigo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-foreground/80 max-w-80">
                      {activity.descripcion}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-semibold text-gold">
                        {formatCurrency(activity.valorEconomico)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {activity.historialPrecios.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setHistoryActivity(activity);
                            setHistoryOpen(true);
                          }}
                          className="gap-1.5 text-xs text-cyan-neon hover:text-cyan-neon"
                        >
                          <History className="h-3.5 w-3.5" />
                          {activity.historialPrecios.length} cambio(s)
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin cambios</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          activity.estado === "activo"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}
                      >
                        {activity.estado === "activo" ? "Activo" : "Inactivo"}
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
                        <DropdownMenuContent align="end" className="bg-card border-border">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingActivity(activity);
                              setDialogOpen(true);
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(activity.id)}
                            className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" /> Eliminar
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

      <ActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        activity={editingActivity}
        onSave={handleSave}
      />

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Historial de Precios - {historyActivity?.codigo}
            </DialogTitle>
          </DialogHeader>
          {historyActivity && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {historyActivity.descripcion}
              </p>
              <div className="space-y-2">
                {historyActivity.historialPrecios.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 p-3"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">{entry.fecha}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-red-400 line-through">
                          {formatCurrency(entry.valorAnterior)}
                        </span>
                        <span className="text-sm text-foreground/50">→</span>
                        <span className="text-sm font-semibold text-gold">
                          {formatCurrency(entry.valorNuevo)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground">Valor actual</p>
                <p className="text-lg font-bold text-gold">
                  {formatCurrency(historyActivity.valorEconomico)}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
