# Checklist de Validación (Administrador Web)

> Objetivo: validar que la plataforma web cumple los requisitos funcionales solicitados y lo pactado en el **Contrato de Prestación de Servicios** entre SOLUCIONES & AUTOMATIZACIONES SAS y APPS FACTORY.
>
> Recomendación de uso: ejecutar este checklist durante la **marcha blanca (5 días hábiles)** y marcar cada punto con evidencia (captura, PDF, correo enviado, registro en BD).

---

## 0) Preparación de pruebas

- [X] Ingresé con un usuario **Administrador** activo.
- [X] Confirmé que existen usuarios de prueba: Admin, Líder, Técnico.
- [x] Confirmé que existen clientes y grupos de trabajo de prueba.
- [X] Confirmé acceso a entorno con Supabase y envío de correos habilitado (si aplica).

---

## 1) Autenticación y roles (Cláusula 3: sistema con roles)

- [X] El login permite entrar con credenciales válidas.
- [X] El login bloquea credenciales inválidas.
- [X] En Gestión de Usuarios puedo crear usuario con rol **Administrador**.
- [X] En Gestión de Usuarios puedo crear usuario con rol **Técnico**.
- [X] En Gestión de Usuarios puedo crear usuario con rol **Líder**.
- [X] Al seleccionar rol **Líder**, el sistema marca el usuario como líder.
- [X] Puedo activar/desactivar banderas: **Supervisor**, **Tiene Moto**, **Tiene Recorrido**.
- [X] Los badges de Supervisor/Moto/Recorrido se visualizan en la tabla de usuarios.

---

## 2) Módulo 1 – Gestión de Mantenimientos Técnicos (Cláusula 2, literal a-b-c-d)

### 2.1 Clientes y programación
- [X] Puedo crear/editar clientes con datos completos (incluye puertas peatonales/vehiculares y frecuencia).
- [X] Puedo programar un mantenimiento desde Admin.
- [X] Puedo asignar técnico, fecha y hora al mantenimiento.
- [X] Se visualiza el estado del mantenimiento: programado / en ejecución / pendiente / realizado.

### 2.2 Vista de mantenimientos
- [X] La pestaña **Próximos** muestra mantenimientos por realizar en ventana de 3 días.
- [X] La pestaña **Programados** muestra mantenimientos ya agendados con técnico y hora.
- [X] La pestaña **Todos** lista mantenimientos con filtros y búsqueda.
- [X] La pestaña **Calendario** muestra mantenimientos por día/mes.

### 2.3 Reporte técnico (datos capturados)
- [X] El reporte de mantenimiento guarda fotos **antes** y **después**.
- [X] El reporte guarda observaciones y pendientes.
- [X] El reporte guarda datos del receptor (nombre, cédula, cargo) cuando aplica.
- [X] El reporte guarda firma digital del receptor cuando aplica.
- [X] El reporte guarda foto de bitácora cuando aplica.

### 2.4 PDF y envío
- [X] Se genera PDF de mantenimiento desde la web sin errores.
- [X] El PDF incluye: empresa, fecha, técnico, cliente, edificio, observaciones.
- [X] El PDF incluye fotos antes/después correctamente.
- [X] El PDF incluye datos del receptor y firma cuando existen.
- [X] Desde Reportes, el botón **Enviar al Cliente** marca el reporte como enviado.

---

## 3) Módulo 2 – Liquidación de Actividades e Incentivos (Cláusula 2, literal e-f-g-h-i)

### 3.1 Catálogo de actividades
- [X] Puedo crear actividad con código, descripción y valor económico.
- [X] Puedo editar valor económico de actividad.
- [X] Se conserva historial de cambios de precio.

### 3.2 Grupos de trabajo
- [X] Puedo crear grupos de trabajo.
- [X] Puedo asignar líder al grupo.
- [X] Puedo agregar múltiples integrantes al grupo.

### 3.3 Registro y aprobación de actividades
- [ ] Los reportes de actividad se visualizan en Aprobaciones.
- [ ] Puedo filtrar por tipo, estado y grupo.
- [ ] Puedo abrir detalle del informe.
- [ ] Puedo **aprobar** informe pendiente.
- [ ] Puedo **rechazar** informe pendiente.
- [ ] Al aprobar/rechazar se envía notificación al técnico.

### 3.4 Liquidación periódica
- [ ] Existen períodos de liquidación quincenal configurables.
- [ ] Puedo cerrar período de liquidación.
- [ ] El sistema calcula valor por técnico según porcentaje y actividades.
- [ ] Se genera resumen por grupo y por técnico.
- [ ] Se genera PDF de liquidación.
- [ ] Se genera comprobante individual por técnico.
- [ ] El sistema permite envío de resumen por correo al cierre (si está configurado).
- [ ] Se visualiza el **Resumen Quincenal de Pagos** (aprobado, pendiente, total).

