# Actualizacion codigo de registro en app y admin

## Objetivo

Evitar que actividades distintas queden unificadas por accidente cuando dos personas reportan algo parecido el mismo dia.

La solucion es que cada actividad tenga un `codigo_registro` unico generado desde el aplicativo movil y que ese codigo viaje hasta la base de datos y luego al administrador web.

## Estado actual en este repositorio

Ya quedó preparado el administrador web para:

- mostrar `codigo_registro` en `admin/aprobaciones`
- mostrar `codigo_registro` en `admin/informes`
- usar `codigo_registro` como identidad prioritaria cuando exista
- conservar el fallback legacy cuando el codigo no exista, para no romper historicos

Ya existe la migracion SQL manual en:

- `supabase/migration_activity_registration_codes.sql`

## Importante sobre la migracion

La migracion fue dejada en modo compatible:

- no vuelve obligatorio el `codigo_registro`
- no pone `NOT NULL` en las columnas nuevas
- no rompe la app vieja si todavia no envia el codigo
- el admin sigue funcionando con fallback mientras llegan registros viejos o mixtos

Eso permite desplegar primero base de datos y admin, y despues actualizar la app movil.

## Que debe cambiar en la app movil

La app movil debe generar un `codigo_registro` unico al crear cada actividad origen.

### 1. Visitas tecnicas

Tabla origen:

- `visitas_tecnicas.codigo_registro`

La app debe:

- generar el codigo antes de guardar la visita
- enviarlo en el insert de `visitas_tecnicas`
- conservar el mismo codigo en cualquier actualizacion de esa misma visita

Si la app tambien crea o toca el espejo en `reportes_actividad`, debe enviar ademas:

- `codigo_registro`
- `visita_tecnica_id`
- `tipo_visita`

### 2. Mantenimientos preventivos

Tabla origen:

- `mantenimientos.codigo_registro`

La app debe:

- generar el codigo cuando crea el mantenimiento
- reutilizar ese mismo codigo en reportes posteriores del mismo mantenimiento

Si la app tambien escribe en `reportes_actividad`, debe enviar:

- `codigo_registro`
- `mantenimiento_id`
- `mantenimiento_participante_id` cuando exista

### 3. Recorridos

Tabla origen:

- `recorridos.codigo_registro`

La app debe:

- generar el codigo al crear el recorrido
- reutilizarlo para cualquier actualizacion o foto asociada a ese mismo recorrido

Si tambien toca el espejo en `reportes_actividad`, debe enviar:

- `codigo_registro`
- `recorrido_id`

### 4. Actividades grupales

Tabla origen:

- `registros_actividades.codigo_registro`

La app debe:

- generar un solo `codigo_registro` para toda la actividad grupal
- guardar ese mismo codigo en el registro principal de la actividad
- reutilizar el mismo codigo para todos los participantes de esa actividad

Regla clave:

- una actividad grupal = un solo `codigo_registro`
- no se debe generar uno distinto por tecnico participante

## Formato recomendado del codigo

La app puede generar un formato como este:

- `VT-20260728-A1B2C3D4`
- `MP-20260728-E5F6G7H8`
- `RC-20260728-I9J0K1L2`
- `AG-20260728-M3N4O5P6`

Prefijos sugeridos:

- `VT` = visita tecnica
- `MP` = mantenimiento preventivo
- `RC` = recorrido
- `AG` = actividad grupal

Reglas:

- debe ser unico
- no debe cambiar despues de creado
- debe viajar siempre con la actividad origen

## Cuando generar el codigo

Debe generarse solo al crear la actividad por primera vez.

No debe regenerarse cuando:

- se edita descripcion
- se suben fotos
- se aprueba en admin
- se vuelve a sincronizar

## Regla funcional para evitar mezclas

La app no debe crear una actividad nueva si realmente esta editando una existente.

La app si debe crear una actividad nueva con `codigo_registro` nuevo cuando:

- es otra visita
- es otro mantenimiento
- es otro recorrido
- es otra actividad grupal

Aunque coincidan:

- tecnico
- cliente
- fecha
- descripcion parecida

## Caso especial: entregas de llaves

Las visitas tecnicas con `tipo_visita = entregas` deben quedar en `0`.

La app debe guardar:

- `costo_visita_tecnica_default = 0`
- `valor_cobrado_cliente = 0`
- `valor_modificado = false`
- `motivo_modificacion_valor = null`

Esto ya fue reforzado en admin y en la base, pero la app tambien debe respetarlo.

## Lo que debe cargar el admin

Con la migracion aplicada y la app enviando `codigo_registro`, el administrador web ya queda listo para:

- ver el codigo en las tablas de `Aprobaciones`
- ver el codigo en las tablas de `Informes`
- ver el codigo en el detalle del informe
- dejar de consolidar actividades distintas cuando cada una tenga codigo propio

Esto aplica para:

- visitas tecnicas
- mantenimientos preventivos
- recorridos
- actividades grupales

## Orden recomendado de despliegue

1. Aplicar la migracion `supabase/migration_activity_registration_codes.sql`
2. Desplegar este admin web
3. Actualizar la app movil para enviar `codigo_registro`
4. Validar que nuevas actividades ya aparezcan con codigo en `Aprobaciones` e `Informes`

## Validaciones funcionales esperadas

### Visitas

- dos visitas distintas del mismo tecnico el mismo dia deben tener codigos distintos
- no deben consolidarse si el codigo es distinto

### Recorridos

- dos recorridos distintos del mismo tecnico el mismo dia deben tener codigos distintos
- no deben mezclarse en admin

### Mantenimientos

- los participantes del mismo mantenimiento deben conservar identidad correcta del mismo origen

### Actividades grupales

- todos los participantes de una misma actividad deben compartir el mismo `codigo_registro`
- dos actividades grupales distintas no deben compartir codigo

## Resumen tecnico minimo para la app

La app debe empezar a enviar estas columnas al crear origenes:

- `visitas_tecnicas.codigo_registro`
- `mantenimientos.codigo_registro`
- `recorridos.codigo_registro`
- `registros_actividades.codigo_registro`

Y si la app escribe tambien en `reportes_actividad`, debe enviar ademas los identificadores origen correspondientes:

- `visita_tecnica_id`
- `recorrido_id`
- `mantenimiento_id`
- `codigo_registro`

## Resultado esperado

Cuando la app implemente esto:

- el sistema deja de unificar actividades distintas por heuristica
- cada actividad queda rastreable por su codigo
- el admin muestra ese codigo en tablas y detalles
- historicos viejos siguen funcionando sin romperse
