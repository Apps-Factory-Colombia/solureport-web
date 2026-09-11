-- Congelamiento histórico de liquidaciones y arrastre de pendientes.
-- Esta migración es idempotente y no modifica los importes existentes.

ALTER TABLE public.periodos_liquidacion
  ADD COLUMN IF NOT EXISTS liquidacion_congelada_en timestamptz,
  ADD COLUMN IF NOT EXISTS arrastre_pendientes_en timestamptz,
  ADD COLUMN IF NOT EXISTS liquidacion_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.liquidacion_items
  ADD COLUMN IF NOT EXISTS es_arrastre boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS periodo_origen_id uuid,
  ADD COLUMN IF NOT EXISTS item_origen_id uuid;

CREATE INDEX IF NOT EXISTS liquidacion_items_periodo_arrastre_idx
  ON public.liquidacion_items (periodo_id, es_arrastre, estado, fecha_operacion);

CREATE TABLE IF NOT EXISTS public.liquidacion_periodo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id uuid NOT NULL REFERENCES public.periodos_liquidacion(id) ON DELETE CASCADE,
  liquidacion_item_id uuid,
  actividad_id uuid NOT NULL,
  participante_id uuid NOT NULL,
  tecnico_id uuid NOT NULL,
  cliente_id uuid,
  sede_id uuid,
  grupo_id uuid,
  grupo_lider_id uuid,
  codigo_snapshot text,
  fecha_operacion date NOT NULL,
  tipo text NOT NULL,
  descripcion_snapshot text NOT NULL DEFAULT '',
  sede_snapshot text,
  porcentaje numeric NOT NULL DEFAULT 0,
  valor_base numeric NOT NULL DEFAULT 0,
  valor_ganado numeric NOT NULL DEFAULT 0,
  valor_ganado_original numeric NOT NULL DEFAULT 0,
  descuento_tardanza numeric NOT NULL DEFAULT 0,
  porcentaje_descuento_tardanza numeric NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'pendiente',
  extra_lider_porcentaje numeric NOT NULL DEFAULT 0,
  extra_lider_activo boolean NOT NULL DEFAULT false,
  es_arrastre boolean NOT NULL DEFAULT false,
  fecha_snapshot timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT liquidacion_periodo_items_unique_participation
    UNIQUE (periodo_id, actividad_id, participante_id)
);

CREATE INDEX IF NOT EXISTS liquidacion_periodo_items_periodo_tecnico_idx
  ON public.liquidacion_periodo_items (periodo_id, tecnico_id, fecha_operacion DESC);

CREATE INDEX IF NOT EXISTS liquidacion_periodo_items_periodo_estado_idx
  ON public.liquidacion_periodo_items (periodo_id, estado);

ALTER TABLE public.liquidacion_periodo_items ENABLE ROW LEVEL SECURITY;

-- Congela los periodos que ya estaban cerrados antes de desplegar esta versión.
-- El porcentaje queda guardado para que un cambio posterior de configuración no
-- altere su extra líder. La API usa la misma fuente para web, app y PDF.
INSERT INTO public.liquidacion_periodo_items (
  periodo_id, liquidacion_item_id, actividad_id, participante_id, tecnico_id,
  cliente_id, sede_id, grupo_id, grupo_lider_id, codigo_snapshot,
  fecha_operacion, tipo, descripcion_snapshot, sede_snapshot, porcentaje,
  valor_base, valor_ganado, valor_ganado_original, descuento_tardanza,
  porcentaje_descuento_tardanza, estado, extra_lider_porcentaje,
  extra_lider_activo, es_arrastre, fecha_snapshot
)
SELECT
  li.periodo_id, li.id, li.actividad_id, li.participante_id, li.tecnico_id,
  a.cliente_id, a.sede_id, a.grupo_id, g.lider_id, a.codigo,
  li.fecha_operacion, li.tipo, li.descripcion_snapshot, li.sede_snapshot,
  li.porcentaje, li.valor_base, li.valor_ganado, li.valor_ganado_original,
  li.descuento_tardanza, li.porcentaje_descuento_tardanza, li.estado,
  COALESCE(cfg.porcentaje_extra_lider, 0), COALESCE(cfg.extra_lider_activo, false),
  COALESCE(li.es_arrastre, false), COALESCE(li.updated_at, li.created_at)
FROM public.liquidacion_items li
JOIN public.periodos_liquidacion pl ON pl.id = li.periodo_id AND pl.estado = 'cerrado'
JOIN public.actividades_operativas a ON a.id = li.actividad_id
LEFT JOIN public.grupos_trabajo g ON g.id = a.grupo_id
LEFT JOIN public.configuracion_empresa cfg ON cfg.id = 1
ON CONFLICT (periodo_id, actividad_id, participante_id) DO NOTHING;

UPDATE public.periodos_liquidacion pl
   SET liquidacion_congelada_en = COALESCE(pl.liquidacion_congelada_en, pl.fecha_cierre, clock_timestamp()),
       liquidacion_version = GREATEST(COALESCE(pl.liquidacion_version, 1), 1),
       updated_at = clock_timestamp()
 WHERE pl.estado = 'cerrado'
   AND EXISTS (SELECT 1 FROM public.liquidacion_periodo_items s WHERE s.periodo_id = pl.id);

COMMENT ON TABLE public.liquidacion_periodo_items IS
  'Fotografía inmutable de cada participación al cerrar un periodo. Es la fuente histórica común de web, app y PDF.';
COMMENT ON COLUMN public.liquidacion_items.es_arrastre IS
  'Indica que el item pendiente fue trasladado desde un periodo cerrado y puede actualizarse en el periodo abierto.';
