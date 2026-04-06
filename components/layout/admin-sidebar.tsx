"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Building2,
  CalendarClock,
  FileText,
  BookOpen,
  DollarSign,
  Settings,
  LogOut,
  ChevronLeft,
  ScrollText,
  Clock,
  ClipboardCheck,
  Star,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/context/auth-context";
import { SoluReportLogo } from "@/components/shared/solureport-logo";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { warmAdminRouteData } from "@/lib/admin/prefetch";

const menuItems = [
  {
    title: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "Usuarios",
    href: "/admin/usuarios",
    icon: Users,
  },
  {
    title: "Clientes",
    href: "/admin/clientes",
    icon: Building2,
  },
  {
    title: "Contratos",
    href: "/admin/contratos",
    icon: ScrollText,
  },
  {
    title: "Mantenimientos",
    href: "/admin/mantenimientos",
    icon: CalendarClock,
  },
  {
    title: "Aprobaciones",
    href: "/admin/aprobaciones",
    icon: ClipboardCheck,
  },
  {
    title: "Informes Técnicos",
    href: "/admin/informes",
    icon: FileText,
  },
  {
    title: "Catálogo",
    href: "/admin/catalogo",
    icon: BookOpen,
  },
  {
    title: "Liquidación",
    href: "/admin/liquidacion",
    icon: DollarSign,
  },
  {
    title: "Acumulados Líder",
    href: "/admin/acumulados",
    icon: Star,
  },
  {
    title: "Asistencia",
    href: "/admin/llegadas",
    icon: Clock,
  },
  {
    title: "Configuración",
    href: "/admin/configuracion",
    icon: Settings,
  },
  {
    title: "Depuración",
    href: "/admin/depuracion",
    icon: ShieldAlert,
  },
];

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AdminSidebar({ collapsed, onToggle }: AdminSidebarProps) {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/admin" className="flex items-center gap-3">
          <SoluReportLogo size="sm" showText={!collapsed} />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform duration-300",
              collapsed && "rotate-180"
            )}
          />
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      <ScrollArea className="flex-1 py-4">
        <nav className="flex flex-col gap-1 px-3">
          {menuItems.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);

            const linkContent = (
              <Link
                key={item.href}
                href={item.href}
                onMouseEnter={() => warmAdminRouteData(item.href)}
                onFocus={() => warmAdminRouteData(item.href)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-gold/10 text-gold glow-gold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    isActive ? "text-gold" : "text-muted-foreground"
                  )}
                />
                {!collapsed && <span>{item.title}</span>}
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-gold" />
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" className="bg-card border-border">
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-sidebar-border" />

      <div className="p-3">
        {!collapsed && user && (
          <div className="mb-3 rounded-lg bg-sidebar-accent/50 p-3">
            <p className="text-sm font-medium text-foreground">
              {user.nombre} {user.apellido}
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={logout}
              className={cn(
                "w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10",
                collapsed && "justify-center px-0"
              )}
            >
              <LogOut className="h-5 w-5 shrink-0" />
              {!collapsed && "Cerrar Sesión"}
            </Button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right" className="bg-card border-border">
              Cerrar Sesión
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
