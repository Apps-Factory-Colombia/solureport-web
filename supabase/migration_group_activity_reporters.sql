CREATE TABLE IF NOT EXISTS public.grupo_reportadores_actividad (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_trabajo(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_grupo_reportadores_actividad_grupo_id
  ON public.grupo_reportadores_actividad (grupo_id);

CREATE INDEX IF NOT EXISTS idx_grupo_reportadores_actividad_usuario_id
  ON public.grupo_reportadores_actividad (usuario_id);

COMMENT ON TABLE public.grupo_reportadores_actividad IS
  'Usuarios autorizados para reportar actividades dentro de un grupo de trabajo. Si un grupo no tiene filas aqui, todos sus miembros pueden reportar.';
