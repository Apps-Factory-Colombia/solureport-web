# Plan de acción — Punto 2: contratos y usuarios

## Diagnóstico confirmado

La operación administrativa de SoluReport usa PostgreSQL V2 desde `app/api/data/route.ts`, pero varias acciones todavía conservan el comportamiento anterior:

1. `contracts.delete` ejecuta un `UPDATE` a `estado = 'cancelado'`; no elimina ni archiva de forma explícita.
2. `users.delete` ejecuta un `UPDATE` a `estado = 'inactivo'`; conserva asignaciones, relaciones y sesiones.
3. `contratos_cliente_anio_unique` es un índice único incondicional sobre `(cliente_id, anio)`. Por eso un contrato cancelado o cerrado bloquea la recreación del mismo cliente en ese año.
4. Crear un contrato inserta el contrato y después actualiza cada mantenimiento con llamadas separadas desde el navegador. Esto permite estados parciales, genera solicitudes concurrentes y puede dejar la pantalla esperando.
5. `updateContract` elimina solo mantenimientos `pendiente` y luego vuelve a generarlos. No calcula un diff estable del cronograma, no protege filas ejecutadas y no tiene una clave de regeneración por versión.
6. El formulario solicita `costoTotalAnual` manualmente. El valor calculado por puertas se muestra como referencia, pero no es la fuente del total guardado.
7. Existen tablas históricas con nombres parecidos en `public`; el plan se aplica únicamente a las tablas canónicas V2 (`contratos_mantenimiento`, `mantenimientos_programados`, `usuarios` y sus relaciones) hasta completar un inventario de legacy.

Estado observado en la base actual: 102 contratos activos, 1 cancelado, 1 cerrado; 34 usuarios, de los cuales 30 están activos y 4 inactivos. Hay 315 mantenimientos programados asociados a contratos y solo una relación contractual con una operación V2, por lo que la eliminación debe distinguir planificación de historial operativo/financiero.

## Objetivo funcional

- Eliminar un contrato no debe bloquear la creación de otro contrato para el mismo cliente y año.
- El panel debe diferenciar **cerrar**, **archivar** y **eliminar definitivamente**; no debe mostrar “eliminado” cuando solo cambió un estado.
- Un usuario eliminado no debe conservar asignaciones operativas activas ni sesiones utilizables.
- El sistema debe preservar el historial legal, de aprobaciones, liquidaciones y auditoría cuando una eliminación física lo haría inconsistente.
- El total anual debe calcularse inmediatamente y validarse nuevamente en el servidor.
- Crear o regenerar un contrato debe ser una sola operación transaccional, idempotente y con respuesta visible.

## Fase 1 — Migración de integridad V2

Crear una migración nueva, aplicada primero en una copia/verificación y después en Supabase:

1. Reemplazar `contratos_cliente_anio_unique` por un índice parcial que solo impida dos contratos operativos simultáneos del mismo cliente y año. Los estados cancelado, cerrado o eliminado no deben bloquear una nueva alta.
2. Añadir una clave de idempotencia contractual y una versión de cronograma. La combinación contrato + número de mantenimiento seguirá siendo única.
3. Crear una función de cálculo contractual que reciba:

   ```text
   (puertas_peatonales × valor_puerta_peatonal
    + puertas_vehiculares × valor_puerta_vehicular)
   × cantidad_mantenimientos
   ```

   `cantidad_mantenimientos` será la frecuencia anual; `frecuencia_meses` seguirá siendo el intervalo derivado para programar fechas.
4. Aplicar el cálculo mediante trigger o procedimiento transaccional para que ningún cliente pueda guardar un total inconsistente. Guardar también `costo_por_mantenimiento = costo_total_anual / cantidad_mantenimientos` con redondeo monetario definido.
5. Añadir campos de auditoría para acciones administrativas (`deleted_at`, `deleted_by`, motivo y versión del cronograma) si el modelo de retención lo requiere.
6. Mantener las claves foráneas que protegen liquidaciones, aprobaciones, entregas y auditoría. No convertir un error de integridad en un `CASCADE` destructivo sin una migración de snapshots.

## Fase 2 — Eliminación correcta de contratos

Separar las acciones en la API:

### Cerrar o archivar

- Cambia el estado y registra auditoría.
- Conserva operaciones realizadas, aprobaciones, liquidaciones y evidencias.
- No bloquea la creación de un nuevo contrato porque el índice será parcial.

### Eliminar definitivamente

- Ejecuta una transacción con bloqueo de la fila del contrato.
- Elimina mantenimientos puramente planificados y sus participantes/notificaciones dependientes.
- Si existe actividad, aprobación, entrega, liquidación o auditoría, no debe borrar silenciosamente. Debe devolver una respuesta explícita indicando que solo puede archivarse o que primero debe realizarse una depuración autorizada.
- Después de una eliminación válida, devuelve el contrato eliminado y el estado actualizado del cliente.

La UI debe usar mensajes distintos para “Contrato cerrado”, “Contrato archivado” y “Contrato eliminado definitivamente”, y mostrar el motivo cuando la base impida el borrado.

## Fase 3 — Eliminación y desactivación de usuarios

Implementar `users.delete` como operación segura y transaccional:

1. Bloquear el usuario y revocar todas sus sesiones antes de cambiar o borrar relaciones.
2. Retirar asignaciones futuras de mantenimientos y marcar como retirados los participantes que todavía no han entregado.
3. Cerrar membresías y permisos de reportador desde la fecha de eliminación.
4. Eliminar notificaciones y horarios que no formen parte del historial necesario.
5. Permitir borrado físico únicamente cuando no existan referencias históricas protegidas.
6. Si hay actividades, liquidaciones, asistencia, aprobaciones o auditoría, conservar una identidad histórica mínima/anónima y mostrar “Cuenta eliminada; historial conservado”, nunca “eliminación física completada”.
7. Impedir borrar al último administrador y exigir confirmación escrita del motivo.

