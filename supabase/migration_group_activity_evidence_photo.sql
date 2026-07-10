-- La foto de evidencia es opcional para no afectar registros existentes.
ALTER TABLE public.registros_actividades
ADD COLUMN IF NOT EXISTS foto_evidencia_url text;

ALTER TABLE public.reportes_actividad
ADD COLUMN IF NOT EXISTS foto_evidencia_url text;
