-- Mantiene un solo mantenimiento compartido, pero separa la entrega de cada
-- técnico: actividades, observaciones, pendientes, receptor, firma y
-- evidencias no se almacenan en columnas globales de la actividad.
BEGIN;

ALTER TABLE public.actividades_operativas_entregas
  ADD COLUMN IF NOT EXISTS actividades_realizadas text,
  ADD COLUMN IF NOT EXISTS tipo_pendiente text,
  ADD COLUMN IF NOT EXISTS descripcion_pendiente text,
  ADD COLUMN IF NOT EXISTS receptor_nombre text,
  ADD COLUMN IF NOT EXISTS firmado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS firma_receptor_url text,
  ADD COLUMN IF NOT EXISTS foto_bitacora_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_actividades_entregas_participante
  ON public.actividades_operativas_entregas (actividad_id, participante_id, updated_at DESC);

COMMENT ON COLUMN public.actividades_operativas_entregas.actividades_realizadas IS
  'Texto diligenciado por este técnico; no es un campo global de la actividad.';
COMMENT ON COLUMN public.actividades_operativas_entregas.observaciones IS
  'Observaciones de la entrega de este técnico.';
COMMENT ON COLUMN public.actividades_operativas_entregas.firmado IS
  'Confirmación de firma/cierre de este técnico.';
COMMENT ON COLUMN public.actividades_operativas_evidencias.participante_id IS
  'Participante dueño de la evidencia. Nunca debe quedar compartida entre técnicos.';

COMMIT;
