-- Reparación idempotente de cronogramas contractuales y enlaces legacy.
-- Conserva filas con historial y nunca crea actividades operativas.

BEGIN;

WITH expected AS (
  SELECT
    c.id AS contrato_id,
    c.cliente_id,
    gs AS numero,
    make_date(
      c.anio + ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) / 12),
      ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) % 12) + 1,
      c.dia_inicio
    ) AS fecha_programada,
    c.costo_por_mantenimiento,
    exemplar.grupo_id,
    exemplar.tecnico_principal_id
  FROM public.contratos_mantenimiento c
  CROSS JOIN LATERAL generate_series(1, c.cantidad_mantenimientos) AS gs
  LEFT JOIN LATERAL (
    SELECT m.grupo_id, m.tecnico_principal_id
      FROM public.mantenimientos_programados m
     WHERE m.contrato_id = c.id
       AND m.estado NOT IN ('cancelado')
     ORDER BY (m.estado IN ('ejecutado', 'completado')) ASC, m.numero
     LIMIT 1
  ) exemplar ON true
 WHERE c.estado <> 'cancelado'
), missing AS (
  SELECT e.*
    FROM expected e
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.mantenimientos_programados m
      WHERE m.contrato_id = e.contrato_id
        AND m.numero = e.numero
   )
)
INSERT INTO public.mantenimientos_programados (
  contrato_id, cliente_id, numero, fecha_programada, grupo_id,
  tecnico_principal_id, costo_tecnico_presupuestado, estado,
  valor_recaudado, clave_idempotencia
)
SELECT contrato_id, cliente_id, numero, fecha_programada, grupo_id,
       tecnico_principal_id, COALESCE(costo_por_mantenimiento, 0),
       'pendiente', 0, 'contrato:' || contrato_id::text || ':mantenimiento:' || numero::text
  FROM missing
ON CONFLICT (contrato_id, numero) DO NOTHING;

-- Vincula reportes de mantenimiento importados cuando la coincidencia es
-- inequívoca por mantenimiento, cliente y fecha. Las actividades de otro
-- tipo no se tocan.
WITH candidates AS (
  SELECT am.actividad_id, mp.id AS mantenimiento_id,
         COUNT(*) OVER (PARTITION BY am.actividad_id) AS candidate_count
    FROM public.actividades_operativas_mantenimientos am
    JOIN public.actividades_operativas a ON a.id = am.actividad_id
    JOIN public.mantenimientos_programados mp
      ON mp.cliente_id = a.cliente_id
     AND mp.fecha_programada::date = a.fecha_operacion::date
   WHERE a.tipo = 'mantenimiento'
     AND am.mantenimiento_programado_id IS NULL
     AND (
       a.metadata ->> 'mantenimientoId' = mp.id::text
       OR a.clave_idempotencia LIKE 'legacy:mantenimiento:%'
     )
), unique_candidates AS (
  SELECT actividad_id, MIN(mantenimiento_id::text)::uuid AS mantenimiento_id
    FROM candidates
   WHERE candidate_count = 1
   GROUP BY actividad_id
)
UPDATE public.actividades_operativas_mantenimientos am
   SET mantenimiento_programado_id = uc.mantenimiento_id
  FROM unique_candidates uc
 WHERE am.actividad_id = uc.actividad_id
   AND am.mantenimiento_programado_id IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.actividades_operativas_mantenimientos occupied
      WHERE occupied.mantenimiento_programado_id = uc.mantenimiento_id
   );

COMMIT;
