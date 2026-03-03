-- ============================================================
-- BACKFILL: Sincronizar datos existentes hacia reportes_actividad
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase
-- ============================================================

-- ── 1. Visitas Técnicas existentes ──────────────────────────
-- Inserta visitas técnicas que no tienen espejo en reportes_actividad

INSERT INTO reportes_actividad (
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  cliente_id,
  fecha,
  descripcion,
  observaciones,
  estado_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id
)
SELECT
  'visita_tecnica'                          AS tipo,
  vt.tecnico_id,
  gt.lider_id                               AS lider_grupo_id,
  u.grupo_id,
  vt.cliente_id,
  vt.fecha_inicio::date                     AS fecha,
  COALESCE(vt.descripcion, '')             AS descripcion,
  vt.observaciones,
  'pendiente'                               AS estado_aprobacion_lider,
  COALESCE(vt.valor_cobrado_cliente, 0)    AS costo_actividad,
  true                                      AS costo_administrable,
  (
    SELECT id FROM periodos_liquidacion pl
    WHERE pl.estado = 'abierto'
      AND pl.fecha_inicio <= vt.fecha_inicio::date
      AND pl.fecha_fin    >= vt.fecha_inicio::date
    ORDER BY pl.fecha_inicio DESC
    LIMIT 1
  )                                         AS periodo_id
FROM visitas_tecnicas vt
LEFT JOIN usuarios u         ON u.id = vt.tecnico_id
LEFT JOIN grupos_trabajo gt  ON gt.id = u.grupo_id
WHERE NOT EXISTS (
  SELECT 1 FROM reportes_actividad ra
  WHERE ra.tipo        = 'visita_tecnica'
    AND ra.tecnico_id  = vt.tecnico_id
    AND ra.fecha       = vt.fecha_inicio::date
);

-- ── 2. Recorridos existentes ─────────────────────────────────
-- Inserta recorridos que no tienen espejo en reportes_actividad

INSERT INTO reportes_actividad (
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  fecha,
  descripcion,
  punto_partida,
  punto_llegada,
  tipo_recorrido,
  estado_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id
)
SELECT
  'recorrido'                               AS tipo,
  r.tecnico_id,
  gt.lider_id                               AS lider_grupo_id,
  u.grupo_id,
  r.fecha::date                             AS fecha,
  CONCAT(
    'Recorrido ',
    CASE r.tipo_recorrido WHEN 'con_herramienta' THEN 'con herramienta' ELSE 'normal' END,
    ': ', COALESCE(r.punto_partida, ''), ' → ', COALESCE(r.punto_llegada, '')
  )                                         AS descripcion,
  r.punto_partida,
  r.punto_llegada,
  r.tipo_recorrido,
  'pendiente'                               AS estado_aprobacion_lider,
  COALESCE(r.valor, 0)                     AS costo_actividad,
  false                                     AS costo_administrable,
  (
    SELECT id FROM periodos_liquidacion pl
    WHERE pl.estado = 'abierto'
      AND pl.fecha_inicio <= r.fecha::date
      AND pl.fecha_fin    >= r.fecha::date
    ORDER BY pl.fecha_inicio DESC
    LIMIT 1
  )                                         AS periodo_id
FROM recorridos r
LEFT JOIN usuarios u         ON u.id = r.tecnico_id
LEFT JOIN grupos_trabajo gt  ON gt.id = u.grupo_id
WHERE NOT EXISTS (
  SELECT 1 FROM reportes_actividad ra
  WHERE ra.tipo        = 'recorrido'
    AND ra.tecnico_id  = r.tecnico_id
    AND ra.fecha       = r.fecha::date
);

-- ── 3. Reportes de Mantenimiento existentes ──────────────────
-- Inserta mantenimientos completados que no tienen espejo en reportes_actividad

INSERT INTO reportes_actividad (
  tipo,
  tecnico_id,
  lider_grupo_id,
  grupo_id,
  cliente_id,
  fecha,
  descripcion,
  estado_aprobacion_lider,
  costo_actividad,
  costo_administrable,
  periodo_id
)
SELECT
  'mantenimiento_preventivo'                AS tipo,
  rm.tecnico_id,
  gt.lider_id                               AS lider_grupo_id,
  u.grupo_id,
  rm.cliente_id,
  COALESCE(m.fecha_programada::date, rm.fecha_generacion::date) AS fecha,
  COALESCE(rm.observaciones, 'Mantenimiento preventivo realizado') AS descripcion,
  'pendiente'                               AS estado_aprobacion_lider,
  0                                         AS costo_actividad,
  true                                      AS costo_administrable,
  (
    SELECT id FROM periodos_liquidacion pl
    WHERE pl.estado = 'abierto'
      AND pl.fecha_inicio <= COALESCE(m.fecha_programada::date, rm.fecha_generacion::date)
      AND pl.fecha_fin    >= COALESCE(m.fecha_programada::date, rm.fecha_generacion::date)
    ORDER BY pl.fecha_inicio DESC
    LIMIT 1
  )                                         AS periodo_id
FROM reportes_mantenimiento rm
LEFT JOIN mantenimientos m   ON m.id = (COALESCE(rm.mantenimiento_id, rm.id))
LEFT JOIN usuarios u         ON u.id = rm.tecnico_id
LEFT JOIN grupos_trabajo gt  ON gt.id = u.grupo_id
WHERE NOT EXISTS (
  SELECT 1 FROM reportes_actividad ra
  WHERE ra.tipo        = 'mantenimiento_preventivo'
    AND ra.tecnico_id  = rm.tecnico_id
    AND ra.fecha       = COALESCE(m.fecha_programada::date, rm.fecha_generacion::date)
    AND ra.cliente_id  = rm.cliente_id
);
