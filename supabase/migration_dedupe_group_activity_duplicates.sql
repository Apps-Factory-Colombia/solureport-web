-- ============================================================
-- CONSOLIDACION: actividades grupales legacy duplicadas
-- Ejecutar en Supabase SQL Editor una sola vez
-- ============================================================

BEGIN;

-- 1) Consolidar registros_actividades duplicados por misma actividad/lider/grupo/cliente/fecha.
WITH duplicate_registros AS (
  SELECT
    id,
    actividad_id,
    lider_id,
    grupo_id,
    cliente_id,
    fecha,
    especificacion,
    fecha_creacion,
    FIRST_VALUE(id) OVER (
      PARTITION BY actividad_id, lider_id, grupo_id, cliente_id, fecha
      ORDER BY
        CASE WHEN COALESCE(TRIM(especificacion), '') <> '' THEN 0 ELSE 1 END,
        fecha_creacion DESC,
        id DESC
    ) AS canonical_id,
    ROW_NUMBER() OVER (
      PARTITION BY actividad_id, lider_id, grupo_id, cliente_id, fecha
      ORDER BY
        CASE WHEN COALESCE(TRIM(especificacion), '') <> '' THEN 0 ELSE 1 END,
        fecha_creacion DESC,
        id DESC
    ) AS row_num
  FROM public.registros_actividades
), registros_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_registros
  WHERE row_num > 1
    AND id <> canonical_id
)
UPDATE public.actividad_participantes ap
SET registro_actividad_id = rtm.canonical_id
FROM registros_to_merge rtm
WHERE ap.registro_actividad_id = rtm.id;

WITH duplicate_participantes AS (
  SELECT
    registro_actividad_id,
    tecnico_id,
    id,
    ROW_NUMBER() OVER (
      PARTITION BY registro_actividad_id, tecnico_id
      ORDER BY id DESC
    ) AS row_num
  FROM public.actividad_participantes
)
DELETE FROM public.actividad_participantes ap
USING duplicate_participantes dp
WHERE ap.id = dp.id
  AND dp.row_num > 1;

DELETE FROM public.registros_actividades ra
USING registros_to_merge rtm
WHERE ra.id = rtm.id;

-- 2) Consolidar espejos duplicados en reportes_actividad para actividades grupales.
WITH duplicate_reports AS (
  SELECT
    id,
    tipo,
    tecnico_id,
    lider_grupo_id,
    grupo_id,
    cliente_id,
    fecha,
    descripcion,
    fecha_creacion,
    FIRST_VALUE(id) OVER (
      PARTITION BY tipo, tecnico_id, lider_grupo_id, grupo_id, cliente_id, fecha, descripcion
      ORDER BY fecha_creacion DESC, id DESC
    ) AS canonical_id,
    ROW_NUMBER() OVER (
      PARTITION BY tipo, tecnico_id, lider_grupo_id, grupo_id, cliente_id, fecha, descripcion
      ORDER BY fecha_creacion DESC, id DESC
    ) AS row_num
  FROM public.reportes_actividad
  WHERE tipo IN ('actividad', 'actividad_grupal')
), reports_to_merge AS (
  SELECT id, canonical_id
  FROM duplicate_reports
  WHERE row_num > 1
    AND id <> canonical_id
)
UPDATE public.items_aprobacion ia
SET referencia_id = rtm.canonical_id
FROM reports_to_merge rtm
WHERE ia.referencia_id = rtm.id;

WITH duplicate_approval_refs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tecnico_id, fecha, tipo, COALESCE(referencia_id, '')
      ORDER BY id DESC
    ) AS row_num
  FROM public.items_aprobacion
  WHERE tipo = 'actividad'
)
DELETE FROM public.items_aprobacion ia
USING duplicate_approval_refs dar
WHERE ia.id = dar.id
  AND dar.row_num > 1;

UPDATE public.items_liquidacion il
SET referencia_id = rtm.canonical_id
FROM reports_to_merge rtm
WHERE il.referencia_id = rtm.id;

WITH duplicate_liq_refs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tecnico_id, fecha, tipo, periodo_id, COALESCE(referencia_id, '')
      ORDER BY id DESC
    ) AS row_num
  FROM public.items_liquidacion
  WHERE tipo = 'actividad'
)
DELETE FROM public.items_liquidacion il
USING duplicate_liq_refs dlr
WHERE il.id = dlr.id
  AND dlr.row_num > 1;

DELETE FROM public.reportes_actividad ra
USING reports_to_merge rtm
WHERE ra.id = rtm.id;

COMMIT;
