-- Un mantenimiento preventivo puede tener varias entregas, una por técnico,
-- pero administrativamente solo tiene una aprobación y un registro final.
-- Los pagos continúan separados en liquidacion_items por participante.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';
LOCK TABLE public.actividades_operativas IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_aprobaciones IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_entregas IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.actividades_operativas_participantes IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.liquidacion_items IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA IF NOT EXISTS legacy_backup;
CREATE TABLE IF NOT EXISTS legacy_backup.v2_maintenance_approvals_before_single_20260902 AS
SELECT ap.*
  FROM public.actividades_operativas_aprobaciones ap
  JOIN public.actividades_operativas_mantenimientos am
    ON am.actividad_id = ap.actividad_id
  JOIN public.actividades_operativas a
    ON a.id = ap.actividad_id
 WHERE a.tipo = 'mantenimiento'
   AND ap.participante_id IS NOT NULL;

ALTER TABLE public.actividades_operativas_aprobaciones
  DISABLE TRIGGER trg_validate_approval_reviewer;
ALTER TABLE public.actividades_operativas_aprobaciones
  ALTER COLUMN participante_id DROP NOT NULL;
ALTER TABLE public.actividades_operativas_participantes
  DISABLE TRIGGER trg_validate_participant_group;
ALTER TABLE public.actividades_operativas_participantes
  DISABLE TRIGGER trg_validate_participant_percentage_total;
ALTER TABLE public.actividades_operativas_participantes
  DISABLE TRIGGER USER;
ALTER TABLE public.actividades_operativas
  DISABLE TRIGGER USER;
ALTER TABLE public.liquidacion_items
  DISABLE TRIGGER trg_validate_liquidation_period_open;

-- Normaliza el historial existente: cualquier aprobación por participante de
-- un mantenimiento se convierte en una sola aprobación global. Si había una
-- aprobación pendiente o rechazada, el mantenimiento no debe aparecer como
-- aprobado por accidente.
DO $$
DECLARE
  activity_row record;
  approval_row record;
  global_id uuid;
  legacy_ids uuid[];
  approval_state text;
  reviewer_id uuid;
  approval_comment text;
