-- ============================================================
-- SOLUREPORT - Seed Data
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ── 0. Configuración Empresa ────────────────────────────────
INSERT INTO configuracion_empresa (nombre, correo_remitente, correo_empresa, porcentaje_descuento_tardanza, porcentaje_extra_lider, extra_lider_activo, costo_revision_lider, costo_recorrido_normal, costo_recorrido_herramienta)
VALUES (
  'SOLUCIONES & AUTOMATIZACIONES S.A.S.',
  'reportes@solureport.com',
  'info@solureport.com',
  5.00, 10.00, true, 15000.00, 25000.00, 40000.00
);


-- ── 1. Usuarios ─────────────────────────────────────────────
-- Admin
INSERT INTO usuarios (id, username, nombre, apellido, email, telefono, rol, estado, password_hash, es_lider, es_supervisor, tiene_recorrido, tiene_moto)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'admin',
  'Carlos',
  'Rodríguez',
  'admin@solureport.com',
  '3001234567',
  'admin',
  'activo',
  'admin123',
  false, true, false, false
);


-- Líder 1
INSERT INTO usuarios (id, username, nombre, apellido, email, telefono, rol, estado, password_hash, es_lider, es_supervisor, tiene_recorrido, tiene_moto)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  'jmartinez',
  'Jorge',
  'Martínez',
  'jorge.martinez@solureport.com',
  '3109876543',
  'lider',
  'activo',
  'lider123',
  true, false, true, true
);

-- Técnico 1
INSERT INTO usuarios (id, username, nombre, apellido, email, telefono, rol, estado, password_hash, es_lider, es_supervisor, tiene_recorrido, tiene_moto)
VALUES (
  '10000000-0000-0000-0000-000000000003',
  'aperez',
  'Andrés',
  'Pérez',
  'andres.perez@solureport.com',
  '3201112233',
  'tecnico',
  'activo',
  'tecnico123',
  false, false, true, true
);

-- Técnico 2
INSERT INTO usuarios (id, username, nombre, apellido, email, telefono, rol, estado, password_hash, es_lider, es_supervisor, tiene_recorrido, tiene_moto)
VALUES (
  '10000000-0000-0000-0000-000000000004',
  'lcastro',
  'Laura',
  'Castro',
  'laura.castro@solureport.com',
  '3154445566',
  'tecnico',
  'activo',
  'tecnico123',
  false, false, false, false
);

-- Técnico 3
INSERT INTO usuarios (id, username, nombre, apellido, email, telefono, rol, estado, password_hash, es_lider, es_supervisor, tiene_recorrido, tiene_moto)
VALUES (
  '10000000-0000-0000-0000-000000000005',
  'drios',
  'Daniel',
  'Ríos',
  'daniel.rios@solureport.com',
  '3187778899',
  'tecnico',
  'activo',
  'tecnico123',
  false, false, true, false
);

-- ── 2. Grupos de Trabajo ────────────────────────────────────
INSERT INTO grupos_trabajo (id, nombre, lider_id, estado)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'Grupo Norte',
  '10000000-0000-0000-0000-000000000002',
  'activo'
);

INSERT INTO grupos_trabajo (id, nombre, lider_id, estado)
VALUES (
  '20000000-0000-0000-0000-000000000002',
  'Grupo Sur',
  '10000000-0000-0000-0000-000000000002',
  'activo'
);

-- Asignar grupo a usuarios
UPDATE usuarios SET grupo_id = '20000000-0000-0000-0000-000000000001' WHERE id IN (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000004'
);
UPDATE usuarios SET grupo_id = '20000000-0000-0000-0000-000000000002' WHERE id = '10000000-0000-0000-0000-000000000005';

-- Miembros de grupos
INSERT INTO grupo_miembros (grupo_id, usuario_id) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005');

