-- Vincula la agenda contractual con la orden ejecutable que usa la app movil.

ALTER TABLE public.mantenimientos
  ADD COLUMN IF NOT EXISTS contrato_mantenimiento_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'mantenimientos'
      AND constraint_name = 'mantenimientos_contrato_mantenimiento_id_fkey'
  ) THEN
    ALTER TABLE public.mantenimientos
      ADD CONSTRAINT mantenimientos_contrato_mantenimiento_id_fkey
      FOREIGN KEY (contrato_mantenimiento_id) REFERENCES public.contrato_mantenimientos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mantenimientos_contrato_mantenimiento_unique
  ON public.mantenimientos (contrato_mantenimiento_id)
  WHERE contrato_mantenimiento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_tecnico_fecha
  ON public.mantenimientos (tecnico_id, fecha_programada);

INSERT INTO public.mantenimientos (
  cliente_id,
  tecnico_id,
  lider_id,
  titulo,
  descripcion,
  fecha_programada,
  estado,
  prioridad,
  ubicacion,
  edificio,
  tipo_reporte,
  costo_tecnico_total,
  contrato_mantenimiento_id
)
SELECT
  c.cliente_id,
  cm.tecnico_id,
  g.lider_id,
  'Mantenimiento programado',
  'Mantenimiento preventivo contractual para ' || COALESCE(NULLIF(cl.edificio, ''), cl.nombre, 'cliente'),
  cm.fecha_programada,
  CASE WHEN cm.estado = 'realizado' THEN 'realizado' ELSE 'programado' END,
  'media',
  cl.direccion,
  cl.edificio,
  'preventivo',
  COALESCE(cm.costo_tecnico_total, cm.valor_recaudado, 0),
  cm.id
FROM public.contrato_mantenimientos cm
INNER JOIN public.contratos_mantenimiento c ON c.id = cm.contrato_id
INNER JOIN public.clientes cl ON cl.id = c.cliente_id
INNER JOIN public.usuarios u ON u.id = cm.tecnico_id
LEFT JOIN public.grupos_trabajo g ON g.id = u.grupo_id
WHERE cm.tecnico_id IS NOT NULL
  AND cm.estado IN ('programado', 'realizado')
  AND NOT EXISTS (
    SELECT 1
    FROM public.mantenimientos m
    WHERE m.contrato_mantenimiento_id = cm.id
  );

INSERT INTO public.mantenimiento_participantes (maintenance_id, usuario_id, porcentaje, valor_calculado)
SELECT
  m.id,
  m.tecnico_id,
  100,
  COALESCE(m.costo_tecnico_total, 0)
FROM public.mantenimientos m
WHERE m.contrato_mantenimiento_id IS NOT NULL
  AND m.tecnico_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.mantenimiento_participantes mp
    WHERE mp.maintenance_id = m.id
      AND mp.usuario_id = m.tecnico_id
  );