BEGIN
  FOR activity_row IN
    SELECT DISTINCT a.id, a.grupo_id, a.creado_por_id, g.lider_id
      FROM public.actividades_operativas a
      JOIN public.actividades_operativas_mantenimientos am
        ON am.actividad_id = a.id
      LEFT JOIN public.grupos_trabajo g
        ON g.id = a.grupo_id
     WHERE a.tipo = 'mantenimiento'
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.actividades_operativas_aprobaciones ap
       WHERE ap.actividad_id = activity_row.id
    ) THEN
      CONTINUE;
    END IF;

    SELECT CASE
             WHEN bool_or(ap.estado = 'rechazada') THEN 'rechazada'
             WHEN bool_and(ap.estado = 'aprobada') THEN 'aprobada'
             ELSE 'pendiente'
           END
      INTO approval_state
      FROM public.actividades_operativas_aprobaciones ap
     WHERE ap.actividad_id = activity_row.id;

    SELECT ap.revisor_id, ap.comentario
      INTO reviewer_id, approval_comment
      FROM public.actividades_operativas_aprobaciones ap
     WHERE ap.actividad_id = activity_row.id
     ORDER BY ap.updated_at DESC NULLS LAST, ap.id DESC
     LIMIT 1;
    reviewer_id := COALESCE(reviewer_id, activity_row.lider_id, activity_row.creado_por_id);

    SELECT ap.id
      INTO global_id
      FROM public.actividades_operativas_aprobaciones ap
     WHERE ap.actividad_id = activity_row.id
       AND ap.participante_id IS NULL
     ORDER BY ap.updated_at DESC NULLS LAST, ap.id DESC
     LIMIT 1
     FOR UPDATE;

    IF global_id IS NULL THEN
      INSERT INTO public.actividades_operativas_aprobaciones
        (actividad_id, participante_id, revisor_id, estado, comentario, revisado_en)
      VALUES
        (activity_row.id, NULL, reviewer_id, approval_state, approval_comment,
         CASE WHEN approval_state = 'pendiente' THEN NULL ELSE clock_timestamp() END)
      RETURNING id INTO global_id;
    ELSE
      UPDATE public.actividades_operativas_aprobaciones
         SET revisor_id = reviewer_id,
             estado = approval_state,
             comentario = approval_comment,
             revisado_en = CASE WHEN approval_state = 'pendiente' THEN NULL ELSE clock_timestamp() END,
             updated_at = clock_timestamp()
       WHERE id = global_id;
    END IF;

    SELECT COALESCE(array_agg(ap.id), ARRAY[]::uuid[])
      INTO legacy_ids
      FROM public.actividades_operativas_aprobaciones ap
     WHERE ap.actividad_id = activity_row.id
       AND ap.id <> global_id
       AND ap.participante_id IS NOT NULL;

    IF COALESCE(array_length(legacy_ids, 1), 0) > 0 THEN
      INSERT INTO public.lote_aprobacion_items (lote_id, aprobacion_id)
      SELECT DISTINCT lai.lote_id, global_id
        FROM public.lote_aprobacion_items lai
       WHERE lai.aprobacion_id = ANY (legacy_ids)
      ON CONFLICT DO NOTHING;

      DELETE FROM public.lote_aprobacion_items
       WHERE aprobacion_id = ANY (legacy_ids);
      DELETE FROM public.actividades_operativas_aprobaciones
       WHERE id = ANY (legacy_ids);
    END IF;

    UPDATE public.actividades_operativas_entregas
       SET estado = CASE approval_state
                      WHEN 'aprobada' THEN 'aprobada'
                      WHEN 'rechazada' THEN 'rechazada'
                      ELSE 'enviada'
                    END,
           updated_at = clock_timestamp()
     WHERE actividad_id = activity_row.id;

    UPDATE public.actividades_operativas_participantes
       SET estado_reporte = CASE approval_state
                              WHEN 'aprobada' THEN 'aprobada'
                              WHEN 'rechazada' THEN 'rechazada'
                              ELSE 'enviada'
                            END,
           updated_at = clock_timestamp()
     WHERE actividad_id = activity_row.id;

    UPDATE public.liquidacion_items
       SET estado = CASE approval_state
                      WHEN 'aprobada' THEN 'aprobado'
                      WHEN 'rechazada' THEN 'anulado'
                      ELSE 'pendiente'
                    END,
           updated_at = clock_timestamp()
     WHERE actividad_id = activity_row.id;

    UPDATE public.actividades_operativas
       SET estado = CASE approval_state
                      WHEN 'aprobada' THEN 'aprobada'
                      WHEN 'rechazada' THEN 'rechazada'
                      ELSE 'pendiente_aprobacion'
                    END,
           updated_at = clock_timestamp()
     WHERE id = activity_row.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_actividad_aprobacion_mantenimiento_global
  ON public.actividades_operativas_aprobaciones (actividad_id)
  WHERE participante_id IS NULL;

ALTER TABLE public.actividades_operativas_aprobaciones
  ENABLE TRIGGER trg_validate_approval_reviewer;
ALTER TABLE public.actividades_operativas_participantes
  ENABLE TRIGGER trg_validate_participant_group;
ALTER TABLE public.actividades_operativas_participantes
  ENABLE TRIGGER trg_validate_participant_percentage_total;
ALTER TABLE public.actividades_operativas_participantes
  ENABLE TRIGGER USER;
ALTER TABLE public.actividades_operativas
  ENABLE TRIGGER USER;
ALTER TABLE public.liquidacion_items
  ENABLE TRIGGER trg_validate_liquidation_period_open;

COMMENT ON INDEX public.uq_actividad_aprobacion_mantenimiento_global IS
  'Un solo registro de aprobación global por actividad; los mantenimientos no se aprueban por técnico.';

COMMIT;