Así se evita saturar la operación con asignaciones activas sin romper las referencias financieras y legales existentes.

## Fase 4 — Formulario de contrato y cálculo inmediato

En `app/admin/contratos/page.tsx`:

- Convertir el total anual en un campo calculado de solo lectura.
- Recalcular al cambiar cantidades, precios o frecuencia, sin calculadora externa.
- Mostrar desglose de puertas, frecuencia anual, total anual y costo por mantenimiento.
- Tomar valores por defecto del cliente/último contrato o exigirlos de forma clara; nunca usar cero silenciosamente.
- Validar cantidades enteras, precios no negativos, frecuencia entre 1 y 12 y total mayor que cero.
- En edición, mostrar la diferencia antes de guardar y recalcular también el costo por mantenimiento.

El servidor será la fuente definitiva; si llega un total enviado por el navegador que no coincide, lo recalculará o rechazará con un mensaje claro.

## Fase 5 — Creación y regeneración sin duplicados

### Creación

- El formulario enviará contrato, mantenimientos, horas, responsables y participantes en una sola petición.
- La API ejecutará contrato + cronograma + participantes + notificaciones en una única transacción.
- La petición tendrá una clave idempotente. Reintentar por doble clic o pérdida de red devolverá el mismo contrato, sin crear filas adicionales.
- Mientras espera, el botón quedará deshabilitado y mostrará “Creando contrato y cronograma…”. Los errores de unicidad o validación aparecerán en el formulario.

### Regeneración/reactivación

- No se borrará todo el cronograma.
- Se calculará el cronograma deseado con números estables y se hará un `diff` por `(contrato_id, numero)`.
- Se actualizarán fechas y horas solo en filas no ejecutadas ni vinculadas a una operación.
- Las filas ejecutadas, aprobadas o liquidadas conservarán sus fechas históricas.
- Las filas pendientes que ya no pertenezcan al nuevo cronograma se cancelarán explícitamente o se eliminarán si no tienen relaciones, nunca se duplicarán.
- La operación tendrá bloqueo por contrato y una versión para impedir dos regeneraciones simultáneas.
- El resultado devolverá cuántas filas fueron creadas, actualizadas, conservadas y canceladas.

## Fase 6 — Mensajes y observabilidad

- Añadir estados `creating`, `saving`, `deleting` y `regenerating` en el panel.
- Mostrar confirmación de éxito con identificador del contrato y cantidad de mantenimientos.
- Registrar en `auditoria_eventos` actor, operación, contrato/usuario, valores anteriores, valores nuevos y motivo.
- Convertir errores PostgreSQL frecuentes (`unique`, `foreign key`, `check`) a mensajes funcionales en español.
- Evitar que el formulario se cierre o se resetee hasta recibir confirmación del servidor.

## Pruebas de aceptación

1. Crear un contrato con el cálculo automático y comprobar que el total coincide con la fórmula y con PostgreSQL.
2. Pulsar dos veces “Crear contrato” o repetir la petición: debe existir un solo contrato y un solo cronograma.
3. Cerrar/cancelar un contrato y crear otro para el mismo cliente y año: debe permitirlo; el histórico anterior debe conservarse.
4. Eliminar definitivamente un contrato sin operaciones: debe desaparecer de las tablas V2 y no bloquear una recreación.
5. Intentar eliminar un contrato con liquidación o aprobación: debe impedir el borrado físico y explicar que corresponde archivarlo.
6. Eliminar un usuario sin historial: debe revocar sesión, retirar asignaciones y borrar la cuenta.
7. Eliminar un usuario con historial: debe retirar asignaciones futuras, conservar el historial y mostrar el resultado real.
8. Editar cantidad, puertas y precios: el total y el costo por mantenimiento deben cambiar al instante y coincidir con la respuesta del servidor.
9. Regenerar fechas de un contrato vencido dos veces: el número de mantenimientos debe permanecer estable y no deben aparecer filas adicionales.
10. Ejecutar pruebas de concurrencia, TypeScript, lint de archivos modificados, build web y consultas de integridad en Supabase.

## Orden de implementación

1. Migración de índices, cálculo y auditoría.
2. Procedimientos transaccionales de contrato y usuario.
3. Adaptación de `app/api/data/route.ts` y servicios de datos.
4. Adaptación de formularios y mensajes del panel.
5. Pruebas con datos de prueba y revisión de datos afectados.
6. Aplicación en Supabase, commit, deploy web y verificación de producción.

No se deben ejecutar borrados masivos ni regeneraciones sobre datos reales hasta completar las pruebas de aceptación y un backup verificable.

## Implementación ejecutada

- Migración `018_contract_user_lifecycle.sql`: índice único parcial por contrato activo, versión de cronograma y cálculo autoritativo en PostgreSQL.
- Migración `019_contract_idempotency_key.sql`: clave única opcional para reintentos de creación sin duplicar contratos.
- `app/api/data/route.ts`: creación transaccional, reconciliación idempotente del cronograma, auditoría, eliminación segura de contratos y retiro/anonymización segura de usuarios.
- `app/admin/contratos/page.tsx`: total anual de solo lectura calculado por puertas y mantenimientos; el cronograma y participantes se envían en una sola petición.
- `app/admin/usuarios/page.tsx`: mensajes de resultado para actualización y eliminación real/archivado.

La migración fue aplicada al proyecto Supabase V2 `glnihgjgzygdfnleicqb`. La verificación confirmó el índice parcial, el índice de idempotencia, la función de cálculo y el trigger activos. No se borraron datos existentes durante esta implementación.