-- ── 3. Clientes ─────────────────────────────────────────────
INSERT INTO clientes (id, nombre, edificio, direccion, ciudad, contacto, correo, telefono, frecuencia_mantenimiento, puertas_peatonales, puertas_vehiculares, estado)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'Conjunto Residencial Los Pinos', 'Torre A Los Pinos', 'Cra 15 #120-45', 'Bogotá', 'Martha López', 'admin@lospinos.com', '6012345678', 4, 3, 2, 'activo'),
  ('30000000-0000-0000-0000-000000000002', 'Edificio Corporativo Zentral', 'Zentral Office', 'Av Calle 26 #68B-70', 'Bogotá', 'Ricardo Gómez', 'admin@zentral.com.co', '6019876543', 6, 5, 3, 'activo'),
  ('30000000-0000-0000-0000-000000000003', 'Centro Comercial Plaza Norte', 'Plaza Norte', 'Av Boyacá #170-50', 'Bogotá', 'Catalina Vargas', 'mantenimiento@plazanorte.co', '6015551234', 4, 8, 4, 'activo'),
  ('30000000-0000-0000-0000-000000000004', 'Hospital San Rafael', 'Edificio Principal HSR', 'Calle 63 #22-30', 'Bogotá', 'Dr. Fernando Díaz', 'mantenimiento@hsr.org', '6017779900', 2, 4, 2, 'activo');

-- ── 4. Actividades (Catálogo) ───────────────────────────────
INSERT INTO actividades (id, codigo, nombre, descripcion, categoria, valor_economico, estado)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'MP-001', 'Mantenimiento Preventivo Puertas Peatonales', 'Revisión y ajuste de puertas peatonales automáticas', 'preventivo', 85000, 'activo'),
  ('40000000-0000-0000-0000-000000000002', 'MP-002', 'Mantenimiento Preventivo Puertas Vehiculares', 'Revisión y ajuste de puertas vehiculares automáticas', 'preventivo', 120000, 'activo'),
  ('40000000-0000-0000-0000-000000000003', 'VT-001', 'Visita Técnica General', 'Inspección y diagnóstico técnico en sitio', 'visita', 65000, 'activo'),
  ('40000000-0000-0000-0000-000000000004', 'RC-001', 'Recorrido Normal', 'Desplazamiento normal entre sedes', 'recorrido', 25000, 'activo'),
  ('40000000-0000-0000-0000-000000000005', 'RC-002', 'Recorrido con Herramienta', 'Desplazamiento con herramienta pesada', 'recorrido', 40000, 'activo'),
  ('40000000-0000-0000-0000-000000000006', 'EM-001', 'Atención de Emergencia', 'Atención urgente por falla crítica en puerta automática', 'emergencia', 150000, 'activo');

-- Historial de precios de actividades
INSERT INTO actividades_historial_precios (actividad_id, fecha, valor_anterior, valor_nuevo, motivo)
VALUES
  ('40000000-0000-0000-0000-000000000001', '2024-07-01', 78000, 85000, 'Ajuste anual por inflación'),
  ('40000000-0000-0000-0000-000000000002', '2024-07-01', 110000, 120000, 'Actualización por complejidad técnica'),
  ('40000000-0000-0000-0000-000000000006', '2024-10-01', 135000, 150000, 'Recargo por atención crítica');

-- ── 5. Contratos de Mantenimiento ───────────────────────────
INSERT INTO contratos_mantenimiento (id, cliente_id, anio, costo_total_anual, cantidad_mantenimientos, costo_por_mantenimiento, estado)
VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 2025, 4800000, 4, 1200000, 'activo'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 2025, 8400000, 6, 1400000, 'activo'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 2025, 5200000, 4, 1300000, 'activo');

