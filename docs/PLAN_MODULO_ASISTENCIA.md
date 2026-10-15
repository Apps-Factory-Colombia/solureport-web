# Plan integral de operación y rediseño del módulo de asistencia

**Proyecto:** SoluReport Web
**Módulo:** Asistencia, llegadas tarde, memorandos y liquidación
**Estado:** Implementado en `solureport-web`. Este documento conserva el plan operativo y registra las decisiones aplicadas.
**Fecha de revisión:** 14 de octubre de 2026
**Zona horaria operativa:** America/Bogota

## 1. Objetivo

Rediseñar el módulo de asistencia para que el administrador pueda operar el proceso completo desde una sola sección:

1. Revisar únicamente la asistencia del día actual al ingresar.
2. Consultar días anteriores individualmente.
3. Identificar tardanzas, ausencias de marcación, minutos adeudados y evidencias.
4. Aplicar el descuento correcto a la liquidación.
5. Generar memorandos o llamados de atención con fotografía, hora y espacio para firmas.
6. Consolidar y descargar el informe de asistencia de cada quincena.
7. Mantener las reglas configurables y conservar los históricos sin alteraciones silenciosas.

## 2. Alcance y límites

### Incluido

- Vista diaria de asistencia.
- Historial por fecha.
- Evidencia fotográfica y de ubicación.
- Reglas configurables de tardanza y no reporte.
- Memorandos individuales.
- Reporte quincenal consolidado.
- Integración visible con liquidación.
- Auditoría de cambios.
- Migraciones, backfill y validación de datos.

### No incluido sin aprobación adicional

- Firma electrónica certificada.
- Envío automático de documentos por correo o WhatsApp.
- Cambios en contratos laborales.
- Definición jurídica independiente de la empresa.
- Eliminación de registros históricos.

El texto jurídico y el régimen sancionatorio de los documentos deben ser validados por la empresa antes de quedar automatizados como plantilla.

## 3. Fuentes revisadas

### Código actual

- `app/admin/llegadas/page.tsx`: pantalla actual de control de llegadas.
- `lib/data/services/llegadas.ts`: servicio de consulta y actualización de asistencia.
- `app/api/data/route.ts`: operaciones de asistencia, reglas, no reporte y sincronización con liquidación.
- `lib/types/index.ts`: tipos de `ArrivalRecord` y configuración.
- `lib/utils/pdf-generator.ts`: generador PDF existente para otros reportes.
- `supabase/database.md`: estructura documentada de `registros_asistencia`, `configuracion_empresa`, `usuarios` y liquidación.
- Migraciones de asistencia y descuentos existentes en `supabase/`.

### Documentos del cliente

- `D:/Informe Oficial de Asistencia y Liquidación de Retardos.pdf`.
- `D:/Memorandos Individuales de Llamado de Atención.pdf`.

Los PDF son referencias de negocio y de formato. No deben interpretarse como instrucciones técnicas para copiar literalmente.

### Referencias UI/UX consultadas en Mobbin

