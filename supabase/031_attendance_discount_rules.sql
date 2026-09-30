-- Reglas independientes para tardanzas reportadas y entradas no reportadas.
-- La regla anterior usaba una sola hora y porcentaje para ambos casos.

ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS hora_inicio_descuento_tardanza time without time zone
    NOT NULL DEFAULT '08:05:00',
  ADD COLUMN IF NOT EXISTS porcentaje_descuento_no_reportado numeric
    NOT NULL DEFAULT 30.00;

UPDATE public.configuracion_empresa
   SET hora_inicio_descuento_tardanza = '08:05:00',
       porcentaje_descuento_tardanza = 5.00,
       hora_descuento_automatico = '08:30:00',
       porcentaje_descuento_no_reportado = 30.00
 WHERE id = 1;

-- Recalcula únicamente períodos abiertos. Los períodos cerrados son históricos
-- y no deben cambiar al ajustar las reglas actuales.
UPDATE public.registros_asistencia AS r
   SET descuento_aplicado = CASE
         WHEN r.estado_entrada = 'no_reportado' THEN cfg.porcentaje_descuento_no_reportado > 0
         WHEN r.hora_entrada_real >= cfg.hora_descuento_automatico THEN cfg.porcentaje_descuento_no_reportado > 0
         WHEN r.hora_entrada_real >= cfg.hora_inicio_descuento_tardanza THEN cfg.porcentaje_descuento_tardanza > 0
         ELSE false
       END,
       porcentaje_descuento = CASE
         WHEN r.estado_entrada = 'no_reportado' THEN cfg.porcentaje_descuento_no_reportado
         WHEN r.hora_entrada_real >= cfg.hora_descuento_automatico THEN cfg.porcentaje_descuento_no_reportado
         WHEN r.hora_entrada_real >= cfg.hora_inicio_descuento_tardanza THEN cfg.porcentaje_descuento_tardanza
         ELSE 0
       END,
       updated_at = clock_timestamp()
  FROM public.configuracion_empresa cfg
 WHERE cfg.id = 1
   AND EXISTS (
     SELECT 1 FROM public.periodos_liquidacion p
      WHERE p.estado = 'abierto'
        AND r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
   );

UPDATE public.liquidacion_items AS li
   SET descuento_tardanza = ROUND(li.valor_ganado_original * COALESCE((
         SELECT MAX(r.porcentaje_descuento)
           FROM public.registros_asistencia r
          WHERE r.usuario_id = li.tecnico_id
            AND r.descuento_aplicado = true
            AND r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
       ), 0) / 100, 2),
       valor_ganado = ROUND(li.valor_ganado_original * (1 - COALESCE((
         SELECT MAX(r.porcentaje_descuento)
           FROM public.registros_asistencia r
          WHERE r.usuario_id = li.tecnico_id
            AND r.descuento_aplicado = true
            AND r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
       ), 0) / 100), 2),
       porcentaje_descuento_tardanza = COALESCE((
         SELECT MAX(r.porcentaje_descuento)
           FROM public.registros_asistencia r
          WHERE r.usuario_id = li.tecnico_id
            AND r.descuento_aplicado = true
            AND r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
       ), 0),
       updated_at = clock_timestamp()
  FROM public.periodos_liquidacion p
 WHERE li.periodo_id = p.id
   AND p.estado = 'abierto'
   AND li.tipo <> 'recorrido'
   AND li.estado <> 'anulado';

ALTER TABLE public.configuracion_empresa
  DROP CONSTRAINT IF EXISTS configuracion_empresa_porcentajes_descuento_check;

ALTER TABLE public.configuracion_empresa
  ADD CONSTRAINT configuracion_empresa_porcentajes_descuento_check
  CHECK (
    porcentaje_descuento_tardanza BETWEEN 0 AND 100
    AND porcentaje_descuento_no_reportado BETWEEN 0 AND 100
  );

COMMENT ON COLUMN public.configuracion_empresa.hora_inicio_descuento_tardanza IS
  'Hora desde la que una llegada reportada se considera tardanza y aplica el descuento normal.';

COMMENT ON COLUMN public.configuracion_empresa.porcentaje_descuento_no_reportado IS
  'Porcentaje aplicado cuando no existe reporte de entrada al llegar la hora de corte.';