-- Mantenimientos del contrato 1 (Los Pinos - 4 al año)
INSERT INTO contrato_mantenimientos (contrato_id, mes, fecha_programada, estado, valor_recaudado)
VALUES
  ('50000000-0000-0000-0000-000000000001', 1, '2025-01-15', 'realizado', 1200000),
  ('50000000-0000-0000-0000-000000000001', 4, '2025-04-15', 'realizado', 1200000),
  ('50000000-0000-0000-0000-000000000001', 7, '2025-07-15', 'programado', 0),
  ('50000000-0000-0000-0000-000000000001', 10, '2025-10-15', 'pendiente', 0);

-- Mantenimientos del contrato 2 (Zentral - 6 al año)
INSERT INTO contrato_mantenimientos (contrato_id, mes, fecha_programada, estado, valor_recaudado)
VALUES
  ('50000000-0000-0000-0000-000000000002', 1, '2025-01-10', 'realizado', 1400000),
  ('50000000-0000-0000-0000-000000000002', 3, '2025-03-10', 'realizado', 1400000),
  ('50000000-0000-0000-0000-000000000002', 5, '2025-05-10', 'realizado', 1400000),
  ('50000000-0000-0000-0000-000000000002', 7, '2025-07-10', 'programado', 0),
  ('50000000-0000-0000-0000-000000000002', 9, '2025-09-10', 'pendiente', 0),
  ('50000000-0000-0000-0000-000000000002', 11, '2025-11-10', 'pendiente', 0);

-- ── 6. Mantenimientos ───────────────────────────────────────
INSERT INTO mantenimientos (id, cliente_id, tecnico_id, lider_id, titulo, descripcion, fecha_programada, estado, prioridad, edificio, observaciones)
VALUES
  ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Mant. Preventivo Los Pinos - Enero', 'Mantenimiento preventivo trimestral de puertas peatonales y vehiculares', '2025-01-15', 'completado', 'media', 'Torre A Los Pinos', 'Se realizaron ajustes en sensor de puerta peatonal 2'),
  ('60000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Mant. Preventivo Zentral - Enero', 'Mantenimiento preventivo bimestral', '2025-01-10', 'completado', 'alta', 'Zentral Office', 'Puerta vehicular 1 requiere cambio de motor próxima visita'),
  ('60000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Mant. Preventivo Plaza Norte - Abril', 'Mantenimiento preventivo trimestral del centro comercial', '2025-04-20', 'programado', 'alta', 'Plaza Norte', NULL),
  ('60000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005', NULL, 'Revisión Hospital San Rafael', 'Revisión de emergencia por falla en puerta principal', '2025-03-05', 'pendiente', 'alta', 'Edificio Principal HSR', 'Reportan que la puerta no cierra completamente'),
  ('60000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Mant. Preventivo Los Pinos - Abril', 'Segundo mantenimiento trimestral del año', '2025-04-15', 'en_progreso', 'media', 'Torre A Los Pinos', NULL);

-- Reportes de mantenimiento (para los completados)
INSERT INTO reportes_mantenimiento (id, mantenimiento_id, tecnico_id, cliente_id, observaciones, enviado, fecha_envio)
VALUES
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'Mantenimiento realizado sin novedades. Se ajustaron sensores.', true, '2025-01-16T10:00:00Z'),
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Se recomienda cotización de motor para puerta vehicular 1.', true, '2025-01-11T14:00:00Z');

-- Evidencias fotográficas de mantenimientos
INSERT INTO mantenimiento_fotos (mantenimiento_id, tipo, url, orden)
VALUES
  ('60000000-0000-0000-0000-000000000001', 'antes', 'https://example.com/mant/6001/antes-1.jpg', 1),
  ('60000000-0000-0000-0000-000000000001', 'despues', 'https://example.com/mant/6001/despues-1.jpg', 1),
  ('60000000-0000-0000-0000-000000000002', 'antes', 'https://example.com/mant/6002/antes-1.jpg', 1),
  ('60000000-0000-0000-0000-000000000002', 'despues', 'https://example.com/mant/6002/despues-1.jpg', 1);