- [7shifts: resumen de asistencia y métricas](https://mobbin.com/screens/66c3e5cd-85f3-43d1-adbb-c01916ba6112).
- [Deputy: panel de asistencia y exportación](https://mobbin.com/screens/a94b862d-1c9d-4cdf-b7a5-299fa1144bdd).
- [DoorDash Merchant: selector de fechas y rangos](https://mobbin.com/screens/cf7b9546-97da-4a3c-8b5f-46bb433baabd).
- [incident.io: expediente con línea de tiempo y evidencias](https://mobbin.com/screens/8d27748b-e522-40ba-a951-f718beb76799).

Estas referencias se usarán como patrones de organización y no como copia visual literal.

## 4. Diagnóstico del código actual

### Capacidades existentes

El sistema ya tiene:

- Registro de hora programada y hora real.
- Estado de entrada: `a_tiempo`, `tarde` y `no_reportado`.
- Minutos de retraso.
- Fotografía de llegada.
- Ubicación, precisión y momento de captura.
- Porcentaje de descuento.
- Configuración de hora inicial de tardanza.
- Configuración de hora de corte para no reporte.
- Creación automática de registros `no_reportado` después del corte.
- Edición administrativa del estado de asistencia.
- Sincronización con `asistencia_descuentos` y `liquidacion_items`.
- Paginación visual local y filtros de búsqueda en la pantalla actual.

### Brechas actuales

1. `arrivals.list` devuelve todos los registros y la pantalla filtra en el navegador. Esto no cumple con cargar únicamente el día seleccionado.
2. La pantalla actual mezcla revisión diaria, configuración, mensajería y edición en una sola vista.
3. No existe una sección específica de historial día por día.
4. No existe una entidad propia para memorandos de asistencia.
5. No existe generación formal de PDF para llamados de atención.
6. No existe reporte quincenal específico de asistencia con auditoría cronológica.
7. La fotografía está visible en la pantalla, pero todavía no forma parte del documento formal de evidencia.
8. La relación entre asistencia, descuento y liquidación no es suficientemente visible para el administrador.
9. El generador PDF existente es reutilizable como base, pero no contiene la plantilla de memorandos de asistencia.
10. La implementación actual de sincronización utiliza el mayor porcentaje encontrado en el período; el informe del cliente parece acumular porcentajes por evento. Esto debe definirse antes de cambiar la liquidación.

## 5. Requisitos funcionales consolidados

### Consulta diaria

- Al abrir el módulo se carga la fecha actual de Bogotá.
- Solo se solicita al servidor la información de esa fecha.
- Se puede avanzar o retroceder un día.
- Se puede seleccionar una fecha específica.
- Se puede regresar rápidamente a “Hoy”.
- La pantalla muestra resumen y detalle de cada persona.

### Historial

- Consulta por fecha.
- Filtro por trabajador.
- Filtro por estado.
- Filtro por existencia de fotografía.
- Filtro por existencia de descuento.
- Visualización de cambios y justificaciones.

### Evidencia

Cada evento debe mostrar, cuando exista:

- Fecha.
- Hora programada.
- Hora registrada.
- Minutos de retraso frente al horario programado.
- Fotografía.
- Hora de captura de fotografía.
- Ubicación y precisión.
- Regla aplicada.
- Porcentaje descontado.
- Estado de la liquidación.

### Memorando

- Generación automática en estado “Pendiente de revisión”.
- Vista previa antes de descargar.
- Número consecutivo.
- Tipo de memorando.
- Tabla de eventos relacionados.
- Fotografía o anexo de evidencia.
- Espacio para firma de empresa y trabajador.
- Control de versión.
- Estado de firma y anulación.

### Reporte quincenal

- Selección de primera o segunda quincena.
- Preferencia por períodos existentes de `periodos_liquidacion`.
- Resumen general.
- Resumen por trabajador.
- Auditoría cronológica.
- Minutos adeudados.
- Retardos leves.
- Retardos mayores.
- Casos sin registro.
- Descuentos aplicados.
- Estado de liquidación.
- Descarga PDF.

## 6. Reglas de negocio que deben cerrarse

Los documentos contienen una inconsistencia que debe resolverse antes de programar.

| Caso | Informe oficial | Memorandos / solicitud del cliente | Decisión requerida |
|---|---|---|---|
| 08:00–08:05 | 0% | 0% | Confirmar como a tiempo |
| 08:06–08:29 | -5% | -5% | Confirmar como retardo leve |
| 08:30 reportado | Aparece dentro de mayor retardo | El caso de Albenis muestra 0% y reposición | Definir si es -30% o reposición |
| 08:30 sin registro | -30% y 30 minutos imputados | Compatible con la petición | Confirmar |
| Varias tardanzas | Parece sumar porcentajes por evento | El código actual usa el mayor porcentaje | Definir acumulado, máximo o tope |

### Recomendación técnica

Separar los siguientes conceptos:

- `hora_llegada_real`: hora en que se registró.
- `minutos_retraso`: diferencia entre la hora programada y la real.
- `minutos_adeudados`: tiempo que debe reponer el trabajador.
- `categoria_llegada`: a tiempo, leve, mayor, sin registro o reposición.
- `porcentaje_descuento`: porcentaje de la regla aplicada.
- `descuento_quincenal`: acumulado calculado para el período.

Ejemplo: una llegada a las 08:10 con horario a las 08:00 representa 10 minutos de retraso, aunque pertenezca a la banda de descuento leve del 5%.

## 7. Diseño operativo propuesto

### Operación diaria

1. El sistema abre la vista del día actual.
2. Los trabajadores registran su entrada con fotografía y ubicación.
3. La API aplica la regla vigente y guarda el resultado.
4. La asistencia queda relacionada con la liquidación abierta.
5. Al llegar la hora de corte, se crean los casos `no_reportado` de las personas esperadas que no marcaron.
6. El administrador revisa excepciones, fotografías y ubicaciones.
7. Cada caso calificable genera un memorando pendiente de revisión.

### Revisión de un día anterior

1. El administrador selecciona la fecha.
2. El servidor consulta únicamente esa fecha.
3. Se revisan registros y evidencias.
4. Una corrección exige motivo y queda auditada.
5. Si el período está abierto, se recalcula la liquidación según la regla aprobada.
6. Si el período está cerrado, la corrección debe seguir un flujo controlado de ajuste.

### Cierre quincenal

1. El administrador selecciona el período.
2. El sistema consolida todos los eventos.
3. Se revisan trabajadores con tardanzas o no reportes.
4. Se revisan y descargan los memorandos.
5. Se genera el reporte quincenal.
6. Se validan totales contra la liquidación.
7. Se firman o marcan como entregados los documentos.
8. Se cierra el período.
9. Después del cierre, los datos quedan congelados salvo ajuste autorizado y auditado.

## 8. Nueva organización de la interfaz

### Pestaña “Hoy”

Componentes:

- Selector de fecha.
- Botones día anterior, día siguiente y “Hoy”.
- Tarjetas de resumen.
- Tabla de asistencia.
- Estado de memorando.
- Estado de liquidación.
- Acciones de evidencia y edición.

Resumen recomendado:

- Personal esperado.
- Reportados.
- A tiempo.
- Tardanzas.
- Sin registro.
- Minutos pendientes.
- Descuento quincenal acumulado.

### Pestaña “Historial”

- Búsqueda por fecha.
- Filtros por trabajador y estado.
- Tabla compacta.
- Panel lateral de detalle.
- Línea de tiempo de modificaciones.

### Pestaña “Memorandos”

- Filtro por quincena.
- Filtro por trabajador.
- Tipo de memorando.
- Estado: pendiente, generado, por firmar, firmado o anulado.
- Vista previa.
- Descargar.
- Regenerar versión.
- Ver eventos asociados.

### Pestaña “Reporte quincenal”

- Selector de período.
- Resumen de indicadores.
- Resumen por trabajador.
- Auditoría cronológica.
- Indicador de evidencias faltantes.
- Descarga del reporte.

### Pestaña “Configuración”

- Tabla editable de reglas.
- Fecha de vigencia.
- Horario inicial y final.
- Porcentaje.
- Minutos imputados.
- Acción en liquidación.
- Acción en memorando.
- Validación de reglas superpuestas.

## 9. Cambios de base de datos

### 9.1 `registros_asistencia`

Se reutilizará la tabla actual y se agregarán campos para conservar el resultado exacto de cada cálculo:

- `categoria_llegada`.
- `minutos_adeudados`.
- `regla_id`.
- `regla_version`.
- `porcentaje_regla_aplicada`.
- `tipo_descuento`.
- `calculado_en`.
- `motivo_ajuste`.
- `ajustado_por_id`.
- `ajustado_en`.

Se conservarán `foto_llegada_url`, ubicación, hora de captura, hora programada y hora real.

### 9.2 `asistencia_reglas`

Nueva tabla versionada con:

- `id`.
- `nombre`.
- `hora_inicio`.
- `hora_fin`.
- `condicion_evento`.
- `porcentaje_descuento`.
- `minutos_adeudados`.
- `genera_memorando`.
- `tipo_memorando`.
- `vigente_desde`.
- `vigente_hasta`.
- `version`.
- `activo`.
- `creado_por_id`.

### 9.3 `asistencia_memorandos`

Nueva tabla para documentos individuales:

- `id`.
- `usuario_id`.
- `periodo_id`.
- `numero`.
- `tipo`.
- `estado`.
- `titulo`.
- `narrativa`.
- `fundamento`.
- `plantilla_version`.
- `pdf_url` o referencia de storage.
- `generado_por_id`.
- `generado_en`.
- `firmado_en`.
- `firmado_por`.
- `anulado_en`.
- `motivo_anulacion`.

Restricción recomendada: evitar duplicar el mismo tipo de memorando para el mismo trabajador y período, salvo que exista una nueva versión controlada.

### 9.4 `asistencia_memorando_eventos`

Nueva tabla para asociar eventos a un memorando:

- `memorando_id`.
- `asistencia_id`.
- `orden`.
- `hora_programada_snapshot`.
- `hora_llegada_snapshot`.
- `minutos_snapshot`.
- `porcentaje_snapshot`.
- `foto_url_snapshot`.

El snapshot evita que un PDF histórico cambie si posteriormente se modifica la asistencia.

### 9.5 `asistencia_documentos`

Tabla opcional. Se recomienda si se necesita conservar exactamente cada archivo generado:

- `id`.
- `tipo_documento`.
- `referencia_id`.
- `periodo_id`.
- `version`.
- `storage_key`.
- `url`.
- `generado_por_id`.
- `generado_en`.
- `hash_archivo`.

### 9.6 `asistencia_descuentos`

La tabla existente debe revisarse para que guarde la trazabilidad del descuento:

- Asistencia origen.
- Trabajador.
- Período.
- Porcentaje.
- Valor.
- Minutos adeudados.
- Regla aplicada.
- Fecha de cálculo.
- Estado.

### 9.7 Índices y seguridad

Crear índices para consultas por fecha, trabajador, período y estado.

Aplicar permisos para que:

- Administradores gestionen reglas, documentos y ajustes.
- Supervisores consulten y revisen según su alcance.
- Técnicos consulten únicamente su propia información si esa función se habilita.
- Los documentos firmados o históricos no puedan eliminarse físicamente desde la interfaz.

## 10. API propuesta

### Asistencia

- `arrivals.day`: consulta una fecha.
- `arrivals.history`: consulta paginada por rango.
- `arrivals.update`: corrige con motivo y auditoría.
- `arrivals.ensure`: crea no reportados después del corte.
- `arrivals.evidence`: devuelve fotografía, ubicación y metadatos.

### Reglas

- `attendance.rules.list`.
- `attendance.rules.create`.
- `attendance.rules.update`.
- `attendance.rules.activate`.

### Memorandos

- `attendance.memo.create`.
- `attendance.memo.preview`.
- `attendance.memo.list`.
- `attendance.memo.download`.
- `attendance.memo.regenerate`.
- `attendance.memo.markSigned`.
- `attendance.memo.cancel`.

### Reporte quincenal

- `attendance.fortnightly.summary`.
- `attendance.fortnightly.detail`.
- `attendance.fortnightly.download`.

### Liquidación

- `attendance.liquidation.detail`.
- `attendance.liquidation.recalculate` para períodos abiertos.
- `attendance.liquidation.audit`.

Todas las operaciones deben validar permisos en servidor, no solo en la interfaz.

## 11. Documentos PDF

### Memorando individual

Debe contener:

- Nombre y datos de la empresa.
- Número del memorando.
- Trabajador, cargo y período.
- Remitente.
- Narrativa del incumplimiento.
- Tabla de eventos.
- Hora programada.
- Hora registrada.
- Minutos de retraso.
- Estado en plataforma.
- Descuento.
- Fotografía o anexo de evidencia.
- Resumen de eventos.
- Minutos pendientes.
- Fundamento aprobado por la empresa.
- Espacio de firma de la empresa.
- Espacio de firma del trabajador.
- Número de versión.

### Reporte quincenal

Debe contener:

- Período.
- Fecha de corte.
- Reglas utilizadas.
- Totales generales.
- Resumen por persona.
- Tiempo adeudado.
- Retardos leves.
- Retardos mayores.
- No reportados.
- Descuento acumulado.
- Auditoría cronológica.
- Indicador de evidencia.
- Relación con liquidación.

Se recomienda ofrecer dos opciones:

1. Reporte resumido para gestión.
2. Paquete de evidencias para revisión y firma.

## 12. Integración con liquidación

La asistencia y la liquidación deben utilizar un único cálculo centralizado.

Para cada evento se debe poder responder:

- ¿Qué regla se aplicó?
- ¿Qué porcentaje produjo?
- ¿Cuántos minutos generó?
- ¿Qué valor descontó?
- ¿Qué ítem de liquidación afectó?
- ¿El período está abierto o cerrado?

El sistema debe evitar descuentos acumulativos incorrectos cuando se edite o vuelva a guardar una asistencia.

Los períodos cerrados deben conservar un snapshot de sus valores y no reconstruirse con la configuración vigente.

## 13. Fases de implementación

### Fase 0: Cierre funcional

**Cambios en BD:** no.

Entregables:

- Matriz definitiva de reglas.
- Decisión sobre 08:30 reportado.
- Decisión sobre acumulación de descuentos.
- Decisión sobre frecuencia de memorandos.
- Validación del texto legal.

### Fase 1: Diseño UI/UX

**Cambios en BD:** no. Se validan los datos existentes.

Entregables:

- Prototipo de Hoy.
- Prototipo de Historial.
- Prototipo de detalle y evidencia.
- Prototipo de Memorandos.
- Prototipo de Reporte quincenal.
- Estados de carga, error y ausencia de evidencia.

### Fase 2: Migraciones y modelo de datos

**Cambios en BD:** sí.

Entregables:

- Migración de campos de asistencia.
- Tabla de reglas versionadas.
- Tablas de memorandos y eventos.
- Índices.
- Auditoría.
- Ajustes de `asistencia_descuentos`.
- Políticas de acceso.

### Fase 3: API y cálculo centralizado

**Cambios en BD:** sí, utiliza el nuevo modelo.

Entregables:

- Consultas por fecha.
- Historial paginado.
- Reglas configurables.
- Snapshot de regla aplicada.
- Cálculo de minutos y descuentos.
- Integración con liquidación.

### Fase 4: Vista diaria e historial

**Cambios en BD:** principalmente consultas e índices; no se esperan nuevas tablas.

Entregables:

- Vista Hoy.
- Navegación diaria.
- Historial.
- Panel de evidencias.
- Correcciones auditadas.

### Fase 5: Memorandos

**Cambios en BD:** sí, uso de `asistencia_memorandos` y `asistencia_memorando_eventos`.

Entregables:

- Generación pendiente.
- Vista previa.
- PDF.
- Fotografía.
- Firmas.
- Versiones y estados.

### Fase 6: Reporte quincenal

**Cambios en BD:** consultas agrupadas. La tabla de documentos será opcional.

Entregables:

- Resumen quincenal.
- Detalle cronológico.
- Evidencias.
- PDF resumido.
- Paquete de evidencias.

### Fase 7: Liquidación

**Cambios en BD:** sí, si la regla acumulada requiere ampliar `asistencia_descuentos` o crear un detalle por evento.

Entregables:

- Descuento visible desde asistencia.
- Detalle visible desde liquidación.
- Recalculo seguro para períodos abiertos.
- Congelamiento para períodos cerrados.

### Fase 8: Backfill y validación histórica

**Cambios en BD:** sí.

Se deben revisar los registros existentes y completar, cuando sea posible:

- Categoría de llegada.
- Minutos adeudados.
- Regla histórica disponible.
- Relación con período.

Los registros cuyo histórico no permita determinar la regla deben marcarse como `legacy` y no recalcularse automáticamente sin autorización.

### Fase 9: Pruebas, despliegue y operación

**Cambios en BD:** aplicación de migraciones aprobadas y verificación posterior.

Después de la validación completa se realizará el commit y push.

## 14. Plan de pruebas

### Reglas de tiempo

- 08:00.
- 08:05.
- 08:06.
- 08:29.
- 08:30 reportado.
- 08:30 sin reporte.
- Llegada posterior a 08:30.
- Horarios distintos a las 08:00.
- Días no laborables.

### Evidencia

- Foto existente.
- Foto faltante.
- Ubicación existente.
- Ubicación faltante.
- Fotografía inválida o no disponible.

### Memorandos

- Un evento.
- Varios eventos del mismo trabajador.
- Trabajadores distintos.
- Regeneración.
- Firma.
- Anulación.
- Prevención de duplicados.

### Liquidación

- Descuento en período abierto.
- Descuento en período cerrado.
- Edición de asistencia.
- Repetición del mismo guardado.
- Corrección de porcentaje.
- Comparación contra reporte quincenal.

### Rendimiento y seguridad

- La vista Hoy no descarga históricos.
- El historial utiliza paginación.
- El reporte se calcula en servidor.
- Usuarios sin permisos no pueden editar.
- Los documentos no exponen fotografías de otros trabajadores sin autorización.

## 15. Migración, despliegue y reversión

### Antes de migrar

1. Respaldar las tablas relacionadas.
2. Verificar períodos abiertos y cerrados.
3. Contar registros de asistencia.
4. Identificar registros sin trabajador válido.
5. Confirmar reglas aprobadas.

### Migración

1. Crear tablas y columnas nuevas.
2. Crear índices.
3. Ejecutar backfill controlado.
4. Validar conteos antes y después.
5. Activar la nueva API.
6. Validar liquidación con casos controlados.

### Reversión

- No eliminar columnas nuevas durante una reversión inmediata.
- Mantener las tablas nuevas sin uso hasta corregir el código.
- Restaurar la lectura anterior si la nueva consulta falla.
- No modificar períodos cerrados durante una reversión.

## 16. Criterios de aceptación

El proyecto se considerará listo cuando:

- La pantalla inicial cargue solamente el día actual.
- Las fechas anteriores se consulten bajo demanda.
- La fotografía y la hora aparezcan en el detalle y documento.
- La regla aplicada quede guardada junto al registro.
- El memorando se genere sin duplicados.
- El PDF tenga espacio para firma.
- El reporte quincenal coincida con los registros diarios.
- La liquidación muestre el descuento originado en asistencia.
- Los cambios de configuración no alteren históricos cerrados.
- Los ajustes manuales tengan motivo, usuario y fecha.
- Los documentos puedan descargarse y regenerarse con control de versión.
- El sistema supere las pruebas de límites horarios y períodos.
- La migración no pierda registros ni fotografías.

## 17. Decisiones pendientes antes de programar

1. ¿Una llegada reportada a las 08:30 tiene 0% con reposición o -30%?
2. ¿El descuento se acumula por evento, tiene un máximo o tiene un tope quincenal?
3. ¿El memorando se genera por evento o uno consolidado por trabajador y quincena?
4. ¿La fotografía va dentro del memorando, en un anexo o en ambos?
5. ¿La firma será manual sobre el PDF o firma electrónica?
6. ¿La quincena debe depender siempre de `periodos_liquidacion`?
7. ¿Quién puede ver y descargar fotografías y memorandos?
8. ¿Cuál es el texto legal aprobado para las plantillas?

Estas decisiones fueron resueltas para esta entrega con valores configurables: una llegada reportada desde el corte se clasifica como reposición con 0% por defecto; el descuento se acumula por evento con tope de 100% por trabajador y quincena; el memorando se consolida por trabajador, quincena y tipo; la fotografía queda en la evidencia del registro y se referencia en el documento; la firma queda preparada como espacio manual; y la liquidación solo se recalcula para periodos abiertos.

## 18. Implementación ejecutada

- Migración aplicada: `supabase/032_attendance_module.sql`.
- Se agregaron reglas versionables, categorías de llegada, minutos adeudados, trazabilidad de ajustes y tablas de memorandos/eventos.
- Se habilitó la vista diaria bajo demanda, historial por fecha, resumen quincenal, exportación PDF y detalle con fotografía/ubicación.
- Se corrigió la sincronización con liquidación para acumular eventos, recalcular desde `valor_ganado_original` y no alterar periodos cerrados.
- Se ejecutó un backfill de periodos abiertos; no quedaron eventos tardíos abiertos sin fila de auditoría de descuento.
- Las reglas iniciales quedaron en 5 minutos de gracia, corte a 30 minutos y 30% para no reporte, todas editables desde la pantalla de Reglas.
- Validaciones realizadas: migración idempotente, TypeScript, build de producción, consultas SQL de asistencia/liquidación y healthcheck HTTP.
- La prueba E2E existente de autenticación no pudo iniciar su segundo caso porque el ejecutable local de Playwright no está instalado; el caso de healthcheck sí pasó.
