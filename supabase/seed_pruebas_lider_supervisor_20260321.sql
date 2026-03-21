-- ============================================================
-- SOLUREPORT - Datos de prueba para líder y supervisor
-- Fecha de prueba: 2026-03-21
--
-- Objetivo:
-- 1. Verificar que el extra líder sí tenga base para calcularse.
-- 2. Verificar que los recorridos sí entren al acumulado del período.
-- 3. Verificar que existan tardanzas con descuento aplicado para revisar
--    si la liquidación realmente las descuenta o no.
--
-- Usuarios objetivo:
-- - Supervisor técnico: 41599e38-1b78-4a01-bdb3-377856b7025d
-- - Líder:             3f4ae540-9d3c-4390-a80f-b44359715719
-- Grupo:
-- - 586f885e-99e5-4884-89d4-965b307e9fa0
-- Período abierto:
-- - 8a7fe15f-f025-46c3-a491-2ccce367291b (2026-03-17 al 2026-03-30)
-- ============================================================

BEGIN;

-- ── 0. Configuración base para la prueba ─────────────────────
UPDATE configuracion_empresa
SET porcentaje_descuento_tardanza = 5.00,
    porcentaje_extra_lider = 10.00,
    extra_lider_activo = true,
    costo_recorrido_normal = 25000.00,
    costo_recorrido_herramienta = 40000.00,
    fecha_actualizacion = now();

-- ── 1. Asegurar pertenencia al grupo y permisos de recorrido ──
UPDATE usuarios
SET grupo_id = '586f885e-99e5-4884-89d4-965b307e9fa0',
    tiene_recorrido = true,
    tiene_moto = true,
    routes_enabled = true,
    fecha_actualizacion = now()
WHERE id = '41599e38-1b78-4a01-bdb3-377856b7025d';

UPDATE usuarios
SET grupo_id = '586f885e-99e5-4884-89d4-965b307e9fa0',
    es_lider = true,
    fecha_actualizacion = now()
WHERE id = '3f4ae540-9d3c-4390-a80f-b44359715719';

INSERT INTO grupo_miembros (grupo_id, usuario_id)
VALUES
  ('586f885e-99e5-4884-89d4-965b307e9fa0', '3f4ae540-9d3c-4390-a80f-b44359715719'),
  ('586f885e-99e5-4884-89d4-965b307e9fa0', '41599e38-1b78-4a01-bdb3-377856b7025d')
ON CONFLICT (grupo_id, usuario_id) DO NOTHING;

-- ── 2. Cliente exclusivo para estas pruebas ──────────────────
INSERT INTO clientes (
  id,
  nombre,
  edificio,
  direccion,
  ciudad,
  contacto,
  correo,
  telefono,
  frecuencia_mantenimiento,
  puertas_peatonales,
  puertas_vehiculares,
  estado,
  fecha_actualizacion
)
VALUES (
  'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
  'Cliente Pruebas Acumulados 2026-03-21',
  'Edificio Control Pruebas',
  'Cra 00 #00-00',
  'Bogota',
  'QA SoluReport',
  'qa.acumulados.20260321@solureport.test',
  '3000000000',
  2,
  1,
  1,
  'activo',
  now()
)
ON CONFLICT (id) DO UPDATE
SET nombre = EXCLUDED.nombre,
    edificio = EXCLUDED.edificio,
    direccion = EXCLUDED.direccion,
    ciudad = EXCLUDED.ciudad,
    contacto = EXCLUDED.contacto,
    correo = EXCLUDED.correo,
    telefono = EXCLUDED.telefono,
    frecuencia_mantenimiento = EXCLUDED.frecuencia_mantenimiento,
    puertas_peatonales = EXCLUDED.puertas_peatonales,
    puertas_vehiculares = EXCLUDED.puertas_vehiculares,
    estado = EXCLUDED.estado,
    fecha_actualizacion = now();

-- ── 3. Limpiar únicamente datos de esta semilla para reejecución ──
DELETE FROM registros_asistencia
WHERE id IN (
  '6b7d0866-5b77-4e95-89f1-2cba71f65a01',
  '6b7d0866-5b77-4e95-89f1-2cba71f65a02'
);

DELETE FROM reportes_actividad
WHERE id IN (
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1001',
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1002',
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1003',
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1004',
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1005'
);

DELETE FROM recorridos
WHERE id IN (
  'd5f26f56-b741-4d77-9aca-6f38a40f9001',
  'd5f26f56-b741-4d77-9aca-6f38a40f9002'
);

-- ── 4. Configuración del extra líder para este período ───────
-- Se usa el mismo líder como excluido para evitar que la app excluya
-- automáticamente al primer miembro del grupo y deje el extra en cero.
UPDATE acumulacion_lideres
SET porcentaje_extra_lider_aplicado = 10.00,
    extra_lider_activo = true,
    tecnicos_excluidos_extra_ids = ARRAY['3f4ae540-9d3c-4390-a80f-b44359715719']::uuid[],
    fecha_actualizacion = now()
