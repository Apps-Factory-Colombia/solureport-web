-- SoluReport V2 - identidad semántica de actividades operativas
--
-- Una actividad no se identifica por su código. Su identidad operacional es
-- el conjunto de: tipo, fecha, cliente, sede, grupo, descripción,
-- observaciones, detalle propio del tipo y técnicos participantes.
--
-- Esta migración hace tres cosas dentro de una única transacción:
--   1. Respalda y consolida los duplicados semánticos actuales.
--   2. Guarda una huella SHA-256 en la actividad canónica.
--   3. Protege futuras inserciones con un índice único y triggers diferidos.
--
-- Los respaldos quedan en legacy_backup.v2_semantic_20260830_* y el mapa de
-- absorción permite auditar qué códigos fueron consolidados.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_advisory_xact_lock(hashtextextended('solureport-v2-semantic-fingerprint-20260830', 0));

CREATE EXTENSION IF NOT EXISTS pgcrypto;

LOCK TABLE public.actividades_operativas IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_participantes IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_aprobaciones IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_entregas IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_evidencias IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_catalogo IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_visitas IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_recorridos IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_mantenimientos IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.liquidacion_items IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.lote_aprobacion_items IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.operaciones_idempotencia IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.liquidacion_items
  DISABLE TRIGGER trg_validate_liquidation_period_open;

-- Las validaciones operativas siguen activas para la aplicación. Durante la
-- consolidación se desactivan únicamente porque estamos reparentando filas
-- históricas ya existentes; se vuelven a activar antes del COMMIT.
ALTER TABLE public.actividades_operativas_aprobaciones
  DISABLE TRIGGER trg_validate_approval_reviewer;
ALTER TABLE public.actividades_operativas_participantes
  DISABLE TRIGGER trg_validate_participant_group;
ALTER TABLE public.actividades_operativas_participantes
  DISABLE TRIGGER trg_validate_participant_percentage_total;

ALTER TABLE public.actividades_operativas
  ADD COLUMN IF NOT EXISTS huella_semantica text;

