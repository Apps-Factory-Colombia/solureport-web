CREATE TABLE IF NOT EXISTS public.grupo_reportadores_actividad (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_trabajo(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  fecha_fin date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (grupo_id, usuario_id)
);

-- Compatibilidad con instalaciones que ya tenían la tabla creada por una
-- versión anterior de este archivo.
ALTER TABLE public.grupo_reportadores_actividad
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE public.grupo_reportadores_actividad
   SET fecha_inicio = COALESCE(fecha_inicio, (created_at AT TIME ZONE 'America/Bogota')::date)
 WHERE fecha_inicio IS NULL;

ALTER TABLE public.grupo_reportadores_actividad
  ALTER COLUMN fecha_inicio SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  ALTER COLUMN fecha_inicio SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grupo_reportadores_actividad_grupo_id
  ON public.grupo_reportadores_actividad (grupo_id);

CREATE INDEX IF NOT EXISTS idx_grupo_reportadores_actividad_usuario_id
  ON public.grupo_reportadores_actividad (usuario_id);

COMMENT ON TABLE public.grupo_reportadores_actividad IS
  'Usuarios autorizados para reportar actividades dentro de un grupo de trabajo. Si un grupo no tiene filas aqui, todos sus miembros pueden reportar.';
