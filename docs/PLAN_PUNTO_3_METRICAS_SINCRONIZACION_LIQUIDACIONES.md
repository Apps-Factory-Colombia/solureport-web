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

## Auditoría adicional — Aprobaciones → Liquidación

Fecha de revisión: `2026-10-31`. La revisión se hizo sobre el período abierto
`2026-10-17` a `2026-10-31` y las consultas de base fueron únicamente de lectura.

### Evidencia confirmada

- Hay 403 actividades no canceladas: 98 actividades, 20 mantenimientos, 234
  recorridos y 51 visitas técnicas.
- Hay 566 participaciones. En esas filas se encontraron 19 diferencias de
  porcentaje entre `actividades_operativas_participantes` y `liquidacion_items`,
  y 34 diferencias de valor ganado original. A nivel de actividad, son 9 y 21
  actividades afectadas respectivamente.
- 56 actividades tienen `valor_aplicado` diferente de `valor_base`. En las
  visitas técnicas son 11 casos.
- Existen 8 participaciones de mantenimientos pendientes sin fila persistida de
  liquidación. El endpoint puede mostrar una fila de respaldo para algunos casos,
  pero esa fila no corrige el dato persistido.
- `VT-20261021-CD3ENQFX` tiene base de `$15.000`, aplicado de `$20.000` y la
  participación guarda `$20.000`; sin embargo, `liquidacion_items.valor_base`
  continúa en `$15.000`. La regla de compatibilidad de liquidación vuelve a
  calcular el pago desde esa base y lo muestra como `$15.000`.
- `VT-20261023-GIZ8X3J0` tiene participantes en 100%/0% mientras sus filas de
  liquidación tienen 50%/50%. La interfaz puede mostrar un reparto reconstruido
  que no coincide con lo almacenado.
- Hay 52 visitas técnicas registradas en el período; 51 no están canceladas.
  Las 51 no canceladas tienen fila en `actividades_operativas_visitas` y ninguna
  tiene fila en `actividades_operativas_recorridos`. Por lo tanto, actualmente no
  quedan en Recorridos.

### Causas encontradas en el código

1. El guardado actual escribe `valor_aplicado` en la actividad, `porcentaje` y
   `valor_ganado` en el participante, y `valor_ganado_original`/`valor_ganado`
   en la liquidación. No actualiza simultáneamente `liquidacion_items.valor_base`
   ni `liquidacion_items.porcentaje`. La consulta de liquidación usa esas columnas
   antiguas para decidir si debe aplicar el cálculo de compatibilidad.
2. Al crear una actividad que no es recorrido, el valor del participante se
   calcula con `valor_base`, aunque exista un `valor_aplicado` diferente. Esto
   deja diferencias desde la creación y obliga a una corrección posterior.
3. `mapReport` marca `valorModificado` de forma explícita para recorridos, pero no
   para visitas técnicas cuando `valor_aplicado` difiere de `valor_base`. La
   pantalla puede volver a tomar el valor predeterminado al recargar.
4. Aprobaciones normaliza algunos repartos en memoria. Informes conserva otra
   identidad de visita y guarda el costo compartido sin enviar los porcentajes y
   valores de cada participante. Por eso una pantalla puede mostrar 50/50 y la
   base seguir en 100/0.
5. `updateApproval` ejecuta varias operaciones independientes para actividades
   que no son mantenimiento. La aprobación de una actividad compartida dispara
   varias peticiones en paralelo. Un error o una carrera puede dejar aprobaciones,
   entregas, participantes, estado de actividad y liquidación en estados distintos.
6. Si llega un identificador compuesto sin participante válido, la API puede caer
   silenciosamente en el participante principal. Eso permite guardar el cambio en
   la persona equivocada.
7. El servicio de actualización devuelve `void` y Aprobaciones actualiza la
   interfaz de forma optimista. El mensaje de éxito se muestra antes de comprobar
   que la lectura canónica devuelva exactamente los mismos valores. Además,
   `refreshReports` no tiene guard de secuencia; una respuesta anterior puede
   sobrescribir la lectura posterior al cambiar de período.
8. Informes mantiene cambios locales de costo cliente y costo técnico sin una
   lectura posterior. En visitas compartidas puede quedar una fila actualizada y
   otra con el valor anterior.
