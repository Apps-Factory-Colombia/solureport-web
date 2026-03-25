ALTER TABLE public.reportes_actividad
ADD COLUMN IF NOT EXISTS enviado_correo boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS fecha_ultimo_envio_correo timestamp with time zone;

ALTER TABLE public.registros_actividades
ADD COLUMN IF NOT EXISTS enviado_correo boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS fecha_ultimo_envio_correo timestamp with time zone;
