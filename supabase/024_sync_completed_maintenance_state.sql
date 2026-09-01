-- Sincroniza el estado global de mantenimientos cuyas entregas individuales
-- ya fueron enviadas por todos sus participantes activos.
-- Es idempotente y no toca mantenimientos cancelados ni los que aún tienen
-- técnicos pendientes.
WITH completed_maintenance AS (
  SELECT
    m.id,
    MAX(d.fecha_ejecucion::date) AS fecha_realizado
  FROM public.mantenimientos_programados m
  JOIN public.mantenimientos_programados_participantes mp
    ON mp.mantenimiento_id = m.id
   AND mp.estado = 'activo'
  LEFT JOIN public.actividades_operativas_mantenimientos am
    ON am.mantenimiento_programado_id = m.id
  LEFT JOIN public.actividades_operativas_participantes ap
    ON ap.actividad_id = am.actividad_id
   AND ap.tecnico_id = mp.usuario_id
  LEFT JOIN public.actividades_operativas_entregas d
    ON d.actividad_id = ap.actividad_id
   AND d.participante_id = ap.id
   AND d.estado IN ('enviada', 'aprobada')
  WHERE m.estado NOT IN ('ejecutado', 'completado', 'cancelado')
  GROUP BY m.id
  HAVING COUNT(DISTINCT mp.id) > 0
     AND COUNT(DISTINCT mp.id) = COUNT(DISTINCT mp.id) FILTER (WHERE d.id IS NOT NULL)
)
UPDATE public.mantenimientos_programados m
   SET estado = 'ejecutado',
       fecha_realizado = COALESCE(m.fecha_realizado, c.fecha_realizado),
       updated_at = clock_timestamp()
  FROM completed_maintenance c
 WHERE m.id = c.id
   AND m.estado NOT IN ('ejecutado', 'completado', 'cancelado');