9. El icono `$` del valor por técnico está centrado respecto a toda la fila del
   grid, que es más alta por el nombre y subtítulo del técnico. Por eso sale del
   input. El contenedor del campo debe tener altura propia y alineación al inicio.

## Ampliación del plan solicitada — mostrar visitas dentro de Recorridos

Las visitas técnicas seguirán guardadas como `visita_tecnica`. No se cambiará el
tipo en `actividades_operativas`, no se moverán filas de base de datos, no se
creará una tabla nueva y no se modificarán las liquidaciones existentes por este
requisito.

### Ajuste de presentación en el frontend

1. Mantener `visita_tecnica` como tipo real para conservar la identidad,
   aprobaciones, participantes, evidencias, códigos y liquidación actual.
2. En Aprobaciones e Informes, incluir las visitas técnicas dentro del conjunto
   visual de Recorridos mediante una función de clasificación compartida.
3. Mostrar el texto con el prefijo `Recorrido vista: ` seguido de la descripción
   original. La descripción no se debe reemplazar ni guardar nuevamente en la
   base; se transforma únicamente al renderizar.
4. Mantener el código de registro original (`VT-...`) y el ID real de la visita.
   El prefijo solicitado aplica a la presentación, no a la identidad persistida.
5. Evitar que la misma visita aparezca dos veces: debe salir en la sección visual
   de Recorridos y dejar de mostrarse en la pestaña visual independiente de
   Visitas Técnicas cuando el filtro sea Recorridos.
6. Aplicar la misma regla a tablas, filtros, búsqueda, modal de detalle,
   exportaciones y etiquetas del PDF que se generen desde el frontend.

### Reglas que no se deben alterar

- La API seguirá devolviendo `tipo = 'visita_tecnica'`.
- `actividades_operativas_visitas` continuará siendo la fila de detalle de la
  visita.
- `liquidacion_items.tipo` y sus valores seguirán siendo de visita técnica.
- Las visitas no comenzarán a contar como recorridos financieros, no cambiarán
  descuentos de tardanza y no afectarán el extra líder solo por aparecer en la
  sección visual Recorridos.
- Las reglas de valor, aprobación, reparto, evidencias y cliente se corrigen en
  sus fuentes actuales, sin duplicar ni convertir la actividad.

### Orden del siguiente cambio

1. Unificar identidad y respuesta canónica de costo/reparto entre Aprobaciones,
   Informes y Liquidación.
2. Guardar en una transacción el valor aplicado, base, porcentaje, valor original,
   valor neto y estado de cada participante y su `liquidacion_item`.
3. Validar siempre el participante compuesto y rechazar identificadores ambiguos;
   eliminar el fallback silencioso al participante principal.
4. Aprobar o rechazar una actividad compartida en una sola transacción y devolver
   la fila canónica guardada.
5. Corregir las inconsistencias del período abierto antes de congelarlo: valores
   20.000/15.000, porcentajes de reparto y filas de liquidación faltantes.
6. Cambiar la clasificación visual del frontend para que las visitas se presenten
   como `Recorrido vista: <descripción>` dentro de Recorridos, sin tocar la base.
7. Corregir el `$` del reparto técnico, limpiar estados locales después de guardar
   y refetch con control de versión/período.

### Criterios de aceptación adicionales

- Cambiar una visita de `$15.000` a `$20.000`, recargar Aprobaciones, Informes y
  Liquidación y obtener `$20.000` en las tres pantallas.
- Guardar un reparto 50/50 y comprobar 50/50 en participantes, liquidación y
  acumulados, después de recargar.
- Aprobar o rechazar una visita compartida y comprobar que todas sus filas cambian
  juntas o ninguna cambia.
- Ver una visita técnica dentro de Recorridos con el texto `Recorrido vista: ` y
  su descripción original, sin crear otra actividad ni modificar su registro.
- Confirmar que la visita sigue apareciendo como visita técnica para las reglas
  económicas, descuentos, aprobaciones y liquidación.

## Plan preventivo — evitar que el desfase vuelva a ocurrir

