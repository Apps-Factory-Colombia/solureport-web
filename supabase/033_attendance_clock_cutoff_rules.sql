BEGIN;

-- The attendance policy is clock-based, shared across workers, and editable
-- from the attendance rules screen. Reconcile the active liquidation period
-- so records already calculated with the previous schedule-relative rule do
-- not continue to carry the old 10% value.
UPDATE public.configuracion_empresa
   SET hora_inicio_descuento_tardanza = '08:05',
       hora_descuento_automatico = '08:30',
       porcentaje_descuento_tardanza = 5,
       porcentaje_descuento_no_reportado = 30,
       fundamento_asistencia = NULL,
       regimen_sancionatorio_asistencia = NULL,
       updated_at = clock_timestamp()
 WHERE id = 1;

CREATE TEMP TABLE attendance_recalc ON COMMIT DROP AS
WITH configured AS (
  SELECT hora_inicio_descuento_tardanza,
         hora_descuento_automatico,
         porcentaje_descuento_tardanza,
         porcentaje_descuento_no_reportado,
         porcentaje_descuento_reposicion,
         minutos_no_reportado
    FROM public.configuracion_empresa
   WHERE id = 1
), classified AS (
  SELECT r.id AS asistencia_id,
         r.usuario_id AS tecnico_id,
         p.id AS periodo_id,
         r.hora_entrada_real,
         r.hora_entrada_programada,
         CASE
           WHEN r.hora_entrada_real IS NULL THEN 'no_reportado'
           WHEN r.hora_entrada_real < c.hora_inicio_descuento_tardanza THEN 'a_tiempo'
           WHEN r.hora_entrada_real >= c.hora_descuento_automatico THEN 'reposicion'
           ELSE 'tardanza_leve'
         END AS categoria,
         CASE
           WHEN r.hora_entrada_real IS NULL THEN c.porcentaje_descuento_no_reportado
           WHEN r.hora_entrada_real < c.hora_inicio_descuento_tardanza THEN 0
           WHEN r.hora_entrada_real >= c.hora_descuento_automatico THEN c.porcentaje_descuento_reposicion
           ELSE c.porcentaje_descuento_tardanza
         END AS porcentaje,
         CASE WHEN r.hora_entrada_real IS NULL THEN 0
              ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (r.hora_entrada_real - r.hora_entrada_programada)) / 60)::integer)
          END AS minutos_retraso,
         CASE WHEN r.hora_entrada_real IS NULL THEN c.minutos_no_reportado
              WHEN r.hora_entrada_real < c.hora_inicio_descuento_tardanza THEN 0
              ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (r.hora_entrada_real - r.hora_entrada_programada)) / 60)::integer)
          END AS minutos_adeudados
    FROM public.registros_asistencia r
    JOIN public.periodos_liquidacion p
      ON r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
     AND p.estado = 'abierto'
    CROSS JOIN configured c
)
SELECT *, porcentaje > 0 AS descuento_aplicado, 'attendance-v4-clock'::text AS regla_version
  FROM classified;

UPDATE public.registros_asistencia r
   SET estado_entrada = CASE WHEN x.categoria = 'no_reportado' THEN 'no_reportado' ELSE CASE WHEN x.categoria = 'a_tiempo' THEN 'a_tiempo' ELSE 'tarde' END END,
       minutos_retraso = x.minutos_retraso,
       minutos_adeudados = x.minutos_adeudados,
       categoria_llegada = x.categoria,
       descuento_aplicado = x.descuento_aplicado,
       porcentaje_descuento = x.porcentaje,
       porcentaje_regla_aplicada = x.porcentaje,
       tipo_descuento = x.categoria,
       regla_version = x.regla_version,
       calculado_en = clock_timestamp(),
       updated_at = clock_timestamp()
  FROM attendance_recalc x
 WHERE r.id = x.asistencia_id;

CREATE TEMP TABLE attendance_recalc_people ON COMMIT DROP AS
SELECT tecnico_id,
       periodo_id,
       COALESCE(SUM(porcentaje) FILTER (WHERE descuento_aplicado), 0) AS porcentaje_bruto,
       LEAST(100, COALESCE(SUM(porcentaje) FILTER (WHERE descuento_aplicado), 0)) AS porcentaje_aplicado
  FROM attendance_recalc
 GROUP BY tecnico_id, periodo_id;

UPDATE public.liquidacion_items li
   SET descuento_tardanza = ROUND(li.valor_ganado_original * p.porcentaje_aplicado / 100, 2),
       valor_ganado = ROUND(li.valor_ganado_original * (1 - p.porcentaje_aplicado / 100), 2),
       porcentaje_descuento_tardanza = p.porcentaje_aplicado,
       updated_at = clock_timestamp()
  FROM attendance_recalc_people p
  JOIN public.periodos_liquidacion pl ON pl.id = p.periodo_id AND pl.estado = 'abierto'
 WHERE li.tecnico_id = p.tecnico_id
   AND li.periodo_id = p.periodo_id
   AND li.tipo <> 'recorrido'
   AND li.estado <> 'anulado';

UPDATE public.liquidacion_items li
   SET valor_ganado = li.valor_ganado_original,
       descuento_tardanza = 0,
       porcentaje_descuento_tardanza = 0,
       updated_at = clock_timestamp()
  FROM attendance_recalc_people p
  JOIN public.periodos_liquidacion pl ON pl.id = p.periodo_id AND pl.estado = 'abierto'
 WHERE li.tecnico_id = p.tecnico_id
   AND li.periodo_id = p.periodo_id
   AND li.tipo = 'recorrido'
   AND (li.descuento_tardanza > 0 OR li.porcentaje_descuento_tardanza > 0);

CREATE TEMP TABLE attendance_recalc_totals ON COMMIT DROP AS
SELECT tecnico_id, periodo_id, COALESCE(SUM(descuento_tardanza), 0) AS valor_total
  FROM public.liquidacion_items
 WHERE estado <> 'anulado'
 GROUP BY tecnico_id, periodo_id;

DELETE FROM public.asistencia_descuentos ad
 USING attendance_recalc_people p
 WHERE ad.tecnico_id = p.tecnico_id
   AND ad.periodo_id = p.periodo_id;

INSERT INTO public.asistencia_descuentos
  (asistencia_id, periodo_id, tecnico_id, porcentaje, porcentaje_acumulado,
   minutos_adeudados, valor, regla_version)
SELECT x.asistencia_id,
       x.periodo_id,
       x.tecnico_id,
       x.porcentaje,
       p.porcentaje_aplicado,
       x.minutos_adeudados,
       CASE WHEN p.porcentaje_bruto > 0 THEN COALESCE(t.valor_total, 0) * x.porcentaje / p.porcentaje_bruto ELSE 0 END,
       x.regla_version
  FROM attendance_recalc x
  JOIN attendance_recalc_people p USING (tecnico_id, periodo_id)
  LEFT JOIN attendance_recalc_totals t USING (tecnico_id, periodo_id)
 WHERE x.descuento_aplicado
ON CONFLICT (asistencia_id, periodo_id) DO UPDATE
  SET porcentaje = EXCLUDED.porcentaje,
      porcentaje_acumulado = EXCLUDED.porcentaje_acumulado,
      minutos_adeudados = EXCLUDED.minutos_adeudados,
      valor = EXCLUDED.valor,
      regla_version = EXCLUDED.regla_version,
      aplicado_en = clock_timestamp();

COMMIT;
