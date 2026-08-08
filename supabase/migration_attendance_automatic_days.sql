-- Configuración de los días en los que se permite el descuento automático de asistencia.
-- Ejecutar una vez en el SQL Editor de Supabase.

ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS dias_descuento_automatico text[]
    NOT NULL DEFAULT ARRAY['lunes', 'martes', 'miercoles', 'jueves', 'viernes']::text[];

ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS hora_descuento_automatico time without time zone
    NOT NULL DEFAULT '08:30:00';

UPDATE public.configuracion_empresa
SET dias_descuento_automatico = ARRAY['lunes', 'martes', 'miercoles', 'jueves', 'viernes']::text[]
WHERE dias_descuento_automatico IS NULL
   OR cardinality(dias_descuento_automatico) = 0;

ALTER TABLE public.configuracion_empresa
  DROP CONSTRAINT IF EXISTS configuracion_empresa_dias_descuento_check;

ALTER TABLE public.configuracion_empresa
  ADD CONSTRAINT configuracion_empresa_dias_descuento_check
  CHECK (
    dias_descuento_automatico <@ ARRAY[
      'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
    ]::text[]
  );
