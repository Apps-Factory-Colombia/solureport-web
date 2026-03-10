CREATE TABLE IF NOT EXISTS public.usuario_horarios (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  usuario_id uuid NOT NULL,
  dia_semana character varying NOT NULL CHECK (dia_semana::text = ANY (ARRAY['lunes'::character varying, 'martes'::character varying, 'miercoles'::character varying, 'jueves'::character varying, 'viernes'::character varying, 'sabado'::character varying, 'domingo'::character varying]::text[])),
  activo boolean NOT NULL DEFAULT true,
  hora_entrada time without time zone,
  hora_salida time without time zone,
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
  fecha_actualizacion timestamp with time zone DEFAULT now(),
  CONSTRAINT usuario_horarios_pkey PRIMARY KEY (id),
  CONSTRAINT usuario_horarios_usuario_dia_key UNIQUE (usuario_id, dia_semana),
  CONSTRAINT usuario_horarios_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE,
  CONSTRAINT usuario_horarios_horas_check CHECK ((NOT activo) OR (hora_entrada IS NOT NULL AND hora_salida IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_usuario_horarios_usuario_id ON public.usuario_horarios(usuario_id);

INSERT INTO public.usuario_horarios (
  usuario_id,
  dia_semana,
  activo,
  hora_entrada,
  hora_salida
)
SELECT
  u.id,
  d.dia_semana,
  d.activo,
  CASE WHEN d.activo THEN u.hora_entrada ELSE NULL END,
  CASE WHEN d.activo THEN u.hora_salida ELSE NULL END
FROM public.usuarios u
CROSS JOIN (
  VALUES
    ('lunes', true),
    ('martes', true),
    ('miercoles', true),
    ('jueves', true),
    ('viernes', true),
    ('sabado', false),
    ('domingo', false)
) AS d(dia_semana, activo)
WHERE u.rol IN ('tecnico', 'lider')
ON CONFLICT (usuario_id, dia_semana) DO NOTHING;