El objetivo es que Aprobaciones nunca confirme un cambio que Liquidación no pueda
leer después. La prevención se basa en que cada guardado tenga una única operación
canónica, sea verificable y no permita continuar cuando sus filas relacionadas no
queden alineadas.

### Reglas de integridad obligatorias

1. **Una actividad, una identidad:** la agrupación se hará únicamente con el ID
   de `actividades_operativas` y el ID de `actividades_operativas_participantes`.
   Fecha, descripción, cliente y código solo serán datos de respaldo visual; nunca
   decidirán que dos actividades son la misma.
2. **Un valor canónico:** para un período abierto, el valor aprobado será
   `actividades_operativas.valor_aplicado`. El pago de cada técnico será ese valor
   multiplicado por su porcentaje, menos el descuento aplicable. No se permitirá
   recalcular un valor aprobado desde una base antigua.
3. **Reparto cerrado:** los porcentajes deben sumar 100%, los valores de los
   participantes deben sumar el valor aplicado y cada participante debe tener una
   fila de liquidación correspondiente.
4. **Espejo exacto:** después de guardar, cada participante y su
   `liquidacion_item` deben coincidir en porcentaje, base, valor original, valor
   neto y estado.
5. **Aprobación consistente:** una actividad compartida se aprueba o rechaza
   completa dentro de una sola transacción. No se aceptan estados mixtos.
6. **Período protegido:** las filas de períodos cerrados no se recalculan ni se
   modifican. Los cambios solo se permiten en el período abierto correspondiente.
7. **Visita visual:** una visita continuará siendo `visita_tecnica` en la base y
   solo tendrá el alias visual `Recorrido vista: <descripción>` en el frontend.

### Cambios preventivos en la API existente

1. Extender `reports.cost` para que, dentro de su transacción actual, bloquee la
   actividad y todos sus participantes, valide el conjunto completo y actualice
   simultáneamente actividad, participantes y `liquidacion_items`.
2. Persistir también `liquidacion_items.valor_base` y
   `liquidacion_items.porcentaje`; no dejar campos financieros derivados con el
   valor anterior.
3. Devolver desde `reports.cost` la proyección canónica guardada, en lugar de
   devolver solamente `true` o `void`.
4. Mantener el cálculo de compatibilidad únicamente para filas históricas
   identificadas. Una fila guardada por el flujo actual debe usar siempre el valor
   aplicado actual.
5. Rechazar el guardado si falta un participante, si el ID compuesto no coincide
   con la actividad o si el reparto no cuadra. Nunca seleccionar automáticamente
   al participante principal.
6. Extender `reports.approval` para procesar todos los participantes de una
   actividad compartida dentro de una sola transacción, conservando el endpoint
   existente.
7. Reparar la fila de liquidación del período abierto dentro de la misma
   transacción. Solo se insertará una fila cuando falte exactamente la combinación
   única `periodo_id + actividad_id + participante_id`; nunca se creará otra
   actividad para solucionar un desfase.
8. Registrar `version` de la actividad en la mutación y rechazar una actualización
   si otra persona guardó una versión más nueva. Así se evita que el último clic
   sobrescriba silenciosamente un cambio reciente.

### Cambios preventivos en Aprobaciones, Informes y Liquidación

1. Eliminar la confirmación basada solo en estado local. Después de guardar, leer
   la respuesta canónica y comparar valor total, porcentajes y valores por técnico.
2. Mostrar éxito únicamente cuando la lectura confirmada coincida; si no coincide,
   mostrar el desfase y mantener el modal abierto.
3. Usar el mismo helper de identidad y la misma normalización de visitas en
   Aprobaciones e Informes.
4. Al cambiar de período, limpiar las filas anteriores, bloquear acciones durante
   la carga y descartar respuestas fuera de orden mediante un contador de solicitud.
5. Refrescar la actividad después de guardar costo técnico, reparto, costo cliente,
   aprobación, rechazo o reactivación. El refresco debe conservar el ID real
   seleccionado.
6. Mantener las visitas en la sección visual Recorridos con `Recorrido vista: `,
   pero conservar en los DTO el tipo `visita_tecnica` para que Liquidación y
   acumulados no cambien sus reglas.
7. Corregir el contenedor del campo monetario del reparto con altura propia y
   alineación al inicio para que `$` siempre quede dentro del input.