-- ── 7. Visitas Técnicas ─────────────────────────────────────
INSERT INTO visitas_tecnicas (id, tecnico_id, lider_id, cliente_id, descripcion, tipo_visita, estado, fecha_inicio, edificio, valor_cobrado_cliente, observaciones)
VALUES
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Revisión de sensor de proximidad en puerta peatonal 3', 'imprevisto', 'verificada', '2025-02-10T09:00:00Z', 'Torre A Los Pinos', 85000, 'Sensor reemplazado exitosamente'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Revisión garantía motor puerta vehicular 1', 'garantia', 'pendiente', '2025-03-01T08:30:00Z', 'Zentral Office', 0, 'Pendiente confirmar repuesto con proveedor'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'Atención de emergencia puerta principal hospital', 'emergencia', 'verificada', '2025-02-20T07:00:00Z', 'Edificio Principal HSR', 150000, 'Se reparó el mecanismo de cierre. Funcionando correctamente.');

INSERT INTO visita_tecnica_fotos (visita_tecnica_id, tipo, url, orden)
VALUES
  ('70000000-0000-0000-0000-000000000001', 'antes', 'https://example.com/visita/7001/antes-1.jpg', 1),
  ('70000000-0000-0000-0000-000000000001', 'despues', 'https://example.com/visita/7001/despues-1.jpg', 1),
  ('70000000-0000-0000-0000-000000000003', 'antes', 'https://example.com/visita/7003/antes-1.jpg', 1);

-- ── 8. Períodos de Liquidación ─────────────────────────────
INSERT INTO periodos_liquidacion (id, fecha_inicio, fecha_fin, estado, fecha_cierre)
VALUES
  ('80000000-0000-0000-0000-000000000001', '2025-01-01', '2025-01-14', 'cerrado', '2025-01-15T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000002', '2025-01-15', '2025-01-28', 'cerrado', '2025-01-29T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000003', '2025-01-29', '2025-02-11', 'cerrado', '2025-02-12T00:00:00Z'),
  ('80000000-0000-0000-0000-000000000004', '2025-02-12', '2025-02-25', 'abierto', NULL);

-- ── 9. Registros de Actividades (para liquidación) ─────────
INSERT INTO registros_actividades (id, actividad_id, lider_id, grupo_id, cliente_nombre, cliente_id, edificio, lugar, fecha, confirmado)
VALUES
  ('90000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Conjunto Residencial Los Pinos', '30000000-0000-0000-0000-000000000001', 'Torre A Los Pinos', 'Torre A Los Pinos', '2025-01-05', true),
  ('90000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Edificio Corporativo Zentral', '30000000-0000-0000-0000-000000000002', 'Zentral Office', 'Zentral Office', '2025-01-08', true),
  ('90000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Centro Comercial Plaza Norte', '30000000-0000-0000-0000-000000000003', 'Plaza Norte', 'Plaza Norte', '2025-01-12', true);

-- Participantes de actividades
INSERT INTO actividad_participantes (registro_actividad_id, tecnico_id, porcentaje, valor_calculado)
VALUES
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 60, 51000),
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 40, 34000),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 50, 60000),
  ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 50, 60000),
  ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 100, 65000);

