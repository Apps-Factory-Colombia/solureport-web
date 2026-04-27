-- Soporta mantenimientos preventivos con multiples participantes,
-- costo tecnico total y espejo correcto hacia reportes_actividad.

ALTER TABLE public.mantenimientos
  ADD COLUMN IF NOT EXISTS costo_tecnico_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.contrato_mantenimientos
  ADD COLUMN IF NOT EXISTS costo_tecnico_total numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.mantenimiento_participantes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  maintenance_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  porcentaje numeric NOT NULL DEFAULT 0 CHECK (porcentaje >= 0::numeric AND porcentaje <= 100::numeric),
  valor_calculado numeric NOT NULL DEFAULT 0,
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now(),
  fecha_actualizacion timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_participantes_pkey PRIMARY KEY (id),
  CONSTRAINT mantenimiento_participantes_unique UNIQUE (maintenance_id, usuario_id),
  CONSTRAINT mantenimiento_participantes_maintenance_fkey FOREIGN KEY (maintenance_id) REFERENCES public.mantenimientos(id) ON DELETE CASCADE,
  CONSTRAINT mantenimiento_participantes_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_participantes_maintenance_id
  ON public.mantenimiento_participantes (maintenance_id);

CREATE INDEX IF NOT EXISTS idx_mantenimiento_participantes_usuario_id
  ON public.mantenimiento_participantes (usuario_id);

ALTER TABLE public.reportes_actividad
  ADD COLUMN IF NOT EXISTS mantenimiento_id uuid,
  ADD COLUMN IF NOT EXISTS mantenimiento_participante_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'reportes_actividad'
      AND constraint_name = 'reportes_actividad_mantenimiento_id_fkey'
  ) THEN
    ALTER TABLE public.reportes_actividad
      ADD CONSTRAINT reportes_actividad_mantenimiento_id_fkey
      FOREIGN KEY (mantenimiento_id) REFERENCES public.mantenimientos(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'reportes_actividad'
      AND constraint_name = 'reportes_actividad_mantenimiento_participante_id_fkey'
  ) THEN
    ALTER TABLE public.reportes_actividad
      ADD CONSTRAINT reportes_actividad_mantenimiento_participante_id_fkey
      FOREIGN KEY (mantenimiento_participante_id) REFERENCES public.mantenimiento_participantes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reportes_actividad_mantenimiento_id
  ON public.reportes_actividad (mantenimiento_id)
  WHERE tipo = 'mantenimiento_preventivo';

CREATE INDEX IF NOT EXISTS idx_reportes_actividad_mantenimiento_participante_id
  ON public.reportes_actividad (mantenimiento_participante_id)
  WHERE tipo = 'mantenimiento_preventivo';

UPDATE public.mantenimientos
SET costo_tecnico_total = COALESCE(costo_tecnico_total, 0)
WHERE costo_tecnico_total IS NULL;

UPDATE public.contrato_mantenimientos
SET costo_tecnico_total = COALESCE(costo_tecnico_total, valor_recaudado, 0)
WHERE costo_tecnico_total IS NULL;

INSERT INTO public.mantenimiento_participantes (maintenance_id, usuario_id, porcentaje, valor_calculado)
SELECT
  m.id,
  m.tecnico_id,
  100,
  COALESCE(NULLIF(m.costo_tecnico_total, 0), 0)
FROM public.mantenimientos m
WHERE m.tecnico_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.mantenimiento_participantes mp
    WHERE mp.maintenance_id = m.id
      AND mp.usuario_id = m.tecnico_id
  );

WITH participant_totals AS (
  SELECT
    mp.maintenance_id,
    SUM(COALESCE(mp.valor_calculado, 0)) AS total_valor
  FROM public.mantenimiento_participantes mp
  GROUP BY mp.maintenance_id
)
UPDATE public.mantenimientos m
SET costo_tecnico_total = COALESCE(pt.total_valor, m.costo_tecnico_total, 0)
FROM participant_totals pt
WHERE pt.maintenance_id = m.id;

WITH report_candidates AS (
  SELECT
    ra.id AS reporte_actividad_id,
    rm.mantenimiento_id,
    mp.id AS mantenimiento_participante_id,
    mp.porcentaje,
    mp.valor_calculado,
    ROW_NUMBER() OVER (
      PARTITION BY ra.id
      ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(ra.fecha_creacion, now()) - rm.fecha_generacion))) ASC, rm.id ASC
    ) AS rn
  FROM public.reportes_actividad ra
  INNER JOIN public.reportes_mantenimiento rm
    ON rm.tecnico_id = ra.tecnico_id
   AND rm.cliente_id = ra.cliente_id
  INNER JOIN public.mantenimiento_participantes mp
    ON mp.maintenance_id = rm.mantenimiento_id
   AND mp.usuario_id = ra.tecnico_id
  INNER JOIN public.mantenimientos m
    ON m.id = rm.mantenimiento_id
   AND COALESCE(m.fecha_programada::date, rm.fecha_generacion::date) = ra.fecha
  WHERE ra.tipo = 'mantenimiento_preventivo'
), best_match AS (
  SELECT *
  FROM report_candidates
  WHERE rn = 1
)
UPDATE public.reportes_actividad ra
SET
  mantenimiento_id = bm.mantenimiento_id,
  mantenimiento_participante_id = bm.mantenimiento_participante_id,
  costo_actividad_default = COALESCE(m.costo_tecnico_total, ra.costo_actividad_default, 0),
  costo_actividad = COALESCE(NULLIF(bm.valor_calculado, 0), ra.costo_actividad, 0)
FROM best_match bm
INNER JOIN public.mantenimientos m ON m.id = bm.mantenimiento_id
WHERE ra.id = bm.reporte_actividad_id;

WITH duplicated_preventive_reports AS (
  SELECT
    ra.id,
    ROW_NUMBER() OVER (
      PARTITION BY ra.tipo, COALESCE(ra.mantenimiento_id, ra.id), ra.tecnico_id
      ORDER BY COALESCE(ra.fecha_creacion, now()) DESC, ra.id DESC
    ) AS rn
  FROM public.reportes_actividad ra
  WHERE ra.tipo = 'mantenimiento_preventivo'
    AND ra.mantenimiento_id IS NOT NULL
)
DELETE FROM public.reportes_actividad ra
USING duplicated_preventive_reports dpr
WHERE ra.id = dpr.id
  AND dpr.rn > 1;