WHERE lider_id = '3f4ae540-9d3c-4390-a80f-b44359715719'
  AND periodo_id = '8a7fe15f-f025-46c3-a491-2ccce367291b';

INSERT INTO acumulacion_lideres (
  id,
  lider_id,
  periodo_id,
  total_aprobado_pago,
  total_pendiente_pago,
  extra_lider,
  total_recorridos,
  total_acumulado,
  porcentaje_extra_lider_aplicado,
  extra_lider_activo,
  tecnicos_excluidos_extra_ids,
  fecha_actualizacion
)
SELECT
  'ad4581c0-21a9-4d4c-9664-3850f4f79e01',
  '3f4ae540-9d3c-4390-a80f-b44359715719',
  '8a7fe15f-f025-46c3-a491-2ccce367291b',
  0,
  0,
  0,
  0,
  0,
  10.00,
  true,
  ARRAY['3f4ae540-9d3c-4390-a80f-b44359715719']::uuid[],
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM acumulacion_lideres
  WHERE lider_id = '3f4ae540-9d3c-4390-a80f-b44359715719'
    AND periodo_id = '8a7fe15f-f025-46c3-a491-2ccce367291b'
);

-- ── 5. Reportes no-recorrido del supervisor técnico ──────────
-- Base para extra líder: 30.000 + 70.000 = 100.000
INSERT INTO reportes_actividad (
  id,
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  cliente_id,
  fecha,
  descripcion,
  observaciones,
  estado_aprobacion_lider,
  fecha_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id,
  fecha_actualizacion
)
VALUES
  (
    'd4aa1ec0-0f2a-4c87-b00f-871aa54f1001',
    'mantenimiento_preventivo',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '3f4ae540-9d3c-4390-a80f-b44359715719',
    '586f885e-99e5-4884-89d4-965b307e9fa0',
    'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
    '2026-03-19',
    '[PRUEBA 2026-03-21] Actividad INS-VF2 O 3 aprobada para supervisor',
    'Caso de prueba para validar base de extra líder.',
    'aprobado',
    '2026-03-19 18:10:00+00',
    30000,
    false,
    '8a7fe15f-f025-46c3-a491-2ccce367291b',
    now()
  ),
  (
    'd4aa1ec0-0f2a-4c87-b00f-871aa54f1002',
    'visita_tecnica',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '3f4ae540-9d3c-4390-a80f-b44359715719',
    '586f885e-99e5-4884-89d4-965b307e9fa0',
    'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
    '2026-03-20',
    '[PRUEBA 2026-03-21] Visita técnica aprobada para supervisor',
    'Segundo valor base para extra líder.',
    'aprobado',
    '2026-03-20 16:45:00+00',
    70000,
    false,
    '8a7fe15f-f025-46c3-a491-2ccce367291b',
    now()
  );

-- ── 6. Reporte no-recorrido del líder ───────────────────────
INSERT INTO reportes_actividad (
  id,
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  cliente_id,
  fecha,
  descripcion,
  observaciones,
  estado_aprobacion_lider,
  fecha_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id,
  fecha_actualizacion
)
VALUES (
  'd4aa1ec0-0f2a-4c87-b00f-871aa54f1003',
  'visita_tecnica',
  '3f4ae540-9d3c-4390-a80f-b44359715719',
  '3f4ae540-9d3c-4390-a80f-b44359715719',
  '586f885e-99e5-4884-89d4-965b307e9fa0',
  'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
  '2026-03-21',
  '[PRUEBA 2026-03-21] Visita técnica aprobada para líder',
  'Caso de prueba para revisar descuento por tardanza sobre líder.',
  'aprobado',
  '2026-03-21 13:00:00+00',
  60000,
  false,
  '8a7fe15f-f025-46c3-a491-2ccce367291b',
  now()
);

-- ── 7. Recorridos del supervisor técnico ────────────────────
INSERT INTO recorridos (
  id,
  tecnico_id,
  fecha,
  punto_partida,
  punto_llegada,
  tipo_recorrido,
  fecha_inicio,
  fecha_fin,
  estado,
  valor
)
VALUES
  (
    'd5f26f56-b741-4d77-9aca-6f38a40f9001',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '2026-03-19',
    'Bodega Principal',
    'Cliente Pruebas Acumulados 2026-03-21',
    'normal',
    '2026-03-19 07:10:00+00',
    '2026-03-19 07:55:00+00',
    'completado',
    25000
  ),
  (
    'd5f26f56-b741-4d77-9aca-6f38a40f9002',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '2026-03-20',
    'Cliente Pruebas Acumulados 2026-03-21',
    'Bodega Principal',
    'con_herramienta',
    '2026-03-20 17:20:00+00',
    '2026-03-20 18:05:00+00',
    'completado',
    40000
  );