-- Bandeja de aprobación líder
INSERT INTO items_aprobacion (tipo, referencia_id, lider_id, tecnico_id, descripcion, edificio, fecha, valor, estado, fecha_aprobacion)
VALUES
  ('actividad', '90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Aprobación mantenimiento peatonal Los Pinos', 'Torre A Los Pinos', '2025-01-05', 85000, 'aprobada', '2025-01-06T10:00:00Z'),
  ('actividad', '90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'Aprobación mantenimiento vehicular Zentral', 'Zentral Office', '2025-01-08', 120000, 'aprobada', '2025-01-09T11:00:00Z'),
  ('visita_tecnica', '70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'Validación visita por garantía', 'Zentral Office', '2025-03-01', 0, 'pendiente', NULL);

-- ── 10. Reportes de Actividad ───────────────────────────────
INSERT INTO reportes_actividad (id, tipo, tecnico_id, lider_grupo_id, grupo_id, cliente_id, fecha, descripcion, estado_aprobacion_lider, costo_actividad, periodo_id)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'mantenimiento_preventivo', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2025-01-05', 'Mantenimiento preventivo puertas peatonales Torre A', 'aprobado', 85000, '80000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', 'mantenimiento_preventivo', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '2025-01-08', 'Mantenimiento preventivo Zentral Office', 'aprobado', 120000, '80000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'visita_tecnica', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '2025-01-12', 'Inspección técnica puertas centro comercial', 'pendiente', 65000, '80000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'recorrido', '10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', NULL, '2025-02-15', 'Recorrido con herramienta entre sedes', 'aprobado', 40000, '80000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000005', 'mantenimiento_preventivo', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', '2025-02-18', 'Mantenimiento puertas Hospital San Rafael', 'pendiente', 85000, '80000000-0000-0000-0000-000000000004');

-- Actualizar datos extras de reportes con recorrido
UPDATE reportes_actividad
SET punto_partida = 'Bodega Central Cra 30', punto_llegada = 'Hospital San Rafael Calle 63', tipo_recorrido = 'con_herramienta'
WHERE id = '00000000-0000-0000-0000-000000000004';

INSERT INTO reporte_actividad_fotos (reporte_actividad_id, tipo, url, orden)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'antes', 'https://example.com/reportes/0001/antes-1.jpg', 1),
  ('00000000-0000-0000-0000-000000000001', 'despues', 'https://example.com/reportes/0001/despues-1.jpg', 1),
  ('00000000-0000-0000-0000-000000000002', 'antes', 'https://example.com/reportes/0002/antes-1.jpg', 1),
  ('00000000-0000-0000-0000-000000000002', 'despues', 'https://example.com/reportes/0002/despues-1.jpg', 1);

-- ── 11. Registros de Asistencia (Llegadas) ──────────────────
INSERT INTO registros_asistencia (usuario_id, fecha, hora_entrada_programada, hora_salida_programada, hora_entrada_real, estado_entrada, minutos_retraso, tarde)
VALUES
  ('10000000-0000-0000-0000-000000000003', '2025-02-24', '07:00', '17:00', '07:00', 'a_tiempo', 0, false),
  ('10000000-0000-0000-0000-000000000004', '2025-02-24', '07:00', '17:00', '07:15', 'tarde', 15, true),
  ('10000000-0000-0000-0000-000000000005', '2025-02-24', '07:00', '17:00', '06:55', 'a_tiempo', 0, false),
  ('10000000-0000-0000-0000-000000000003', '2025-02-25', '07:00', '17:00', '07:25', 'tarde', 25, true),
  ('10000000-0000-0000-0000-000000000004', '2025-02-25', '07:00', '17:00', '07:00', 'a_tiempo', 0, false),
  ('10000000-0000-0000-0000-000000000005', '2025-02-25', '07:00', '17:00', '07:05', 'a_tiempo', 5, false);

