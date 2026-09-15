-- Persiste la configuración del extra líder por líder y período.
-- Es idempotente para poder aplicarse tanto en instalaciones nuevas como en
-- proyectos que ya tengan parte de la funcionalidad creada.

CREATE TABLE IF NOT EXISTS public.acumulacion_lideres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lider_id uuid NOT NULL REFERENCES public.usuarios(id),
  periodo_id uuid NOT NULL REFERENCES public.periodos_liquidacion(id) ON DELETE CASCADE,
  total_aprobado_pago numeric NOT NULL DEFAULT 0,
  total_pendiente_pago numeric NOT NULL DEFAULT 0,
  extra_lider numeric NOT NULL DEFAULT 0,
  total_recorridos numeric NOT NULL DEFAULT 0,
  total_acumulado numeric NOT NULL DEFAULT 0,
  porcentaje_extra_lider_aplicado numeric NOT NULL DEFAULT 0,
  extra_lider_activo boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT clock_timestamp(),
  fecha_actualizacion timestamptz NOT NULL DEFAULT clock_timestamp(),
  tecnicos_excluidos_extra_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
);

ALTER TABLE public.acumulacion_lideres
  ADD COLUMN IF NOT EXISTS tecnicos_excluidos_extra_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS fecha_actualizacion timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE UNIQUE INDEX IF NOT EXISTS acumulacion_lideres_lider_periodo_uidx
  ON public.acumulacion_lideres (lider_id, periodo_id);

CREATE INDEX IF NOT EXISTS acumulacion_lideres_periodo_idx
  ON public.acumulacion_lideres (periodo_id, lider_id);

ALTER TABLE public.acumulacion_lideres ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.acumulacion_lideres IS
  'Configuración y acumulación del extra líder por líder y período; las exclusiones se guardan en tecnicos_excluidos_extra_ids.';