### Reconciliación y bloqueo antes de cerrar el período

Antes de cerrar el período abierto, el flujo debe comprobar:

- ninguna actividad aprobada con valor aplicado diferente al valor liquidado;
- ningún participante sin `liquidacion_item`;
- porcentajes y valores que sumen correctamente;
- estados de aprobación, participante y liquidación iguales;
- ninguna fila con identificador compuesto ambiguo;
- ninguna visita duplicada visualmente en Recorridos.

Si una validación falla, el período no se debe cerrar y Aprobaciones debe mostrar el
registro que necesita corrección. La reconciliación se limita al período abierto;
no se modifican períodos anteriores.

### Casos de aceptación para los errores reportados

1. Cambiar `$15.000` a `$20.000`, guardar, recargar cada pantalla y comprobar
   `$20.000` en Aprobaciones, Informes y Liquidación.
2. Cambiar un técnico de un reparto compartido y comprobar que los demás no vuelven
   a estado anterior después de guardar o aprobar.
3. Guardar 50%/50% y comprobar el mismo reparto en participantes, liquidación y
   acumulados tras cerrar y abrir el modal.
4. Aprobar una actividad compartida y comprobar que todos sus participantes,
   entregas, aprobaciones y liquidaciones cambian juntos.
5. Cambiar de período mientras se carga información y comprobar que una respuesta
   lenta no reemplaza los datos del período seleccionado.
6. Mostrar una visita en Recorridos como `Recorrido vista: <descripción>` sin
   cambiar su tipo, código, valor, aprobación ni liquidación en la base.

## Principios de conservación y no regresión

Este trabajo será una corrección puntual sobre el código actual. Se conservará lo
que ya funciona y se evitarán cambios de modelo o de flujo que no sean necesarios
para los errores auditados.

### Lo que se mantiene

- Las tablas, IDs, códigos, tipos reales y relaciones actuales.
- Las actividades, participantes, evidencias, entregas, aprobaciones y
  liquidaciones ya existentes.
- Los períodos cerrados y sus fotografías congeladas.
- Las reglas económicas actuales de visitas técnicas.
- Los flujos actuales de creación, aprobación, rechazo, reactivación, correo y
  exportación, excepto las validaciones puntuales de integridad.
- La representación visual que ya funciona para actividades, mantenimientos y
  recorridos normales.

### Lo que no se hará

- No se crearán actividades nuevas para representar una visita.
- No se copiarán visitas a otra tabla ni se cambiarán a `recorrido` en la base.
- No se regenerarán códigos ni IDs.
- No se fusionarán actividades por coincidencia de fecha, cliente o descripción.
- No se recalcularán ni modificarán períodos anteriores.
- No se reemplazarán valores válidos del usuario por defaults de configuración.
- No se cambiarán reglas de pago por el hecho de mostrar una visita dentro de
  Recorridos.

### Salvaguardas antes de cada cambio

1. Leer la actividad por su ID real y bloquearla antes de actualizarla.
2. Verificar que la cantidad e identidad de participantes no cambió desde la
   lectura del frontend.
3. Actualizar las filas existentes con `UPDATE`; usar `INSERT` únicamente para
   una fila de liquidación faltante y protegida por su clave única.
4. Confirmar que la transacción no aumentó el número de actividades ni creó un
   código nuevo.
5. Volver a leer la misma actividad y comparar sus valores antes de cerrar el
   modal o mostrar el mensaje de éxito.
6. Si alguna comparación falla, hacer rollback, conservar el formulario abierto y
   mostrar el registro que requiere atención.

### Criterio de cierre sin regresiones

El cambio se considera correcto solo si corrige los casos actuales y, al mismo
tiempo, demuestra que:

- la cantidad de actividades no aumenta por un guardado;
- una visita conserva su mismo ID, código y tipo real;
- una actividad con varios técnicos conserva exactamente sus participantes;
- las evidencias y aprobaciones existentes siguen asociadas a la misma actividad;
- los recorridos que ya funcionan mantienen su presentación y cálculo;
- un período cerrado permanece intacto;
- las pantallas muestran el mismo valor después de guardar, recargar y cambiar de
  módulo.
