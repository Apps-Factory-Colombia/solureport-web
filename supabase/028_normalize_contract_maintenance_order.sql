-- Corrige el orden interno de los mantenimientos generados por contrato.
--
-- Antes de esta migración, algunos cronogramas guardaron en `numero` el mes
-- calendario (por ejemplo 9, 1, 5) en vez de la posición del mantenimiento
-- (1, 2, 3). Se conservan fechas, IDs, estados, valores y relaciones; solo
-- se normaliza el número cuando el conjunto de fechas coincide exactamente
-- con el cronograma autoritativo del contrato.

BEGIN;

-- La tabla solo valida que el número sea positivo. Se quita temporalmente
-- esa validación para poder mover las filas a números negativos y evitar
-- colisiones con la restricción UNIQUE (contrato_id, numero).
ALTER TABLE public.mantenimientos_programados
  DROP CONSTRAINT IF EXISTS mantenimientos_programados_numero_check;

DO $$
DECLARE
  contract_row record;
BEGIN
  FOR contract_row IN
    WITH expected AS (
      SELECT c.id AS contrato_id,
             gs AS numero,
             make_date(
               c.anio + ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) / 12),
               ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) % 12) + 1,
               c.dia_inicio
             ) AS fecha
      FROM public.contratos_mantenimiento c
      CROSS JOIN LATERAL generate_series(1, c.cantidad_mantenimientos) AS gs
    ),
    stats AS (
      SELECT c.id,
             c.cantidad_mantenimientos,
             count(m.id)::int AS actual_count,
             count(e.numero)::int AS matched_count,
             count(*) FILTER (WHERE m.numero = e.numero)::int AS correct_count
      FROM public.contratos_mantenimiento c
      LEFT JOIN public.mantenimientos_programados m ON m.contrato_id = c.id
      LEFT JOIN expected e ON e.contrato_id = c.id AND e.fecha = m.fecha_programada
      GROUP BY c.id, c.cantidad_mantenimientos
    )
    SELECT id
    FROM stats
    WHERE actual_count = cantidad_mantenimientos
      AND matched_count = cantidad_mantenimientos
      AND correct_count < cantidad_mantenimientos
  LOOP
    -- Todas las filas del contrato quedan temporalmente fuera del rango
    -- positivo, manteniendo sus IDs y evitando colisiones de la UNIQUE.
    UPDATE public.mantenimientos_programados
       SET numero = -numero,
           updated_at = clock_timestamp()
     WHERE contrato_id = contract_row.id;

    -- El orden se asigna por la fecha calculada del contrato. Las fechas no
    -- se modifican y las filas con historial conservan su identidad.
    WITH contract_data AS (
      SELECT id, anio, mes_inicio, dia_inicio, cantidad_mantenimientos, frecuencia_meses
      FROM public.contratos_mantenimiento
      WHERE id = contract_row.id
    ), expected AS (
      SELECT gs AS numero,
             make_date(
               c.anio + ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) / 12),
               ((c.mes_inicio - 1 + ((gs - 1) * c.frecuencia_meses)) % 12) + 1,
               c.dia_inicio
             ) AS fecha
      FROM contract_data c
      CROSS JOIN LATERAL generate_series(1, c.cantidad_mantenimientos) AS gs
    )
    UPDATE public.mantenimientos_programados m
       SET numero = e.numero,
           updated_at = clock_timestamp()
      FROM expected e
     WHERE m.contrato_id = contract_row.id
       AND m.numero < 0
       AND m.fecha_programada = e.fecha;
  END LOOP;
END $$;

ALTER TABLE public.mantenimientos_programados
  ADD CONSTRAINT mantenimientos_programados_numero_check CHECK (numero > 0);

COMMIT;