INSERT INTO reportes_actividad (
  id,
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  cliente_id,
  fecha,
  descripcion,
  punto_partida,
  punto_llegada,
  tipo_recorrido,
  estado_aprobacion_lider,
  fecha_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id,
  fecha_actualizacion
)
VALUES
  (
    'd4aa1ec0-0f2a-4c87-b00f-871aa54f1004',
    'recorrido',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '3f4ae540-9d3c-4390-a80f-b44359715719',
    '586f885e-99e5-4884-89d4-965b307e9fa0',
    'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
    '2026-03-19',
    '[PRUEBA 2026-03-21] Recorrido normal supervisor',
    'Bodega Principal',
    'Cliente Pruebas Acumulados 2026-03-21',
    'normal',
    'aprobado',
    '2026-03-19 08:05:00+00',
    25000,
    false,
    '8a7fe15f-f025-46c3-a491-2ccce367291b',
    now()
  ),
  (
    'd4aa1ec0-0f2a-4c87-b00f-871aa54f1005',
    'recorrido',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '3f4ae540-9d3c-4390-a80f-b44359715719',
    '586f885e-99e5-4884-89d4-965b307e9fa0',
    'f0c6b4bd-e5fb-4c72-8c59-4b3e0ca2c111',
    '2026-03-20',
    '[PRUEBA 2026-03-21] Recorrido con herramienta supervisor',
    'Cliente Pruebas Acumulados 2026-03-21',
    'Bodega Principal',
    'con_herramienta',
    'aprobado',
    '2026-03-20 18:10:00+00',
    40000,
    false,
    '8a7fe15f-f025-46c3-a491-2ccce367291b',
    now()
  );

-- ── 8. Asistencia con tardanza y descuento aplicado ─────────
-- El descuento queda marcado en asistencia, pero la app de liquidación
-- hoy no lo consume para restar del total a pagar.
INSERT INTO registros_asistencia (
  id,
  usuario_id,
  fecha,
  hora_entrada_programada,
  hora_salida_programada,
  hora_entrada_real,
  hora_salida_real,
  estado_entrada,
  estado_salida,
  minutos_retraso,
  tarde,
  razon_tardanza,
  descuento_aplicado,
  porcentaje_descuento,
  fecha_creacion
)
VALUES
  (
    '6b7d0866-5b77-4e95-89f1-2cba71f65a01',
    '41599e38-1b78-4a01-bdb3-377856b7025d',
    '2026-03-21',
    '07:00:00',
    '17:00:00',
    '07:42:00',
    '17:03:00',
    'tarde',
    'normal',
    42,
    true,
    '[PRUEBA 2026-03-21] Llegada tarde supervisor',
    true,
    5,
    now()
  ),
  (
    '6b7d0866-5b77-4e95-89f1-2cba71f65a02',
    '3f4ae540-9d3c-4390-a80f-b44359715719',
    '2026-03-21',
    '07:00:00',
    '17:00:00',
    '07:28:00',
    '17:01:00',
    'tarde',
    'normal',
    28,
    true,
    '[PRUEBA 2026-03-21] Llegada tarde líder',
    true,
    5,
    now()
  );

COMMIT;

-- ============================================================
-- RESULTADOS ESPERADOS DESPUÉS DE EJECUTAR ESTE SCRIPT
-- ============================================================
-- 1. En Acumulados > líder "Lider Grupo":
--    - Base aprobada del supervisor para extra líder: 100.000
--    - Extra líder esperado: 10.000
--    - Recorridos esperados del supervisor: 65.000
--
-- 2. En Liquidación > Supervisor Tecnico:
--    - Actividades no recorrido agregadas por esta prueba: 100.000
--    - Recorridos agregados por esta prueba: 65.000
--    - Total agregado por esta prueba sin descuento: 165.000
--    - Descuento esperado por tardanza sobre actividades: 5.000
--    - Si la app no descuenta tardanza, seguirá mostrando 165.000 en vez de 160.000.
--
-- 3. En Liquidación > Lider Grupo:
--    - Actividades agregadas por esta prueba: 60.000
--    - Descuento esperado por tardanza sobre actividades: 3.000
--    - Si la app no descuenta tardanza, seguirá mostrando 60.000 en vez de 57.000.
--
-- 4. En Llegadas del 2026-03-21:
--    - Supervisor Tecnico: 42 min tarde, descuento aplicado = true, porcentaje = 5
--    - Lider Grupo: 28 min tarde, descuento aplicado = true, porcentaje = 5