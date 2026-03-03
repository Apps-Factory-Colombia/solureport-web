-- ============================================================
-- SOLUREPORT - DROP/RESET SOLO TABLAS (sin funciones ni storage)
-- Ejecutar antes de seed.sql
-- ============================================================

BEGIN;

TRUNCATE TABLE
  grupo_miembros,
  actividad_participantes,
  actividades_historial_precios,
  items_aprobacion,
  reporte_actividad_fotos,
  mantenimiento_fotos,
  visita_tecnica_fotos,
  lotes_aprobacion_lider,
  acumulacion_lideres,
  items_liquidacion,
  notificaciones,
  sesiones_usuario,
  registros_asistencia,
  reportes_actividad,
  registros_actividades,
  reportes_mantenimiento,
  recorridos,
  visitas_tecnicas,
  mantenimientos,
  contrato_mantenimientos,
  contratos_mantenimiento,
  actividades,
  clientes,
  periodos_liquidacion,
  grupos_trabajo,
  usuarios,
  configuracion_empresa
RESTART IDENTITY CASCADE;

COMMIT;
