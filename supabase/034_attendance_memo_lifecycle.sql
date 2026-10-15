-- Attendance memo lifecycle: recoverable deletion and reversible annulment.
-- Existing memo content and history are preserved.

BEGIN;

ALTER TABLE public.asistencia_memorandos
  ADD COLUMN IF NOT EXISTS eliminado_en timestamptz,
  ADD COLUMN IF NOT EXISTS estado_previo_anulacion text;

CREATE INDEX IF NOT EXISTS asistencia_memorandos_eliminado_idx
  ON public.asistencia_memorandos (eliminado_en, generado_en DESC);

COMMIT;
