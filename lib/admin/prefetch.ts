type Warmer = () => Promise<unknown>;

const adminRoutes = [
    "/admin",
    "/admin/usuarios",
    "/admin/clientes",
    "/admin/contratos",
    "/admin/mantenimientos",
    "/admin/aprobaciones",
    "/admin/informes",
    "/admin/catalogo",
    "/admin/liquidacion",
    "/admin/acumulados",
    "/admin/llegadas",
    "/admin/configuracion",
];

const coreWarmers: Warmer[] = [
    () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
    () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
    () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
    () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
];

const routeWarmers: Record<string, Warmer[]> = {
    "/admin": [
        () => import("@/lib/supabase/services/mantenimientos").then((module) => module.getMantenimientos()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getReportesActividad()),
    ],
    "/admin/usuarios": [
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
    ],
    "/admin/clientes": [
        () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/supabase/services/mantenimientos").then((module) => module.getMantenimientos()),
    ],
    "/admin/contratos": [
        () => import("@/lib/supabase/services/contratos").then((module) => module.getContratos()),
        () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
    ],
    "/admin/mantenimientos": [
        () => import("@/lib/supabase/services/mantenimientos").then((module) => module.getMantenimientos()),
        () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
    ],
    "/admin/aprobaciones": [
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/informes": [
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/catalogo": [
        () => import("@/lib/supabase/services/actividades").then((module) => module.getActividades()),
    ],
    "/admin/liquidacion": [
        () => import("@/lib/supabase/services/liquidacion").then((module) => module.getPeriodos()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getAcumulacionesLider()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/supabase/services/llegadas").then((module) => module.getLlegadas()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/acumulados": [
        () => import("@/lib/supabase/services/liquidacion").then((module) => module.getPeriodos()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getAcumulacionesLider()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getLotesAprobacion()),
        () => import("@/lib/supabase/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/llegadas": [
        () => import("@/lib/supabase/services/llegadas").then((module) => module.getLlegadas()),
        () => import("@/lib/supabase/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/configuracion": [
        () => import("@/lib/supabase/services/configuracion").then((module) => module.getConfiguracion()),
        () => import("@/lib/supabase/services/liquidacion").then((module) => module.getPeriodos()),
    ],
};

function runWarmers(warmers: Warmer[]) {
    void Promise.allSettled(warmers.map((warmer) => warmer()));
}

function getBestMatchingRoute(pathname: string) {
    return Object.keys(routeWarmers)
        .sort((left, right) => right.length - left.length)
        .find((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function warmAdminCoreData() {
    runWarmers(coreWarmers);
}

export function warmAdminRouteData(pathname: string) {
    const matchedRoute = getBestMatchingRoute(pathname);
    if (!matchedRoute) return;

    runWarmers(routeWarmers[matchedRoute]);
}

export function prefetchAdminRoutes(router: { prefetch: (href: string) => void }) {
    adminRoutes.forEach((route) => router.prefetch(route));
}