DO $$
BEGIN
  IF to_regclass('legacy_backup.v2_semantic_20260830_activity_map') IS NOT NULL THEN
    RAISE EXCEPTION 'El respaldo v2_semantic_20260830 ya existe; no se sobrescribe.';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. Función determinística de identidad semántica
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_huella_semantica_actividad(
  p_tipo text,
  p_cliente_id uuid,
  p_sede_id uuid,
  p_grupo_id uuid,
  p_fecha date,
  p_descripcion text,
  p_observaciones text,
  p_catalogo_actividad_id uuid,
  p_especificacion text,
  p_mantenimiento_programado_id uuid,
  p_mantenimiento_titulo text,
  p_mantenimiento_tipo_pendiente text,
  p_mantenimiento_descripcion_pendiente text,
  p_tipo_visita text,
  p_receptor_nombre text,
  p_receptor_cedula text,
  p_receptor_cargo text,
  p_punto_partida text,
  p_punto_llegada text,
  p_tipo_recorrido text,
  p_participantes jsonb
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tipo text := lower(regexp_replace(trim(coalesce(p_tipo, '')), '\s+', ' ', 'g'));
  v_participantes jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(to_jsonb(x.tecnico_id) ORDER BY x.tecnico_id),
    '[]'::jsonb
  )
  INTO v_participantes
  FROM (
    SELECT DISTINCT nullif(trim(elemento ->> 'tecnico_id'), '') AS tecnico_id
    FROM jsonb_array_elements(coalesce(p_participantes, '[]'::jsonb)) AS elemento
    WHERE nullif(trim(elemento ->> 'tecnico_id'), '') IS NOT NULL
  ) AS x;

  RETURN encode(
    digest(
      convert_to(
        jsonb_build_array(
          v_tipo,
          coalesce(p_cliente_id::text, ''),
          coalesce(p_sede_id::text, ''),
          coalesce(p_grupo_id::text, ''),
          coalesce(p_fecha::text, ''),
          lower(regexp_replace(trim(coalesce(p_descripcion, '')), '\s+', ' ', 'g')),
          lower(regexp_replace(trim(coalesce(p_observaciones, '')), '\s+', ' ', 'g')),
          CASE WHEN v_tipo = 'actividad' THEN coalesce(p_catalogo_actividad_id::text, '') ELSE '' END,
          CASE WHEN v_tipo = 'actividad' THEN lower(regexp_replace(trim(coalesce(p_especificacion, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'mantenimiento' THEN coalesce(p_mantenimiento_programado_id::text, '') ELSE '' END,
          CASE WHEN v_tipo = 'mantenimiento' THEN lower(regexp_replace(trim(coalesce(p_mantenimiento_titulo, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'mantenimiento' THEN lower(regexp_replace(trim(coalesce(p_mantenimiento_tipo_pendiente, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'mantenimiento' THEN lower(regexp_replace(trim(coalesce(p_mantenimiento_descripcion_pendiente, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'visita_tecnica' THEN lower(regexp_replace(trim(coalesce(p_tipo_visita, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'visita_tecnica' THEN lower(regexp_replace(trim(coalesce(p_receptor_nombre, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'visita_tecnica' THEN lower(regexp_replace(trim(coalesce(p_receptor_cedula, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'visita_tecnica' THEN lower(regexp_replace(trim(coalesce(p_receptor_cargo, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'recorrido' THEN lower(regexp_replace(trim(coalesce(p_punto_partida, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'recorrido' THEN lower(regexp_replace(trim(coalesce(p_punto_llegada, '')), '\s+', ' ', 'g')) ELSE '' END,
          CASE WHEN v_tipo = 'recorrido' THEN lower(regexp_replace(trim(coalesce(p_tipo_recorrido, '')), '\s+', ' ', 'g')) ELSE '' END,
          v_participantes
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 2. Fotografía y mapa de duplicados actuales
-- -------------------------------------------------------------------------
CREATE TEMP TABLE tmp_semantic_activity_fingerprints ON COMMIT DROP AS
SELECT
  a.id,
  a.codigo,
  a.tipo,
  a.estado,
  a.origen,
  a.cliente_id,
  a.sede_id,
  a.grupo_id,
  a.creado_por_id,
  a.fecha_operacion,
  a.descripcion,
  a.observaciones,
  a.created_at,
  a.updated_at,
  public.calcular_huella_semantica_actividad(
    a.tipo,
    a.cliente_id,
    a.sede_id,
    a.grupo_id,
    a.fecha_operacion,
    a.descripcion,
    a.observaciones,
    c.catalogo_actividad_id,
    c.especificacion,
    m.mantenimiento_programado_id,
    m.titulo,
    m.tipo_pendiente,
    m.descripcion_pendiente,
    v.tipo_visita,
    v.receptor_nombre,
    v.receptor_cedula,
    v.receptor_cargo,
    r.punto_partida,
    r.punto_llegada,
    r.tipo_recorrido,
    coalesce(p.participantes, '[]'::jsonb)
  ) AS huella_semantica
FROM public.actividades_operativas a
LEFT JOIN LATERAL (
  SELECT c1.catalogo_actividad_id, c1.especificacion
  FROM public.actividades_operativas_catalogo c1
  WHERE c1.actividad_id = a.id
  ORDER BY c1.catalogo_actividad_id, c1.especificacion
  LIMIT 1
) c ON true
LEFT JOIN LATERAL (
  SELECT m1.mantenimiento_programado_id, m1.titulo, m1.tipo_pendiente,
         m1.descripcion_pendiente
  FROM public.actividades_operativas_mantenimientos m1
  WHERE m1.actividad_id = a.id
  LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT v1.tipo_visita, v1.receptor_nombre, v1.receptor_cedula,
         v1.receptor_cargo
  FROM public.actividades_operativas_visitas v1
  WHERE v1.actividad_id = a.id
  LIMIT 1
) v ON true
LEFT JOIN LATERAL (
  SELECT r1.punto_partida, r1.punto_llegada, r1.tipo_recorrido
  FROM public.actividades_operativas_recorridos r1
  WHERE r1.actividad_id = a.id
  LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object('tecnico_id', p1.tecnico_id::text)
    ORDER BY p1.tecnico_id::text
  ) AS participantes
  FROM (
    SELECT DISTINCT p2.tecnico_id
    FROM public.actividades_operativas_participantes p2
    WHERE p2.actividad_id = a.id
  ) p1
) p ON true
WHERE a.estado <> 'cancelada';

CREATE TEMP TABLE tmp_semantic_activity_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY s.huella_semantica
      ORDER BY
        CASE s.estado
          WHEN 'pagado' THEN 7
          WHEN 'aprobada' THEN 6
          WHEN 'completada' THEN 5
          WHEN 'pendiente_aprobacion' THEN 4
          WHEN 'en_progreso' THEN 3
          WHEN 'borrador' THEN 2
          WHEN 'rechazada' THEN 1
          ELSE 0
        END DESC,
        s.created_at ASC NULLS LAST,
        s.id
    ) AS position,
    first_value(s.id) OVER (
      PARTITION BY s.huella_semantica
      ORDER BY
        CASE s.estado
          WHEN 'pagado' THEN 7
          WHEN 'aprobada' THEN 6
          WHEN 'completada' THEN 5
          WHEN 'pendiente_aprobacion' THEN 4
          WHEN 'en_progreso' THEN 3
          WHEN 'borrador' THEN 2
          WHEN 'rechazada' THEN 1
          ELSE 0
        END DESC,
        s.created_at ASC NULLS LAST,
        s.id
    ) AS winner_id,
    count(*) OVER (PARTITION BY s.huella_semantica) AS group_count
  FROM tmp_semantic_activity_fingerprints s
)
SELECT
  id AS loser_id,
  winner_id,
  huella_semantica,
  codigo AS loser_code,
  (SELECT codigo FROM tmp_semantic_activity_fingerprints w WHERE w.id = ranked.winner_id) AS winner_code,
  tipo,
  position,
  group_count
FROM ranked
WHERE group_count > 1 AND position > 1;

CREATE TABLE legacy_backup.v2_semantic_20260830_activity_map AS
SELECT
  loser_id,
  winner_id,
  huella_semantica,
  loser_code,
  winner_code,
  tipo,
  CASE tipo
    WHEN 'actividad' THEN 'actividad_semantica_repetida'
    WHEN 'visita_tecnica' THEN 'visita_tecnica_semantica_repetida'
    WHEN 'recorrido' THEN 'recorrido_semantico_repetido'
    WHEN 'mantenimiento' THEN 'mantenimiento_semantico_repetido'
    ELSE 'operacion_semantica_repetida'
  END AS motivo,
  clock_timestamp() AS consolidado_en
FROM tmp_semantic_activity_map;

ALTER TABLE legacy_backup.v2_semantic_20260830_activity_map
  ADD PRIMARY KEY (loser_id);

CREATE INDEX v2_semantic_20260830_activity_map_winner_idx
  ON legacy_backup.v2_semantic_20260830_activity_map (winner_id);

CREATE TEMP TABLE tmp_semantic_affected_ids ON COMMIT DROP AS
SELECT loser_id AS id FROM tmp_semantic_activity_map
UNION
SELECT winner_id AS id FROM tmp_semantic_activity_map;

-- -------------------------------------------------------------------------
-- 3. Respaldo completo antes de consolidar filas
-- -------------------------------------------------------------------------
CREATE TABLE legacy_backup.v2_semantic_20260830_activities AS
SELECT a.*
FROM public.actividades_operativas a
JOIN tmp_semantic_affected_ids x ON x.id = a.id;

CREATE TABLE legacy_backup.v2_semantic_20260830_participants AS
SELECT p.*
FROM public.actividades_operativas_participantes p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_approvals AS
SELECT p.*
FROM public.actividades_operativas_aprobaciones p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_deliveries AS
SELECT p.*
FROM public.actividades_operativas_entregas p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_evidence AS
SELECT p.*
FROM public.actividades_operativas_evidencias p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_catalog_links AS
SELECT p.*
FROM public.actividades_operativas_catalogo p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_visit_links AS
SELECT p.*
FROM public.actividades_operativas_visitas p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_route_links AS
SELECT p.*
FROM public.actividades_operativas_recorridos p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_maintenance_links AS
SELECT p.*
FROM public.actividades_operativas_mantenimientos p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_liquidation AS
SELECT p.*
FROM public.liquidacion_items p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_idempotency AS
SELECT p.*
FROM public.operaciones_idempotencia p
JOIN tmp_semantic_affected_ids x ON x.id = p.recurso_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_lote_items AS
SELECT lai.*
FROM public.lote_aprobacion_items lai
JOIN public.actividades_operativas_aprobaciones ap ON ap.id = lai.aprobacion_id
JOIN tmp_semantic_affected_ids x ON x.id = ap.actividad_id;

CREATE TABLE legacy_backup.v2_semantic_20260830_summary (
  phase text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO legacy_backup.v2_semantic_20260830_summary (phase, snapshot)
SELECT 'before', jsonb_build_object(
  'duplicate_groups', (SELECT count(DISTINCT huella_semantica) FROM tmp_semantic_activity_map),
  'absorbed_activity_rows', (SELECT count(*) FROM tmp_semantic_activity_map),
  'activities_before', (SELECT count(*) FROM public.actividades_operativas),
  'participants_before', (SELECT count(*) FROM public.actividades_operativas_participantes),
  'liquidation_rows_before', (SELECT count(*) FROM public.liquidacion_items),
  'liquidation_total_before', (SELECT coalesce(sum(valor_ganado) FILTER (WHERE estado <> 'anulado'), 0) FROM public.liquidacion_items),
  'backup_activity_rows', (SELECT count(*) FROM legacy_backup.v2_semantic_20260830_activities),
  'backup_participant_rows', (SELECT count(*) FROM legacy_backup.v2_semantic_20260830_participants),
  'backup_liquidation_rows', (SELECT count(*) FROM legacy_backup.v2_semantic_20260830_liquidation)
);

-- -------------------------------------------------------------------------
-- 4. Mapa de participantes y consolidación de dependencias
-- -------------------------------------------------------------------------
-- La huella ya incluye los técnicos, por lo que normalmente cada técnico ya
-- existe en el ganador. El INSERT cubre de forma segura cualquier histórico
-- inconsistente antes de construir el mapa.
INSERT INTO public.actividades_operativas_participantes (
  actividad_id, tecnico_id, rol_participacion, porcentaje, valor_base, valor_ganado,
  estado_reporte
)
SELECT DISTINCT ON (m.winner_id, p.tecnico_id)
  m.winner_id,
  p.tecnico_id,
  CASE
    WHEN p.rol_participacion = 'principal'
     AND NOT EXISTS (
       SELECT 1
       FROM public.actividades_operativas_participantes wp
       WHERE wp.actividad_id = m.winner_id
         AND wp.rol_participacion = 'principal'
     ) THEN 'principal'
    ELSE 'acompanante'
  END,
  p.porcentaje,
  p.valor_base,
  p.valor_ganado,
  p.estado_reporte
FROM public.actividades_operativas_participantes p
JOIN tmp_semantic_activity_map m ON m.loser_id = p.actividad_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.actividades_operativas_participantes wp
  WHERE wp.actividad_id = m.winner_id
    AND wp.tecnico_id = p.tecnico_id
)
ORDER BY m.winner_id, p.tecnico_id, p.created_at ASC;

CREATE TEMP TABLE tmp_semantic_participant_map ON COMMIT DROP AS
SELECT
  p.id AS source_participant_id,
  p.actividad_id AS source_activity_id,
  coalesce(m.winner_id, p.actividad_id) AS winner_activity_id,
  wp.id AS winner_participant_id,
  p.tecnico_id
FROM public.actividades_operativas_participantes p
JOIN tmp_semantic_affected_ids x ON x.id = p.actividad_id
LEFT JOIN tmp_semantic_activity_map m ON m.loser_id = p.actividad_id
LEFT JOIN public.actividades_operativas_participantes wp
  ON wp.actividad_id = coalesce(m.winner_id, p.actividad_id)
 AND wp.tecnico_id = p.tecnico_id;

ALTER TABLE tmp_semantic_participant_map
  ADD PRIMARY KEY (source_participant_id);

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM tmp_semantic_participant_map
  WHERE winner_participant_id IS NULL;
  IF missing <> 0 THEN
    RAISE EXCEPTION 'No se pudieron mapear % participantes semánticos.', missing;
  END IF;
END $$;

-- Aprobaciones: conserva el estado de mayor valor y, en empate, la fila más
-- reciente. Si solo existe aprobación en la copia, se mueve al ganador.
CREATE TEMP TABLE tmp_semantic_approval_resolution ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    ap.id,
    ap.actividad_id,
    ap.participante_id,
    pm.winner_activity_id,
    pm.winner_participant_id,
    row_number() OVER (
      PARTITION BY pm.winner_activity_id, pm.winner_participant_id
      ORDER BY
        CASE ap.estado WHEN 'aprobada' THEN 3 WHEN 'pendiente' THEN 2
                       WHEN 'rechazada' THEN 1 ELSE 0 END DESC,
        (ap.actividad_id = pm.winner_activity_id) DESC,
        ap.updated_at DESC NULLS LAST,
        ap.id DESC
    ) AS keep_rank
  FROM public.actividades_operativas_aprobaciones ap
  JOIN tmp_semantic_participant_map pm
    ON pm.source_participant_id = ap.participante_id
   AND pm.source_activity_id = ap.actividad_id
)
SELECT *, keep_rank = 1 AS keep_row
FROM candidates;

-- Las relaciones con lotes cerrados no se pierden: se apuntan a la
-- aprobación que permanecerá antes de eliminar la copia.
INSERT INTO public.lote_aprobacion_items (lote_id, aprobacion_id)
SELECT DISTINCT loser_items.lote_id, winner_ap.id
FROM public.lote_aprobacion_items loser_items
JOIN tmp_semantic_approval_resolution loser_ap
  ON loser_ap.id = loser_items.aprobacion_id
 AND NOT loser_ap.keep_row
JOIN tmp_semantic_approval_resolution winner_ap
  ON winner_ap.winner_activity_id = loser_ap.winner_activity_id
 AND winner_ap.winner_participant_id = loser_ap.winner_participant_id
 AND winner_ap.keep_row
ON CONFLICT DO NOTHING;

DELETE FROM public.lote_aprobacion_items lai
USING tmp_semantic_approval_resolution ar
WHERE lai.aprobacion_id = ar.id
  AND NOT ar.keep_row;

UPDATE public.actividades_operativas_aprobaciones ap
SET actividad_id = ar.winner_activity_id,
    participante_id = ar.winner_participant_id,
    updated_at = clock_timestamp()
FROM tmp_semantic_approval_resolution ar
WHERE ap.id = ar.id AND ar.keep_row;

DELETE FROM public.actividades_operativas_aprobaciones ap
USING tmp_semantic_approval_resolution ar
WHERE ap.id = ar.id AND NOT ar.keep_row;

-- Entregas: se conserva una sola por actividad y técnico, priorizando una
-- entrega enviada sobre una pendiente.
CREATE TEMP TABLE tmp_semantic_delivery_resolution ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    d.id,
    d.actividad_id,
    d.participante_id,
    pm.winner_activity_id,
    pm.winner_participant_id,
    row_number() OVER (
      PARTITION BY pm.winner_activity_id, pm.winner_participant_id
      ORDER BY
        CASE d.estado WHEN 'enviada' THEN 2 WHEN 'pendiente' THEN 1 ELSE 0 END DESC,
        (d.actividad_id = pm.winner_activity_id) DESC,
        d.updated_at DESC NULLS LAST,
        d.id DESC
    ) AS keep_rank
  FROM public.actividades_operativas_entregas d
  JOIN tmp_semantic_participant_map pm
    ON pm.source_participant_id = d.participante_id
   AND pm.source_activity_id = d.actividad_id
)
SELECT *, keep_rank = 1 AS keep_row
FROM candidates;

DELETE FROM public.actividades_operativas_entregas d
USING tmp_semantic_delivery_resolution dr
WHERE d.id = dr.id AND NOT dr.keep_row;

UPDATE public.actividades_operativas_entregas d
SET actividad_id = dr.winner_activity_id,
    participante_id = dr.winner_participant_id,
    updated_at = clock_timestamp()
FROM tmp_semantic_delivery_resolution dr
WHERE d.id = dr.id AND dr.keep_row;

-- Evidencias: se conserva cada archivo distinto. Una colisión exacta de
-- storage representa la misma evidencia y conserva la instancia del ganador.
DELETE FROM public.actividades_operativas_evidencias e
USING tmp_semantic_activity_map m
WHERE e.actividad_id = m.loser_id
  AND EXISTS (
    SELECT 1
    FROM public.actividades_operativas_evidencias w
    WHERE w.actividad_id = m.winner_id
      AND w.storage_bucket IS NOT DISTINCT FROM e.storage_bucket
      AND w.storage_key IS NOT DISTINCT FROM e.storage_key
  );

UPDATE public.actividades_operativas_evidencias e
SET actividad_id = m.winner_id,
    participante_id = CASE
      WHEN e.participante_id IS NULL THEN NULL
      ELSE (
        SELECT pm.winner_participant_id
        FROM tmp_semantic_participant_map pm
        WHERE pm.source_participant_id = e.participante_id
          AND pm.source_activity_id = m.loser_id
      )
    END
FROM tmp_semantic_activity_map m
WHERE e.actividad_id = m.loser_id;

-- Los enlaces de detalle son parte de la huella. Si el ganador ya tiene su
-- ficha, se elimina la copia; si no, se reparenta.
DELETE FROM public.actividades_operativas_catalogo c
USING tmp_semantic_activity_map m
WHERE c.actividad_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM public.actividades_operativas_catalogo w
    WHERE w.actividad_id = m.winner_id
  );
UPDATE public.actividades_operativas_catalogo c
SET actividad_id = m.winner_id
FROM tmp_semantic_activity_map m
WHERE c.actividad_id = m.loser_id;

DELETE FROM public.actividades_operativas_visitas v
USING tmp_semantic_activity_map m
WHERE v.actividad_id = m.loser_id
  AND EXISTS (SELECT 1 FROM public.actividades_operativas_visitas w WHERE w.actividad_id = m.winner_id);
UPDATE public.actividades_operativas_visitas v
SET actividad_id = m.winner_id
FROM tmp_semantic_activity_map m
WHERE v.actividad_id = m.loser_id;

DELETE FROM public.actividades_operativas_recorridos r
USING tmp_semantic_activity_map m
WHERE r.actividad_id = m.loser_id
  AND EXISTS (SELECT 1 FROM public.actividades_operativas_recorridos w WHERE w.actividad_id = m.winner_id);
UPDATE public.actividades_operativas_recorridos r
SET actividad_id = m.winner_id
FROM tmp_semantic_activity_map m
WHERE r.actividad_id = m.loser_id;

DELETE FROM public.actividades_operativas_mantenimientos x
USING tmp_semantic_activity_map m
WHERE x.actividad_id = m.loser_id
  AND EXISTS (SELECT 1 FROM public.actividades_operativas_mantenimientos w WHERE w.actividad_id = m.winner_id);
UPDATE public.actividades_operativas_mantenimientos x
SET actividad_id = m.winner_id
FROM tmp_semantic_activity_map m
WHERE x.actividad_id = m.loser_id;

-- Liquidación: se conserva una sola fila por corte, actividad y técnico.
CREATE TEMP TABLE tmp_semantic_liquidation_resolution ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    li.id,
    li.actividad_id,
    li.participante_id,
    li.periodo_id,
    pm.winner_activity_id,
    pm.winner_participant_id,
    row_number() OVER (
      PARTITION BY li.periodo_id, pm.winner_activity_id, pm.winner_participant_id
      ORDER BY
        CASE li.estado WHEN 'pagado' THEN 4 WHEN 'aprobado' THEN 3
                       WHEN 'pendiente' THEN 2 WHEN 'anulado' THEN 1 ELSE 0 END DESC,
        (li.actividad_id = pm.winner_activity_id) DESC,
        li.updated_at DESC NULLS LAST,
        li.id DESC
    ) AS keep_rank
  FROM public.liquidacion_items li
  JOIN tmp_semantic_participant_map pm
    ON pm.source_participant_id = li.participante_id
   AND pm.source_activity_id = li.actividad_id
)
SELECT *, keep_rank = 1 AS keep_row
FROM candidates;

DELETE FROM public.liquidacion_items li
USING tmp_semantic_liquidation_resolution lr
WHERE li.id = lr.id AND NOT lr.keep_row;

UPDATE public.liquidacion_items li
SET actividad_id = lr.winner_activity_id,
    participante_id = lr.winner_participant_id,
    updated_at = clock_timestamp()
FROM tmp_semantic_liquidation_resolution lr
WHERE li.id = lr.id AND lr.keep_row;

-- Idempotencia: una copia no puede conservar una operación distinta sobre el
-- mismo recurso canónico si la clave ya existe allí.
DELETE FROM public.operaciones_idempotencia oi
USING tmp_semantic_activity_map m
WHERE oi.recurso_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM public.operaciones_idempotencia w
    WHERE w.recurso_id = m.winner_id AND w.clave = oi.clave
  );

UPDATE public.operaciones_idempotencia oi
SET recurso_id = m.winner_id,
    updated_at = clock_timestamp()
FROM tmp_semantic_activity_map m
WHERE oi.recurso_id = m.loser_id;

-- Ahora ya no quedan referencias operativas a los participantes/actividades
-- sobrantes.
DELETE FROM public.actividades_operativas_participantes p
USING tmp_semantic_participant_map pm
WHERE p.id = pm.source_participant_id
  AND p.id <> pm.winner_participant_id;

WITH absorbed AS (
  SELECT winner_id,
         jsonb_agg(jsonb_build_object(
           'id', loser_id,
           'codigo', loser_code,
           'motivo', 'duplicado_semantico'
         ) ORDER BY loser_code) AS rows
  FROM tmp_semantic_activity_map
  GROUP BY winner_id
)
UPDATE public.actividades_operativas a
SET metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
      'deduplicated_at', clock_timestamp(),
      'deduplicated_records', absorbed.rows
    ),
    updated_at = clock_timestamp(),
    version = a.version + 1
FROM absorbed
WHERE a.id = absorbed.winner_id;

DELETE FROM public.actividades_operativas a
USING tmp_semantic_activity_map m
WHERE a.id = m.loser_id;

INSERT INTO public.auditoria_eventos (
  entidad_tipo, entidad_id, accion, datos_antes, datos_despues
)
SELECT
  'actividad_operativa',
  m.winner_id,
  'actualizar',
  jsonb_build_object('registros_absorbidos', count(*)),
  jsonb_build_object(
    'motivo', 'duplicado_semantico',
    'respaldo', 'legacy_backup.v2_semantic_20260830_*',
    'codigos_absorbidos', jsonb_agg(m.loser_code ORDER BY m.loser_code)
  )
FROM tmp_semantic_activity_map m
GROUP BY m.winner_id;

-- -------------------------------------------------------------------------
-- 5. Huella persistente, unicidad y triggers diferidos
-- -------------------------------------------------------------------------
UPDATE public.actividades_operativas a
SET huella_semantica = s.huella_semantica,
    updated_at = CASE
      WHEN a.huella_semantica IS DISTINCT FROM s.huella_semantica
        THEN clock_timestamp()
      ELSE a.updated_at
    END
FROM (
  SELECT
    a1.id,
    public.calcular_huella_semantica_actividad(
      a1.tipo, a1.cliente_id, a1.sede_id, a1.grupo_id, a1.fecha_operacion,
      a1.descripcion, a1.observaciones,
      c.catalogo_actividad_id, c.especificacion,
      m.mantenimiento_programado_id, m.titulo, m.tipo_pendiente,
      m.descripcion_pendiente,
      v.tipo_visita, v.receptor_nombre, v.receptor_cedula, v.receptor_cargo,
      r.punto_partida, r.punto_llegada, r.tipo_recorrido,
      coalesce(p.participantes, '[]'::jsonb)
    ) AS huella_semantica
  FROM public.actividades_operativas a1
  LEFT JOIN LATERAL (
    SELECT c1.catalogo_actividad_id, c1.especificacion
    FROM public.actividades_operativas_catalogo c1
    WHERE c1.actividad_id = a1.id
    ORDER BY c1.catalogo_actividad_id, c1.especificacion
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT m1.mantenimiento_programado_id, m1.titulo, m1.tipo_pendiente,
           m1.descripcion_pendiente
    FROM public.actividades_operativas_mantenimientos m1
    WHERE m1.actividad_id = a1.id
    LIMIT 1
  ) m ON true
  LEFT JOIN LATERAL (
    SELECT v1.tipo_visita, v1.receptor_nombre, v1.receptor_cedula,
           v1.receptor_cargo
    FROM public.actividades_operativas_visitas v1
    WHERE v1.actividad_id = a1.id
    LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT r1.punto_partida, r1.punto_llegada, r1.tipo_recorrido
    FROM public.actividades_operativas_recorridos r1
    WHERE r1.actividad_id = a1.id
    LIMIT 1
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('tecnico_id', p1.tecnico_id::text)
      ORDER BY p1.tecnico_id::text
    ) AS participantes
    FROM (
      SELECT DISTINCT p2.tecnico_id
      FROM public.actividades_operativas_participantes p2
      WHERE p2.actividad_id = a1.id
    ) p1
  ) p ON true
) s
WHERE a.id = s.id;

UPDATE public.actividades_operativas
SET huella_semantica = NULL
WHERE estado = 'cancelada';

DROP INDEX IF EXISTS public.actividades_semantic_fingerprint_unique;
CREATE UNIQUE INDEX actividades_semantic_fingerprint_unique
  ON public.actividades_operativas (huella_semantica)
  WHERE huella_semantica IS NOT NULL AND estado <> 'cancelada';

CREATE OR REPLACE FUNCTION public.actualizar_huella_semantica_actividad_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actividad_id uuid;
  v_tipo text;
  v_cliente_id uuid;
  v_sede_id uuid;
  v_grupo_id uuid;
  v_fecha date;
  v_descripcion text;
  v_observaciones text;
  v_catalogo_id uuid;
  v_especificacion text;
  v_mantenimiento_id uuid;
  v_mantenimiento_titulo text;
  v_mantenimiento_tipo text;
  v_mantenimiento_descripcion text;
  v_visita_tipo text;
  v_receptor_nombre text;
  v_receptor_cedula text;
  v_receptor_cargo text;
  v_partida text;
  v_llegada text;
  v_recorrido_tipo text;
  v_participantes jsonb;
  v_huella text;
BEGIN
  IF TG_TABLE_NAME = 'actividades_operativas' THEN
    v_actividad_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_actividad_id := OLD.actividad_id;
  ELSE
    v_actividad_id := NEW.actividad_id;
  END IF;

  SELECT
    a.tipo, a.cliente_id, a.sede_id, a.grupo_id, a.fecha_operacion,
    a.descripcion, a.observaciones
  INTO
    v_tipo, v_cliente_id, v_sede_id, v_grupo_id, v_fecha,
    v_descripcion, v_observaciones
  FROM public.actividades_operativas a
  WHERE a.id = v_actividad_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT c.catalogo_actividad_id, c.especificacion
  INTO v_catalogo_id, v_especificacion
  FROM public.actividades_operativas_catalogo c
  WHERE c.actividad_id = v_actividad_id
  ORDER BY c.catalogo_actividad_id, c.especificacion
  LIMIT 1;

  SELECT m.mantenimiento_programado_id, m.titulo, m.tipo_pendiente,
         m.descripcion_pendiente
  INTO v_mantenimiento_id, v_mantenimiento_titulo, v_mantenimiento_tipo,
       v_mantenimiento_descripcion
  FROM public.actividades_operativas_mantenimientos m
  WHERE m.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT v.tipo_visita, v.receptor_nombre, v.receptor_cedula, v.receptor_cargo
  INTO v_visita_tipo, v_receptor_nombre, v_receptor_cedula, v_receptor_cargo
  FROM public.actividades_operativas_visitas v
  WHERE v.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT r.punto_partida, r.punto_llegada, r.tipo_recorrido
  INTO v_partida, v_llegada, v_recorrido_tipo
  FROM public.actividades_operativas_recorridos r
  WHERE r.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('tecnico_id', p1.tecnico_id::text)
              ORDER BY p1.tecnico_id::text),
    '[]'::jsonb
  )
  INTO v_participantes
  FROM (
    SELECT DISTINCT p2.tecnico_id
    FROM public.actividades_operativas_participantes p2
    WHERE p2.actividad_id = v_actividad_id
  ) p1;

  v_huella := public.calcular_huella_semantica_actividad(
    v_tipo, v_cliente_id, v_sede_id, v_grupo_id, v_fecha,
    v_descripcion, v_observaciones,
    v_catalogo_id, v_especificacion,
    v_mantenimiento_id, v_mantenimiento_titulo, v_mantenimiento_tipo,
    v_mantenimiento_descripcion,
    v_visita_tipo, v_receptor_nombre, v_receptor_cedula, v_receptor_cargo,
    v_partida, v_llegada, v_recorrido_tipo, v_participantes
  );

  UPDATE public.actividades_operativas
  SET huella_semantica = v_huella,
      updated_at = clock_timestamp()
  WHERE id = v_actividad_id
    AND huella_semantica IS DISTINCT FROM v_huella;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS actividades_semantic_activity_ct
  ON public.actividades_operativas;
CREATE CONSTRAINT TRIGGER actividades_semantic_activity_ct
AFTER INSERT OR UPDATE OF tipo, cliente_id, sede_id, grupo_id, fecha_operacion,
  descripcion, observaciones ON public.actividades_operativas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

DROP TRIGGER IF EXISTS actividades_semantic_participant_ct
  ON public.actividades_operativas_participantes;
CREATE CONSTRAINT TRIGGER actividades_semantic_participant_ct
AFTER INSERT OR DELETE OR UPDATE OF actividad_id, tecnico_id
  ON public.actividades_operativas_participantes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

DROP TRIGGER IF EXISTS actividades_semantic_catalog_ct
  ON public.actividades_operativas_catalogo;
CREATE CONSTRAINT TRIGGER actividades_semantic_catalog_ct
AFTER INSERT OR DELETE OR UPDATE OF actividad_id, catalogo_actividad_id, especificacion
  ON public.actividades_operativas_catalogo
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

DROP TRIGGER IF EXISTS actividades_semantic_maintenance_ct
  ON public.actividades_operativas_mantenimientos;
CREATE CONSTRAINT TRIGGER actividades_semantic_maintenance_ct
AFTER INSERT OR DELETE OR UPDATE OF actividad_id, mantenimiento_programado_id, titulo,
  tipo_pendiente, descripcion_pendiente, receptor_nombre, firmado
  ON public.actividades_operativas_mantenimientos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

DROP TRIGGER IF EXISTS actividades_semantic_visit_ct
  ON public.actividades_operativas_visitas;
CREATE CONSTRAINT TRIGGER actividades_semantic_visit_ct
AFTER INSERT OR DELETE OR UPDATE OF actividad_id, tipo_visita, receptor_nombre,
  receptor_cedula, receptor_cargo, firmado ON public.actividades_operativas_visitas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

DROP TRIGGER IF EXISTS actividades_semantic_route_ct
  ON public.actividades_operativas_recorridos;
CREATE CONSTRAINT TRIGGER actividades_semantic_route_ct
AFTER INSERT OR DELETE OR UPDATE OF actividad_id, punto_partida, punto_llegada,
  tipo_recorrido, inicio_recorrido, fin_recorrido
  ON public.actividades_operativas_recorridos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.actualizar_huella_semantica_actividad_trigger();

ALTER TABLE public.liquidacion_items
  ENABLE TRIGGER trg_validate_liquidation_period_open;
ALTER TABLE public.actividades_operativas_aprobaciones
  ENABLE TRIGGER trg_validate_approval_reviewer;
ALTER TABLE public.actividades_operativas_participantes
  ENABLE TRIGGER trg_validate_participant_group;
ALTER TABLE public.actividades_operativas_participantes
  ENABLE TRIGGER trg_validate_participant_percentage_total;

INSERT INTO legacy_backup.v2_semantic_20260830_summary (phase, snapshot)
SELECT 'after', jsonb_build_object(
  'activities_after', (SELECT count(*) FROM public.actividades_operativas),
  'participants_after', (SELECT count(*) FROM public.actividades_operativas_participantes),
  'liquidation_rows_after', (SELECT count(*) FROM public.liquidacion_items),
  'liquidation_total_after', (SELECT coalesce(sum(valor_ganado) FILTER (WHERE estado <> 'anulado'), 0) FROM public.liquidacion_items),
  'activities_without_fingerprint', (SELECT count(*) FROM public.actividades_operativas WHERE estado <> 'cancelada' AND huella_semantica IS NULL),
  'duplicate_fingerprints', (SELECT count(*) FROM (
    SELECT huella_semantica FROM public.actividades_operativas
    WHERE estado <> 'cancelada'
    GROUP BY huella_semantica HAVING count(*) > 1
  ) d),
  'remaining_loser_rows', (SELECT count(*) FROM public.actividades_operativas a JOIN tmp_semantic_activity_map m ON m.loser_id = a.id)
);

DO $$
DECLARE
  missing_fingerprints integer;
  duplicate_fingerprints integer;
  remaining_losers integer;
BEGIN
  SELECT count(*) INTO missing_fingerprints
  FROM public.actividades_operativas
  WHERE estado <> 'cancelada' AND huella_semantica IS NULL;

  SELECT count(*) INTO duplicate_fingerprints
  FROM (
    SELECT huella_semantica
    FROM public.actividades_operativas
    WHERE estado <> 'cancelada'
    GROUP BY huella_semantica
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO remaining_losers
  FROM public.actividades_operativas a
  JOIN tmp_semantic_activity_map m ON m.loser_id = a.id;

  IF missing_fingerprints <> 0 OR duplicate_fingerprints <> 0 OR remaining_losers <> 0 THEN
    RAISE EXCEPTION
      'Validación semántica falló: huellas faltantes %, huellas duplicadas %, actividades sobrantes %',
      missing_fingerprints, duplicate_fingerprints, remaining_losers;
  END IF;
END $$;

COMMIT;

