# Plan de corrección — Punto 3

## Alcance

Este documento cubre las inconsistencias de métricas, mantenimientos vencidos,
exportaciones y liquidaciones entre `solureport-web`, `solureport-app` y la base
V2 de Supabase. La implementación del punto 3 quedó aplicada en la API V2 y en
los módulos web que consumen esos datos. No se modificaron datos productivos ni
se eliminaron registros.

## Diagnóstico confirmado

### 3.1 Contador de mantenimientos realizados

Actualmente existen tres fuentes distintas:

1. El dashboard web carga `mantenimientos_programados` y calcula “Realizados”
   contando únicamente filas cuya fecha programada pertenece al mes actual y
   cuyo estado es `realizado` o `completado`.
   Referencia: `app/admin/page.tsx`, cálculo de `maintenancesThisMonth` y
   `realizados`.
2. Los reportes de mantenimiento viven en `actividades_operativas`. El endpoint
   `reports.list` devuelve esas actividades, incluyendo estados
   `completada`/`aprobada`, y expande una fila por participante.
   Referencia: `app/api/data/route.ts`, `activityRows`, `mapReportRows`.
3. La app y el resumen técnico de liquidación leen `liquidacion_items` mediante
   `liquidation.items` y `liquidation.summary`.

La consulta de auditoría en Supabase V2, con fecha de Bogotá `2026-08-30`,
encontró:

- 71 mantenimientos programados con estado `ejecutado`.
- 97 actividades de mantenimiento con estado `completada` o `aprobada`.
- En agosto: 19 actividades de mantenimiento, pero solo 1 mantenimiento
  programado ejecutado.
- Hay 2 filas de agenda con `fecha_realizado` informado pero estado distinto de
  completado/ejecutado, y 9 filas ejecutadas/completadas sin `fecha_realizado`.

Por eso el contador no representa los reportes realizados y puede no cambiar
cuando se entrega un reporte. La transacción de `submitMaintenanceParticipant`
actualiza la agenda cuando todos los participantes tienen entrega, pero los
registros históricos o importados que no tienen relación con una agenda no
pueden ser reconciliados por el contador actual.

La pantalla de inicio móvil también llama “Progreso del Día” a la cantidad de
filas devueltas por toda la agenda asignada; no filtra explícitamente el día
antes de calcular el total.

### 3.2 Mantenimientos vencidos

La fuente del listado web sí carga todas las filas, pero el filtro de vencidos
solo acepta mantenimientos cuyo estado sea exactamente `pendiente`, porque
`canScheduleMaintenance` devuelve falso para `programado`/`asignado`.
Además, el cálculo se hace en el navegador usando la fecha local y el listado
inicia con el filtro del mes actual.

La regla de negocio esperada debe ser: fecha programada anterior a la fecha
actual de Bogotá y estado no terminal. Los estados `pendiente`, `programado`,
`asignado`, `en_ejecucion` y `en_progreso` son incompletos; `ejecutado`,
`completado` y `cancelado` no deben entrar.

La auditoría encontró 41 mantenimientos vencidos incompletos:

- 5 con estado `pendiente`.
- 36 con estado `programado`.

Con el filtro actual, el panel solo puede mostrar una fracción de esos 41. La
misma causa explica que el badge y el listado puedan diferir. También se
encontró una fila de agenda con fecha realizada pero estado pendiente, que debe
ser marcada como inconsistencia de datos y no ocultarse silenciosamente.

### 3.3 Diferencia entre PDF mensual y quincenas

La diferencia reportada de 19 contra 17 es reproducible por el rango, no por
dos códigos duplicados:

- El exportador mensual de preventivos filtra todas las actividades de
  `2026-08-01` a `2026-08-31`.
- Los dos cortes existentes cubren `2026-08-04` a `2026-08-17` y
  `2026-08-18` a `2026-08-31`.
- Hay una actividad de mantenimiento completada el `2026-08-02` y otra el
  `2026-08-03`; ambas están en el período anterior (`2026-07-19` a
  `2026-08-03`).
- Por ello, el mensual incluye 19 y las dos quincenas de agosto incluyen 17.

La diferencia de fuente sigue siendo un riesgo adicional: el PDF de informes
se construye desde `reports` y agrupa filas en el cliente, mientras la app y el
resumen financiero web no usan exactamente el mismo conjunto de
`liquidacion_items`. En la auditoría del corte `2026-08-04` a `2026-08-17` se
observaron 357 actividades, 457 participantes y 428 items de liquidación; en
`2026-08-18` a `2026-08-31`, 231 actividades, 320 participantes y 308 items.
Esto no es necesariamente duplicación: una actividad puede tener varios
participantes, pero demuestra que no se puede sumar indistintamente actividad,
participante e item.