-- ── 12. Acumulación de Líderes ──────────────────────────────
INSERT INTO acumulacion_lideres (lider_id, periodo_id, total_aprobado_pago, total_pendiente_pago, extra_lider, total_recorridos, total_acumulado, porcentaje_extra_lider_aplicado, extra_lider_activo)
VALUES
  ('10000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', 205000, 0, 20500, 0, 225500, 10, true),
  ('10000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 0, 65000, 0, 0, 65000, 10, true),
  ('10000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000003', 40000, 0, 0, 40000, 80000, 10, true);

-- ── 13. Lotes de Aprobación ─────────────────────────────────
INSERT INTO lotes_aprobacion_lider (lider_id, grupo_id, periodo_id, reportes_aprobados, fecha_cierre, costo_lider_por_revision, total_revisiones, total_costo_lider)
VALUES
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', ARRAY['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']::uuid[], '2025-01-14T18:00:00Z', 15000, 2, 30000);

-- ── 14. Items de Liquidación ────────────────────────────────
INSERT INTO items_liquidacion (tecnico_id, periodo_id, nombre_actividad, edificio, fecha, porcentaje, valor_base, valor_ganado, tipo, estado, referencia_id)
VALUES
  ('10000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000001', 'Mant. Preventivo Puertas Peatonales', 'Torre A Los Pinos', '2025-01-05', 60, 85000, 51000, 'actividad', 'aprobado', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000001', 'Mant. Preventivo Puertas Vehiculares', 'Zentral Office', '2025-01-08', 50, 120000, 60000, 'actividad', 'aprobado', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000001', 'Mant. Preventivo Puertas Peatonales', 'Torre A Los Pinos', '2025-01-05', 40, 85000, 34000, 'actividad', 'aprobado', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000001', 'Mant. Preventivo Puertas Vehiculares', 'Zentral Office', '2025-01-08', 50, 120000, 60000, 'actividad', 'aprobado', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000003', 'Recorrido con Herramienta', NULL, '2025-02-15', 100, 40000, 40000, 'recorrido', 'aprobado', '00000000-0000-0000-0000-000000000004');

-- ── 15. Recorridos ──────────────────────────────────────────
INSERT INTO recorridos (tecnico_id, fecha, punto_partida, punto_llegada, tipo_recorrido, fecha_inicio, fecha_fin, estado, valor)
VALUES
  ('10000000-0000-0000-0000-000000000005', '2025-02-15', 'Bodega Central Cra 30', 'Hospital San Rafael Calle 63', 'con_herramienta', '2025-02-15T08:00:00Z', '2025-02-15T09:30:00Z', 'completado', 40000),
  ('10000000-0000-0000-0000-000000000003', '2025-02-20', 'Oficina Principal', 'Centro Comercial Plaza Norte', 'normal', '2025-02-20T07:30:00Z', '2025-02-20T08:15:00Z', 'completado', 25000);

-- ── 16. Notificaciones ───────────────────────────────────────
INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo, leida, metadata)
VALUES
  ('10000000-0000-0000-0000-000000000003', 'Mantenimiento Programado', 'Se te asignó mantenimiento en Torre A Los Pinos para el 2025-04-20.', 'maintenance', false, '{"mantenimientoId":"60000000-0000-0000-0000-000000000003"}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'Visita Pendiente', 'Tienes una visita técnica pendiente de ejecución en Zentral Office.', 'visit', false, '{"visitaId":"70000000-0000-0000-0000-000000000002"}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'Aprobación Requerida', 'Hay reportes pendientes por aprobar del Grupo Norte.', 'approval', false, '{"grupoId":"20000000-0000-0000-0000-000000000001"}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', 'Liquidación Cerrada', 'El período 2025-01-29 a 2025-02-11 fue cerrado. Revisa tu comprobante.', 'liquidation', true, '{"periodoId":"80000000-0000-0000-0000-000000000003"}'::jsonb);

-- ── 17. Sesiones de Usuario ─────────────────────────────────
INSERT INTO sesiones_usuario (usuario_id, token, dispositivo, ip_address, user_agent, fecha_expiracion, activa)
VALUES
  ('10000000-0000-0000-0000-000000000002', 'seed-token-lider-001', 'Chrome Windows', '192.168.1.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', now() + interval '7 days', true),
  ('10000000-0000-0000-0000-000000000003', 'seed-token-tecnico-001', 'Android App', '192.168.1.11', 'okhttp/4.10.0', now() + interval '5 days', true),
  ('10000000-0000-0000-0000-000000000004', 'seed-token-tecnico-002', 'iPhone App', '192.168.1.12', 'CFNetwork iOS', now() + interval '5 days', true);

-- ============================================================
-- Seed de tablas completo sin usuarios administradores.
-- ============================================================
