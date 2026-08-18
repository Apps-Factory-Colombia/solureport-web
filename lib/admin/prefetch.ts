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
    "/admin/depuracion",
];

const coreWarmers: Warmer[] = [
    () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
    () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
    () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
    () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
];

const routeWarmers: Record<string, Warmer[]> = {
    "/admin": [
        () => import("@/lib/data/services/mantenimientos").then((module) => module.getMantenimientos()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getReportesActividad()),
    ],
    "/admin/usuarios": [
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
    ],
    "/admin/clientes": [
        () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/data/services/mantenimientos").then((module) => module.getMantenimientos()),
    ],
    "/admin/contratos": [
        () => import("@/lib/data/services/contratos").then((module) => module.getContratos()),
        () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
    ],
    "/admin/mantenimientos": [
        () => import("@/lib/data/services/mantenimientos").then((module) => module.getMantenimientos()),
        () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
    ],
    "/admin/aprobaciones": [
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/informes": [
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/clientes").then((module) => module.getClientes()),
        () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/catalogo": [
        () => import("@/lib/data/services/actividades").then((module) => module.getActividades()),
    ],
    "/admin/liquidacion": [
        () => import("@/lib/data/services/liquidacion").then((module) => module.getPeriodos()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getAcumulacionesLider()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/data/services/llegadas").then((module) => module.getLlegadas()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/acumulados": [
        () => import("@/lib/data/services/liquidacion").then((module) => module.getPeriodos()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getAcumulacionesLider()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getLotesAprobacion()),
        () => import("@/lib/data/services/reportes-actividad").then((module) => module.getReportesActividad()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/grupos").then((module) => module.getGrupos()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/llegadas": [
        () => import("@/lib/data/services/llegadas").then((module) => module.getLlegadas()),
        () => import("@/lib/data/services/usuarios").then((module) => module.getUsuarios()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
    ],
    "/admin/configuracion": [
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
        () => import("@/lib/data/services/liquidacion").then((module) => module.getPeriodos()),
    ],
    "/admin/depuracion": [
        () => import("@/lib/data/services/liquidacion").then((module) => module.getPeriodos()),
        () => import("@/lib/data/services/configuracion").then((module) => module.getConfiguracion()),
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