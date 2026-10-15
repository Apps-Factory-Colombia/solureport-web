-- Allow a new individual memo after a previous one was deleted or annulled.
-- Only one live memo per worker and liquidation period may exist at a time.
BEGIN;

DROP INDEX IF EXISTS public.asistencia_memorandos_usuario_periodo_tipo_uidx;

CREATE UNIQUE INDEX asistencia_memorandos_usuario_periodo_tipo_uidx
  ON public.asistencia_memorandos (usuario_id, periodo_id)
  WHERE periodo_id IS NOT NULL
    AND eliminado_en IS NULL
    AND estado <> 'anulado';

COMMIT;