### 3.4 Caché y reactividad

`dataRequest` usa `cache: "no-store"`, así que el problema principal no es una
respuesta HTTP cacheada. Es estado local y consultas independientes:

- Dashboard: refresca cada 30 segundos, pero no espera ni cancela la petición
  anterior; una respuesta lenta puede sobrescribir una más nueva.
- Mantenimientos, informes y liquidación web: cargan al montar la página y
  refetch solo después de algunas acciones locales. No hay invalidación global
  ni refetch al volver a enfocar la pestaña.
- Informes y liquidación cargan `reports.list` sin filtros de rango, junto con
  subconsultas JSON correlacionadas para participantes, evidencias,
  aprobaciones y liquidaciones. Es una carga grande e innecesaria para cada
  pantalla.
- La app sí usa `useFocusEffect` en varias pantallas, pero mantiene dos
  endpoints financieros diferentes y no tiene un identificador de versión de
  datos para descartar respuestas viejas.

El linter de rendimiento de Supabase también reporta claves foráneas públicas
sin índice de cobertura y la existencia de objetos `legacy_backup`. No son la
causa del descuadre numérico, pero deben considerarse en la fase de
optimización después de un `EXPLAIN ANALYZE` de las consultas nuevas.

## Diseño objetivo

### 1. Definir una única semántica de conteo

Separar explícitamente:

- **Actividad realizada:** `COUNT(DISTINCT actividad_id)`.
- **Participación liquidable:** `COUNT(*)` de `liquidacion_items` por técnico.
- **Mantenimiento de agenda realizado:** `COUNT(DISTINCT mantenimiento_programado_id)`
  con reporte completado/aprobado o agenda en estado terminal.
- **Valor:** sumar una sola vez por participación para pago y una sola vez por
  actividad para valor técnico/cliente, según el reporte solicitado.

No se debe volver a usar una lista de participantes como si fuera una lista de
actividades.

### 2. Crear una lectura canónica en la API

Agregar endpoints V2 de solo lectura que reciban rango y zona horaria lógica:

- `dashboard.metrics`: contadores y valores con una respuesta única.
- `maintenances.overdue`: total y filas paginadas con la regla de estados
  incompletos.
- `liquidation.periodSummary`: actividades, participaciones, descuentos,
  recorridos y total a pagar desde el mismo conjunto de datos.
- `reports.export`: mismo DTO usado por la interfaz y por los generadores PDF.

La API debe calcular la fecha actual con
`(now() AT TIME ZONE 'America/Bogota')::date`, usar intervalos inclusivos
`[fecha_inicio, fecha_fin]` y devolver en la respuesta el rango aplicado,
`generatedAt` y una versión/marca `updatedAt` para trazabilidad.

### 3. Reconciliar el ciclo de mantenimiento

En una transacción idempotente:

1. Crear o reutilizar una sola actividad por mantenimiento programado.
2. Crear o reutilizar una participación por técnico.
3. Registrar la entrega y evidencias del técnico.
4. Marcar la agenda como ejecutada únicamente cuando la regla de cierre lo
   indique, guardando `fecha_realizado`.
5. Crear o actualizar el item de liquidación del período correcto.

Los reportes históricos sin relación con agenda no deben inventarse ni
duplicarse. Deben quedar identificados como históricos/no vinculados y el
dashboard debe indicar si el contador es de agenda o de reportes operativos.

### 4. Unificar la liquidación web, app y PDF

La web y la app deben consumir el mismo resumen canónico de período. El detalle
debe conservar el nivel de participación, pero el total de actividades debe
usar `DISTINCT actividad_id`. El PDF debe recibir ese mismo conjunto ya
filtrado, no reconstruir un segundo conjunto mensual en el navegador.

Para evitar la confusión 19/17 se debe mostrar el rango de cada exportación y
un desglose explícito de fechas fuera de los cortes seleccionados. Si se pide
“agosto”, debe ser un informe mensual completo; si se pide “quincenas”, debe
ser la suma de los períodos, sin mezclar el período anterior.

### 5. Reactividad y rendimiento

- Después de cada mutación de actividad, mantenimiento, aprobación, contrato o
  período, invalidar las lecturas relacionadas y refetch del resumen.