---

## 4) Contratos de mantenimiento (requisito adicional solicitado)

- [ ] La vista de Contratos muestra KPIs (valor anual, recaudado, programados, realizados).
- [ ] Puedo crear un **Nuevo Contrato** desde la web.
- [ ] Al crear contrato, puedo definir cliente, año, costo total anual y cantidad de mantenimientos.
- [ ] El sistema calcula automáticamente costo por mantenimiento.
- [ ] El sistema genera automáticamente la programación base de mantenimientos del contrato.
- [ ] Puedo abrir el detalle del contrato y ver sus mantenimientos.
- [ ] Puedo exportar reporte de contratos por rango de fechas (PDF).
- [ ] Se visualiza cierre mensual.
- [ ] Se visualiza cierre anual.

---

## 5) Informes técnicos por modalidad (requisitos funcionales previos)

### 5.1 Mantenimiento preventivo
- [ ] En Informes se listan mantenimientos preventivos con receptor, bitácora, fotos, líder y aprobación.
- [ ] Se visualiza costo por informe.

### 5.2 Visita técnica
- [ ] En Informes se listan visitas técnicas con descripción, fotos, estado de aprobación y costo.
- [ ] En módulo de Visitas puedo verificar y registrar valor cobrado al cliente.
- [ ] Puedo exportar visitas en PDF/CSV por rango de fechas.

### 5.3 Recorridos
- [ ] En Informes se listan recorridos con partida, llegada, modalidad y costo.
- [ ] Si modalidad es con herramienta, se refleja evidencia de foto de herramienta.

---

## 6) Acumulados de líder y configuración económica

- [ ] Existe vista de acumulados por líder con desglose:
  - [ ] Total aprobado pago
  - [ ] Total pendiente pago
  - [ ] Extra líder
  - [ ] Total recorridos
  - [ ] Total acumulado
- [ ] Se aplica configuración de porcentaje de extra líder cuando está activo.
- [ ] Se configuran costos: revisión líder, recorrido normal, recorrido con herramienta.
- [ ] Se configura porcentaje de descuento por tardanza.

---

## 7) Asistencia (requisito funcional previo)

- [X] La sección se visualiza como **Asistencia** (no Llegadas).
- [X] Se registran y muestran: hora entrada, hora salida, estado entrada, estado salida.
- [X] Se puede enviar mensaje al técnico desde asistencia (como notificación).
- [X] Se puede editar porcentaje de descuento por registro.

---

## 8) Notificaciones y trazabilidad

- [ ] Se crean notificaciones al programar mantenimiento.
- [ ] Se crean notificaciones al aprobar/rechazar actividades.
- [ ] Se crean notificaciones en cierres relevantes (si aplica).
- [ ] Las notificaciones guardan metadata útil (id reporte, estado, etc.).

---

## 9) Criterios de aceptación por contrato

### Entrega funcional (Cláusulas 2 y 3)
- [ ] Los dos módulos (Mantenimientos + Liquidación) funcionan end-to-end.
- [ ] El sistema web permite administración completa sin bloqueos críticos.

### Informes de avance (Cláusula 4)
- [X] Existe evidencia de avance funcional de al menos 50% (módulos principales operativos).
- [ ] Existe evidencia de versión final funcional para cierre.

### Marcha blanca (Parágrafo 2, Cláusula 5)
- [ ] Se ejecutó prueba operativa en campo durante 5 días hábiles.
- [ ] Se registraron bugs/incidencias detectadas.
- [ ] Se verificó corrección de incidencias reportadas.

### Código y propiedad intelectual (Cláusulas 11 y 11B)
- [ ] Existe repositorio privado con historial de commits.
- [ ] El código fuente y documentación técnica están listos para transferencia/entrega.

### Compatibilidad técnica (Cláusula 11A)
- [X] Se validó funcionamiento de la solución móvil en Android 13.
- [X] Se validó funcionamiento de la solución móvil en Android 14.

### Garantía post-entrega (Cláusula 11C)
- [X] Quedó definido canal formal para reportes de garantía (90 días).
- [X] Quedó claro qué entra y qué no entra en cobertura de garantía.

---

## 10) Resultado final de validación

- [ ] **APROBADO PARA CIERRE**
- [ ] **PENDIENTE AJUSTES**
- [ ] **RECHAZADO**

### Observaciones finales

- [ ] Se adjuntaron evidencias (capturas/PDF/correos).
- [ ] Se documentaron pendientes con responsable y fecha compromiso.
- [ ] Se confirmó si procede pago final según cumplimiento y marcha blanca.