- En web, agregar refetch al recuperar foco/visibilidad y un guard de versión o
  request sequence para que una respuesta antigua no sobrescriba una nueva.
- En app, mantener `useFocusEffect`, pero hacer que el refresco use el resumen
  canónico y descarte respuestas si la pantalla ya fue desmontada o cambió el
  período.
- Cambiar cargas globales por consultas paginadas y filtradas por período,
  tipo, estado y técnico.
- Conservar `cache: "no-store"` para operaciones críticas; el cache de cliente
  solo debe utilizarse con invalidación explícita.
- Medir con `EXPLAIN (ANALYZE, BUFFERS)` y agregar únicamente los índices que
  demuestre la consulta canónica que necesita.

## Orden de implementación

1. Agregar pruebas de diagnóstico y consultas canónicas sin modificar datos.
2. Implementar `dashboard.metrics` y `maintenances.overdue`; conectar primero
   dashboard y vencidos.
3. Implementar `liquidation.periodSummary` y reemplazar el cálculo duplicado de
   la web y la app.
4. Reutilizar el DTO canónico en todos los PDFs y exportaciones.
5. Agregar invalidación/refetch y control contra respuestas fuera de orden.
6. Ejecutar reconciliación controlada solo de filas históricas, con vista previa,
   respaldo y aprobación; nunca eliminar ni fusionar información financiera de
   forma automática.

## Pruebas de aceptación

### Contador

- Entregar una actividad nueva y verificar que el contador de actividades
  realizadas aumenta exactamente en uno.
- Entregarla dos veces o reintentar la petición y verificar que no aumenta dos
  veces.
- Completar un mantenimiento con dos técnicos y comprobar que cuenta una
  actividad/mantenimiento, pero dos participaciones liquidables.

### Vencidos

- Crear/seleccionar una agenda vencida en estado `programado` y comprobar que
  aparece en el badge y en el listado.
- Cambiarla a `ejecutado` y comprobar que desaparece de ambos.
- Comparar el total del endpoint con `COUNT(*)` de la consulta canónica en
  Supabase usando la fecha de Bogotá.

### Exportación y períodos

- Para agosto, verificar que el informe mensual explica 19: 17 de los dos
  cortes actuales y 2 del período anterior.
- Exportar cada quincena y comprobar que el PDF y la tabla muestran el mismo
  número, códigos, fechas y total.
- Verificar que una actividad con dos técnicos aparece una vez como actividad,
  y sus dos participaciones solo en el detalle/liquidación.

### Reactividad

- Abrir dashboard, informes y liquidación en dos pestañas; aprobar o completar
  un registro en una y volver a la otra. El resumen debe actualizarse sin
  recarga forzada.
- Cambiar el rango de un período y verificar que tabla, totales y PDF cambian
  juntos.
- Simular una petición lenta y comprobar que una respuesta vieja no reemplaza
  la respuesta más reciente.

## Criterio de cierre

El punto 3 se considera resuelto cuando dashboard, mantenimientos, informes,
liquidación web, liquidación móvil y PDF consuman la misma definición de rango,
estado, actividad única, participación y valor; y las pruebas anteriores
produzcan los mismos resultados antes y después de recargar o cambiar de
pantalla.

## Implementación aplicada

- `dashboard.metrics` calcula en PostgreSQL el rango del mes actual en Bogotá,
  reportes de mantenimiento realizados, agenda, pendientes, vencidos y
  técnicos activos; el dashboard web ya no suma listas locales para esos
  indicadores.
- `maintenances.overdue` usa fecha/estado canónicos en servidor e incluye todos
  los estados incompletos, no solo `pendiente`. El badge y la tabla web usan la
  misma respuesta.
- `liquidation.periodSummary` consolida por técnico desde `liquidacion_items`,
  incluyendo descuentos, recorridos y extra líder. La liquidación web usa ese
  resultado; la app continúa usando `liquidation.summary` y
  `liquidation.leader`, que comparten la misma fuente y regla de cálculo.
- `reports.export` devuelve una fila por actividad base, conservando los
  participantes dentro de la actividad. El reporte mensual preventivo dejó de
  reconstruir su lista desde una carga diferente.
- Dashboard, mantenimientos, informes y liquidación web vuelven a consultar al
  recuperar el foco de la ventana. Los botones de exportación muestran estado
  de carga y no permiten generar el PDF mientras la fuente consolidada está
  actualizándose.
- Se actualizó el cálculo de extra líder para considerar todos los grupos
  activos del líder, evitando diferencias entre la app y la web cuando un líder
  pertenece a más de un grupo.
