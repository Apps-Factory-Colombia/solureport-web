-- Refuerzo de identidad de actividades.
--
-- Esta migración complementa migration_activity_registration_codes.sql y es
-- idempotente. El código es la identidad primaria de una actividad; las
-- coincidencias por fecha/descripción solo se conservan como compatibilidad
-- para datos históricos que todavía no tienen código.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.visitas_tecnicas
  ADD COLUMN IF NOT EXISTS codigo_registro text;

ALTER TABLE public.mantenimientos
  ADD COLUMN IF NOT EXISTS codigo_registro text;

ALTER TABLE public.recorridos
  ADD COLUMN IF NOT EXISTS codigo_registro text;

ALTER TABLE public.registros_actividades
  ADD COLUMN IF NOT EXISTS codigo_registro text;

ALTER TABLE public.reportes_actividad
  ADD COLUMN IF NOT EXISTS codigo_registro text,
  ADD COLUMN IF NOT EXISTS visita_tecnica_id uuid,
  ADD COLUMN IF NOT EXISTS recorrido_id uuid,
  ADD COLUMN IF NOT EXISTS mantenimiento_id uuid,
  ADD COLUMN IF NOT EXISTS mantenimiento_participante_id uuid,
  ADD COLUMN IF NOT EXISTS tipo_visita character varying;

ALTER TABLE public.items_liquidacion
  ADD COLUMN IF NOT EXISTS codigo_registro text;

-- Una reejecucion despues de un intento anterior no debe disparar funciones
-- antiguas mientras se normalizan y reasignan los registros historicos.
DROP TRIGGER IF EXISTS trg_visitas_tecnicas_registration_defaults ON public.visitas_tecnicas;
DROP TRIGGER IF EXISTS trg_mantenimientos_registration_defaults ON public.mantenimientos;
DROP TRIGGER IF EXISTS trg_recorridos_registration_defaults ON public.recorridos;
DROP TRIGGER IF EXISTS trg_registros_actividades_registration_defaults ON public.registros_actividades;
DROP TRIGGER IF EXISTS trg_reportes_actividad_registration_defaults ON public.reportes_actividad;
DROP TRIGGER IF EXISTS trg_visitas_tecnicas_registration_identity ON public.visitas_tecnicas;
DROP TRIGGER IF EXISTS trg_mantenimientos_registration_identity ON public.mantenimientos;
DROP TRIGGER IF EXISTS trg_recorridos_registration_identity ON public.recorridos;
DROP TRIGGER IF EXISTS trg_registros_actividades_registration_identity ON public.registros_actividades;
DROP TRIGGER IF EXISTS trg_reportes_actividad_registration_identity ON public.reportes_actividad;
DROP TRIGGER IF EXISTS trg_items_liquidacion_registration_identity ON public.items_liquidacion;

UPDATE public.visitas_tecnicas
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

UPDATE public.mantenimientos
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

UPDATE public.recorridos
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

UPDATE public.registros_actividades
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

UPDATE public.reportes_actividad
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

UPDATE public.items_liquidacion
SET codigo_registro = upper(nullif(btrim(codigo_registro), ''))
WHERE codigo_registro IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.activity_registration_registry (
  codigo_registro text PRIMARY KEY,
  tipo text NOT NULL,
  clave_origen text NOT NULL,
  fecha_creacion timestamp with time zone NOT NULL DEFAULT now()
);

-- El registro se deriva de las tablas operativas. Reconstruirlo permite
-- reintentar la migracion sin conservar reservas incompletas de otro intento.
TRUNCATE TABLE public.activity_registration_registry;

CREATE OR REPLACE FUNCTION public.generate_activity_registration_code(prefix text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := upper(prefix)
      || '-'
      || to_char(current_date, 'YYYYMMDD')
      || '-'
      || upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 12));

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.activity_registration_registry
      WHERE codigo_registro = candidate
    );
  END LOOP;

  RETURN candidate;
END;
$$;

-- Reserva el código a nivel global. Se permite repetirlo únicamente cuando
-- representa la misma actividad lógica (por ejemplo, los participantes de
-- una visita grupal), nunca para otra actividad.
CREATE OR REPLACE FUNCTION public.reserve_activity_registration_code(
  p_codigo text,
  p_tipo text,
  p_clave_origen text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  existing_row public.activity_registration_registry%ROWTYPE;
  normalized_code text := upper(nullif(btrim(coalesce(p_codigo, '')), ''));
BEGIN
  IF normalized_code IS NULL THEN
    RAISE EXCEPTION 'El código de registro no puede estar vacío';
  END IF;

  INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
  VALUES (normalized_code, p_tipo, p_clave_origen)
  ON CONFLICT (codigo_registro) DO NOTHING;

  SELECT *
  INTO existing_row
  FROM public.activity_registration_registry
  WHERE codigo_registro = normalized_code
  FOR UPDATE;

  IF existing_row.tipo <> p_tipo OR existing_row.clave_origen <> p_clave_origen THEN
    RAISE EXCEPTION 'El código de registro % ya pertenece a otra actividad', normalized_code
      USING ERRCODE = '23505';
  END IF;
END;
$$;

-- Completa códigos antiguos antes de activar los triggers nuevos.
UPDATE public.visitas_tecnicas
SET codigo_registro = public.generate_activity_registration_code('VT')
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NULL;

UPDATE public.mantenimientos
SET codigo_registro = public.generate_activity_registration_code('MP')
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NULL;

UPDATE public.recorridos
SET codigo_registro = public.generate_activity_registration_code('RC')
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NULL;

UPDATE public.registros_actividades
SET codigo_registro = public.generate_activity_registration_code('AG')
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NULL;

UPDATE public.reportes_actividad ra
SET codigo_registro = vt.codigo_registro,
    tipo_visita = coalesce(ra.tipo_visita, vt.tipo_visita)
FROM public.visitas_tecnicas vt
WHERE ra.tipo = 'visita_tecnica'
  AND ra.visita_tecnica_id = vt.id;

UPDATE public.reportes_actividad ra
SET codigo_registro = m.codigo_registro
FROM public.mantenimientos m
WHERE ra.tipo = 'mantenimiento_preventivo'
  AND ra.mantenimiento_id = m.id;

UPDATE public.reportes_actividad ra
SET codigo_registro = r.codigo_registro
FROM public.recorridos r
WHERE ra.tipo = 'recorrido'
  AND ra.recorrido_id = r.id;

UPDATE public.reportes_actividad
SET codigo_registro = public.generate_activity_registration_code(
  CASE WHEN tipo = 'visita_tecnica' THEN 'VT'
       WHEN tipo = 'mantenimiento_preventivo' THEN 'MP'
       WHEN tipo = 'recorrido' THEN 'RC'
       ELSE 'AG'
  END
)
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NULL;

UPDATE public.items_liquidacion il
SET codigo_registro = ra.codigo_registro
FROM public.reportes_actividad ra
WHERE il.referencia_id = ra.id
  AND nullif(btrim(coalesce(il.codigo_registro, '')), '') IS NULL;

UPDATE public.items_liquidacion il
SET codigo_registro = vt.codigo_registro
FROM public.visitas_tecnicas vt
WHERE il.tipo = 'visita_tecnica'
  AND il.referencia_id = vt.id
  AND nullif(btrim(coalesce(il.codigo_registro, '')), '') IS NULL;

UPDATE public.items_liquidacion il
SET codigo_registro = r.codigo_registro
FROM public.recorridos r
WHERE il.tipo = 'recorrido'
  AND il.referencia_id = r.id
  AND nullif(btrim(coalesce(il.codigo_registro, '')), '') IS NULL;

-- El registro permite que códigos repetidos entre participantes sean válidos,
-- pero detecta cualquier reutilización del mismo código para otra actividad.
INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
SELECT DISTINCT ON (codigo_registro)
  upper(btrim(codigo_registro)),
  'visita_tecnica',
  concat_ws('|', 'VT', cliente_id::text, fecha_inicio::date::text, lower(tipo_visita), lower(btrim(descripcion)))
FROM public.visitas_tecnicas
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
ORDER BY codigo_registro, fecha_creacion, id
ON CONFLICT (codigo_registro) DO NOTHING;

INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
SELECT upper(btrim(codigo_registro)), 'mantenimiento',
  concat_ws('|', 'MP', cliente_id::text, fecha_programada::text)
FROM public.mantenimientos
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
ON CONFLICT (codigo_registro) DO NOTHING;

INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
SELECT upper(btrim(codigo_registro)), 'recorrido',
  concat_ws('|', 'RC', tecnico_id::text, fecha::text, lower(btrim(punto_partida)), lower(btrim(punto_llegada)), tipo_recorrido)
FROM public.recorridos
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
ON CONFLICT (codigo_registro) DO NOTHING;

INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
SELECT upper(btrim(codigo_registro)), 'actividad_grupal',
  concat_ws('|', 'AG', lider_id::text, grupo_id::text, cliente_id::text, fecha::text)
FROM public.registros_actividades
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
ON CONFLICT (codigo_registro) DO NOTHING;

INSERT INTO public.activity_registration_registry (codigo_registro, tipo, clave_origen)
SELECT DISTINCT ON (upper(btrim(codigo_registro)))
  upper(btrim(codigo_registro)),
  CASE WHEN tipo = 'visita_tecnica' THEN 'visita_tecnica'
       WHEN tipo = 'mantenimiento_preventivo' THEN 'mantenimiento'
       WHEN tipo = 'recorrido' THEN 'recorrido'
       ELSE 'actividad_grupal'
  END,
  concat_ws('|', tipo, grupo_id::text, cliente_id::text, fecha::text, lider_grupo_id::text)
FROM public.reportes_actividad
WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
ORDER BY upper(btrim(codigo_registro)), fecha_creacion, id
ON CONFLICT (codigo_registro) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_visita_tecnica_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSE
    NEW.codigo_registro := upper(nullif(btrim(coalesce(NEW.codigo_registro, '')), ''));
    IF NEW.codigo_registro IS NULL THEN
      NEW.codigo_registro := public.generate_activity_registration_code('VT');
    END IF;
  END IF;

  PERFORM public.reserve_activity_registration_code(
    NEW.codigo_registro,
    'visita_tecnica',
    concat_ws('|', 'VT', NEW.cliente_id::text, NEW.fecha_inicio::date::text, lower(NEW.tipo_visita), lower(btrim(NEW.descripcion)))
  );

  IF lower(coalesce(NEW.tipo_visita, '')) = 'entregas' THEN
    NEW.costo_visita_tecnica_default := 0;
    NEW.valor_cobrado_cliente := 0;
    NEW.valor_modificado := false;
    NEW.motivo_modificacion_valor := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_mantenimiento_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSE
    NEW.codigo_registro := upper(nullif(btrim(coalesce(NEW.codigo_registro, '')), ''));
    IF NEW.codigo_registro IS NULL THEN
      NEW.codigo_registro := public.generate_activity_registration_code('MP');
    END IF;
  END IF;

  PERFORM public.reserve_activity_registration_code(
    NEW.codigo_registro,
    'mantenimiento',
    concat_ws('|', 'MP', NEW.cliente_id::text, NEW.fecha_programada::text)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_recorrido_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSE
    NEW.codigo_registro := upper(nullif(btrim(coalesce(NEW.codigo_registro, '')), ''));
    IF NEW.codigo_registro IS NULL THEN
      NEW.codigo_registro := public.generate_activity_registration_code('RC');
    END IF;
  END IF;

  PERFORM public.reserve_activity_registration_code(
    NEW.codigo_registro,
    'recorrido',
    concat_ws('|', 'RC', NEW.tecnico_id::text, NEW.fecha::text, lower(btrim(NEW.punto_partida)), lower(btrim(NEW.punto_llegada)), NEW.tipo_recorrido)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_registro_actividad_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSE
    NEW.codigo_registro := upper(nullif(btrim(coalesce(NEW.codigo_registro, '')), ''));
    IF NEW.codigo_registro IS NULL THEN
      NEW.codigo_registro := public.generate_activity_registration_code('AG');
    END IF;
  END IF;

  PERFORM public.reserve_activity_registration_code(
    NEW.codigo_registro,
    'actividad_grupal',
    concat_ws('|', 'AG', NEW.lider_id::text, NEW.grupo_id::text, NEW.cliente_id::text, NEW.fecha::text)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_reporte_actividad_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_code text;
  source_visit_type text;
  source_key text;
  normalized_type text;
  code_prefix text;
BEGIN
  IF NEW.tipo = 'visita_tecnica' AND NEW.visita_tecnica_id IS NOT NULL THEN
    SELECT codigo_registro, tipo_visita,
      concat_ws('|', 'VT', cliente_id::text, fecha_inicio::date::text, lower(tipo_visita), lower(btrim(descripcion)))
    INTO source_code, source_visit_type, source_key
    FROM public.visitas_tecnicas
    WHERE id = NEW.visita_tecnica_id;
    NEW.tipo_visita := coalesce(NEW.tipo_visita, source_visit_type);
  ELSIF NEW.tipo = 'mantenimiento_preventivo' AND NEW.mantenimiento_id IS NOT NULL THEN
    SELECT codigo_registro, concat_ws('|', 'MP', cliente_id::text, fecha_programada::text)
    INTO source_code, source_key
    FROM public.mantenimientos
    WHERE id = NEW.mantenimiento_id;
  ELSIF NEW.tipo = 'recorrido' AND NEW.recorrido_id IS NOT NULL THEN
    SELECT codigo_registro, concat_ws('|', 'RC', tecnico_id::text, fecha::text, lower(btrim(punto_partida)), lower(btrim(punto_llegada)), tipo_recorrido)
    INTO source_code, source_key
    FROM public.recorridos
    WHERE id = NEW.recorrido_id;
  END IF;

  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSIF nullif(btrim(coalesce(source_code, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := source_code;
  ELSE
    NEW.codigo_registro := upper(nullif(btrim(coalesce(NEW.codigo_registro, '')), ''));
    IF NEW.codigo_registro IS NULL THEN
      code_prefix := CASE WHEN NEW.tipo = 'visita_tecnica' THEN 'VT'
        WHEN NEW.tipo = 'mantenimiento_preventivo' THEN 'MP'
        WHEN NEW.tipo = 'recorrido' THEN 'RC'
        ELSE 'AG' END;
      NEW.codigo_registro := public.generate_activity_registration_code(code_prefix);
    END IF;
  END IF;

  normalized_type := CASE WHEN NEW.tipo = 'visita_tecnica' THEN 'visita_tecnica'
    WHEN NEW.tipo = 'mantenimiento_preventivo' THEN 'mantenimiento'
    WHEN NEW.tipo = 'recorrido' THEN 'recorrido'
    ELSE 'actividad_grupal' END;

  IF source_key IS NULL THEN
    source_key := CASE WHEN normalized_type = 'visita_tecnica' THEN
        concat_ws('|', 'VT', NEW.cliente_id::text, NEW.fecha::text, lower(coalesce(NEW.tipo_visita, '')), lower(btrim(NEW.descripcion)))
      WHEN normalized_type = 'mantenimiento' THEN
        concat_ws('|', 'MP', NEW.cliente_id::text, NEW.fecha::text)
      WHEN normalized_type = 'recorrido' THEN
        concat_ws('|', 'RC', NEW.tecnico_id::text, NEW.fecha::text, lower(btrim(NEW.punto_partida)), lower(btrim(NEW.punto_llegada)), NEW.tipo_recorrido)
      ELSE
        concat_ws('|', 'AG', NEW.lider_grupo_id::text, NEW.grupo_id::text, NEW.cliente_id::text, NEW.fecha::text)
    END;
  END IF;

  PERFORM public.reserve_activity_registration_code(
    NEW.codigo_registro,
    normalized_type,
    source_key
  );

  IF NEW.tipo = 'visita_tecnica' AND lower(coalesce(NEW.tipo_visita, '')) = 'entregas' THEN
    NEW.costo_actividad_default := 0;
    NEW.costo_actividad := 0;
    NEW.valor_modificado := false;
    NEW.motivo_modificacion_valor := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_item_liquidacion_registration_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_code text;
BEGIN
  IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.codigo_registro, '')), '') IS NOT NULL THEN
    NEW.codigo_registro := OLD.codigo_registro;
  ELSE
    IF NEW.referencia_id IS NOT NULL THEN
      SELECT codigo_registro INTO source_code
      FROM public.reportes_actividad
      WHERE id = NEW.referencia_id;

      IF source_code IS NULL AND NEW.tipo = 'visita_tecnica' THEN
        SELECT codigo_registro INTO source_code FROM public.visitas_tecnicas WHERE id = NEW.referencia_id;
      ELSIF source_code IS NULL AND NEW.tipo = 'recorrido' THEN
        SELECT codigo_registro INTO source_code FROM public.recorridos WHERE id = NEW.referencia_id;
      END IF;
    END IF;

    NEW.codigo_registro := upper(nullif(btrim(coalesce(source_code, NEW.codigo_registro, '')), ''));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visitas_tecnicas_registration_identity ON public.visitas_tecnicas;
CREATE TRIGGER trg_visitas_tecnicas_registration_identity
BEFORE INSERT OR UPDATE ON public.visitas_tecnicas
FOR EACH ROW EXECUTE FUNCTION public.ensure_visita_tecnica_registration_identity();

DROP TRIGGER IF EXISTS trg_mantenimientos_registration_identity ON public.mantenimientos;
CREATE TRIGGER trg_mantenimientos_registration_identity
BEFORE INSERT OR UPDATE ON public.mantenimientos
FOR EACH ROW EXECUTE FUNCTION public.ensure_mantenimiento_registration_identity();

DROP TRIGGER IF EXISTS trg_recorridos_registration_identity ON public.recorridos;
CREATE TRIGGER trg_recorridos_registration_identity
BEFORE INSERT OR UPDATE ON public.recorridos
FOR EACH ROW EXECUTE FUNCTION public.ensure_recorrido_registration_identity();

DROP TRIGGER IF EXISTS trg_registros_actividades_registration_identity ON public.registros_actividades;
CREATE TRIGGER trg_registros_actividades_registration_identity
BEFORE INSERT OR UPDATE ON public.registros_actividades
FOR EACH ROW EXECUTE FUNCTION public.ensure_registro_actividad_registration_identity();

DROP TRIGGER IF EXISTS trg_reportes_actividad_registration_identity ON public.reportes_actividad;
CREATE TRIGGER trg_reportes_actividad_registration_identity
BEFORE INSERT OR UPDATE ON public.reportes_actividad
FOR EACH ROW EXECUTE FUNCTION public.ensure_reporte_actividad_registration_identity();

DROP TRIGGER IF EXISTS trg_items_liquidacion_registration_identity ON public.items_liquidacion;
CREATE TRIGGER trg_items_liquidacion_registration_identity
BEFORE INSERT OR UPDATE ON public.items_liquidacion
FOR EACH ROW EXECUTE FUNCTION public.ensure_item_liquidacion_registration_identity();

-- Impide duplicar el mismo espejo de liquidación para un técnico y período.
-- Los duplicados históricos exactos se conservan en el registro principal y se
-- elimina solo el espejo repetido más reciente antes de crear la restricción.
DROP TABLE IF EXISTS pg_temp.duplicate_visitas_by_code;
CREATE TEMP TABLE duplicate_visitas_by_code AS
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY codigo_registro, tecnico_id ORDER BY fecha_creacion, id) AS canonical_id,
    row_number() OVER (PARTITION BY codigo_registro, tecnico_id ORDER BY fecha_creacion, id) AS row_number
  FROM public.visitas_tecnicas
  WHERE nullif(btrim(codigo_registro), '') IS NOT NULL
)
SELECT id AS duplicate_id, canonical_id FROM ranked WHERE row_number > 1;

UPDATE public.reportes_actividad ra
SET visita_tecnica_id = duplicate_visitas_by_code.canonical_id
FROM duplicate_visitas_by_code
WHERE ra.visita_tecnica_id = duplicate_visitas_by_code.duplicate_id;

UPDATE public.visita_tecnica_fotos vf
SET visita_tecnica_id = duplicate_visitas_by_code.canonical_id
FROM duplicate_visitas_by_code
WHERE vf.visita_tecnica_id = duplicate_visitas_by_code.duplicate_id;

DELETE FROM public.visitas_tecnicas vt
USING duplicate_visitas_by_code
WHERE vt.id = duplicate_visitas_by_code.duplicate_id;

DROP TABLE IF EXISTS pg_temp.duplicate_recorridos_by_code;
CREATE TEMP TABLE duplicate_recorridos_by_code AS
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY codigo_registro, tecnico_id ORDER BY fecha_creacion, id) AS canonical_id,
    row_number() OVER (PARTITION BY codigo_registro, tecnico_id ORDER BY fecha_creacion, id) AS row_number
  FROM public.recorridos
  WHERE nullif(btrim(codigo_registro), '') IS NOT NULL
)
SELECT id AS duplicate_id, canonical_id FROM ranked WHERE row_number > 1;

UPDATE public.reportes_actividad ra
SET recorrido_id = duplicate_recorridos_by_code.canonical_id
FROM duplicate_recorridos_by_code
WHERE ra.recorrido_id = duplicate_recorridos_by_code.duplicate_id;

DELETE FROM public.recorridos r
USING duplicate_recorridos_by_code
WHERE r.id = duplicate_recorridos_by_code.duplicate_id;

DROP TABLE IF EXISTS pg_temp.duplicate_mantenimientos_by_code;
CREATE TEMP TABLE duplicate_mantenimientos_by_code AS
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY codigo_registro ORDER BY fecha_creacion, id) AS canonical_id,
    row_number() OVER (PARTITION BY codigo_registro ORDER BY fecha_creacion, id) AS row_number
  FROM public.mantenimientos
  WHERE nullif(btrim(codigo_registro), '') IS NOT NULL
)
SELECT id AS duplicate_id, canonical_id FROM ranked WHERE row_number > 1;

UPDATE public.reportes_actividad ra
SET mantenimiento_id = duplicate_mantenimientos_by_code.canonical_id
FROM duplicate_mantenimientos_by_code
WHERE ra.mantenimiento_id = duplicate_mantenimientos_by_code.duplicate_id;

UPDATE public.mantenimiento_fotos mf
SET mantenimiento_id = duplicate_mantenimientos_by_code.canonical_id
FROM duplicate_mantenimientos_by_code
WHERE mf.mantenimiento_id = duplicate_mantenimientos_by_code.duplicate_id;

UPDATE public.reportes_mantenimiento rm
SET mantenimiento_id = duplicate_mantenimientos_by_code.canonical_id
FROM duplicate_mantenimientos_by_code
WHERE rm.mantenimiento_id = duplicate_mantenimientos_by_code.duplicate_id;

-- Evita violar la restriccion unica (maintenance_id, usuario_id) al unir
-- mantenimientos que ya comparten un participante.
DO $$
BEGIN
  IF to_regclass('public.mantenimiento_participantes') IS NOT NULL THEN
    WITH remapped_participants AS (
      SELECT participant.id,
        row_number() OVER (
          PARTITION BY coalesce(duplicate_maintenance.canonical_id, participant.maintenance_id), participant.usuario_id
          ORDER BY participant.fecha_creacion, participant.id
        ) AS row_number
      FROM public.mantenimiento_participantes participant
      LEFT JOIN duplicate_mantenimientos_by_code duplicate_maintenance
        ON participant.maintenance_id = duplicate_maintenance.duplicate_id
      WHERE duplicate_maintenance.canonical_id IS NOT NULL
        OR participant.maintenance_id IN (SELECT canonical_id FROM duplicate_mantenimientos_by_code)
    )
    DELETE FROM public.mantenimiento_participantes participant
    USING remapped_participants duplicate_participant
    WHERE participant.id = duplicate_participant.id
      AND duplicate_participant.row_number > 1;

    UPDATE public.mantenimiento_participantes participant
    SET maintenance_id = duplicate_maintenance.canonical_id
    FROM duplicate_mantenimientos_by_code duplicate_maintenance
    WHERE participant.maintenance_id = duplicate_maintenance.duplicate_id;
  END IF;
END $$;

DELETE FROM public.mantenimientos m
USING duplicate_mantenimientos_by_code
WHERE m.id = duplicate_mantenimientos_by_code.duplicate_id;

DROP TABLE IF EXISTS pg_temp.duplicate_registros_by_code;
CREATE TEMP TABLE duplicate_registros_by_code AS
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY codigo_registro ORDER BY fecha_creacion, id) AS canonical_id,
    row_number() OVER (PARTITION BY codigo_registro ORDER BY fecha_creacion, id) AS row_number
  FROM public.registros_actividades
  WHERE nullif(btrim(codigo_registro), '') IS NOT NULL
)
SELECT id AS duplicate_id, canonical_id FROM ranked WHERE row_number > 1;

-- Evita violar la restriccion unica (registro_actividad_id, tecnico_id) al
-- consolidar registros de actividad duplicados.
WITH remapped_participants AS (
  SELECT participant.id,
    row_number() OVER (
      PARTITION BY coalesce(duplicate_activity.canonical_id, participant.registro_actividad_id), participant.tecnico_id
      ORDER BY participant.fecha_creacion, participant.id
    ) AS row_number
  FROM public.actividad_participantes participant
  LEFT JOIN duplicate_registros_by_code duplicate_activity
    ON participant.registro_actividad_id = duplicate_activity.duplicate_id
  WHERE duplicate_activity.canonical_id IS NOT NULL
    OR participant.registro_actividad_id IN (SELECT canonical_id FROM duplicate_registros_by_code)
)
DELETE FROM public.actividad_participantes participant
USING remapped_participants duplicate_participant
WHERE participant.id = duplicate_participant.id
  AND duplicate_participant.row_number > 1;

UPDATE public.actividad_participantes participant
SET registro_actividad_id = duplicate_activity.canonical_id
FROM duplicate_registros_by_code duplicate_activity
WHERE participant.registro_actividad_id = duplicate_activity.duplicate_id;

DELETE FROM public.registros_actividades ra
USING duplicate_registros_by_code
WHERE ra.id = duplicate_registros_by_code.duplicate_id;

WITH ranked_participants AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY registro_actividad_id, tecnico_id
      ORDER BY fecha_creacion, id
    ) AS row_number
  FROM public.actividad_participantes
)
DELETE FROM public.actividad_participantes ap
USING ranked_participants duplicate_participant
WHERE ap.id = duplicate_participant.id
  AND duplicate_participant.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_actividad_participantes_registro_tecnico
  ON public.actividad_participantes (registro_actividad_id, tecnico_id);

DROP TABLE IF EXISTS pg_temp.duplicate_reportes_by_code;
CREATE TEMP TABLE duplicate_reportes_by_code AS
WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY codigo_registro, tecnico_id, tipo ORDER BY fecha_creacion, id) AS canonical_id,
    row_number() OVER (PARTITION BY codigo_registro, tecnico_id, tipo ORDER BY fecha_creacion, id) AS row_number
  FROM public.reportes_actividad
  WHERE nullif(btrim(codigo_registro), '') IS NOT NULL
)
SELECT id AS duplicate_id, canonical_id FROM ranked WHERE row_number > 1;

-- Si la migracion se reejecuta y el indice por referencia ya existe, primero
-- conserva un solo item por la referencia canonica para evitar un 23505.
WITH remapped_items AS (
  SELECT item.id,
    row_number() OVER (
      PARTITION BY item.tecnico_id, item.periodo_id,
        coalesce(duplicate_report.canonical_id, item.referencia_id)
      ORDER BY item.fecha_creacion NULLS LAST, item.id
    ) AS row_number
  FROM public.items_liquidacion item
  LEFT JOIN duplicate_reportes_by_code duplicate_report
    ON item.referencia_id = duplicate_report.duplicate_id
  WHERE item.referencia_id IS NOT NULL
    AND (
      duplicate_report.canonical_id IS NOT NULL
      OR item.referencia_id IN (SELECT canonical_id FROM duplicate_reportes_by_code)
    )
)
DELETE FROM public.items_liquidacion item
USING remapped_items duplicate_item
WHERE item.id = duplicate_item.id
  AND duplicate_item.row_number > 1;

UPDATE public.items_liquidacion item
SET referencia_id = duplicate_report.canonical_id
FROM duplicate_reportes_by_code duplicate_report
WHERE item.referencia_id = duplicate_report.duplicate_id;

UPDATE public.items_aprobacion ia
SET referencia_id = duplicate_reportes_by_code.canonical_id
FROM duplicate_reportes_by_code
WHERE ia.referencia_id = duplicate_reportes_by_code.duplicate_id;

UPDATE public.reporte_actividad_fotos rf
SET reporte_actividad_id = duplicate_reportes_by_code.canonical_id
FROM duplicate_reportes_by_code
WHERE rf.reporte_actividad_id = duplicate_reportes_by_code.duplicate_id;

DELETE FROM public.reportes_actividad ra
USING duplicate_reportes_by_code
WHERE ra.id = duplicate_reportes_by_code.duplicate_id;

DROP TABLE IF EXISTS pg_temp.duplicate_visitas_by_code;
DROP TABLE IF EXISTS pg_temp.duplicate_recorridos_by_code;
DROP TABLE IF EXISTS pg_temp.duplicate_mantenimientos_by_code;
DROP TABLE IF EXISTS pg_temp.duplicate_registros_by_code;
DROP TABLE IF EXISTS pg_temp.duplicate_reportes_by_code;

WITH ranked_items AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY tecnico_id, periodo_id, referencia_id
      ORDER BY fecha_creacion NULLS LAST, id
    ) AS row_number
  FROM public.items_liquidacion
  WHERE referencia_id IS NOT NULL
)
DELETE FROM public.items_liquidacion item
USING ranked_items duplicate_item
WHERE item.id = duplicate_item.id
  AND duplicate_item.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_liquidacion_reference
  ON public.items_liquidacion (tecnico_id, periodo_id, referencia_id)
  WHERE referencia_id IS NOT NULL;

-- Una misma actividad puede llegar por el UUID del reporte o por el UUID de la
-- entidad origen. El codigo es la identidad comun entre ambos caminos.
WITH ranked_items_by_code AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY tecnico_id, periodo_id, tipo, upper(btrim(codigo_registro))
      ORDER BY fecha_creacion NULLS LAST, id
    ) AS row_number
  FROM public.items_liquidacion
  WHERE nullif(btrim(coalesce(codigo_registro, '')), '') IS NOT NULL
)
DELETE FROM public.items_liquidacion item
USING ranked_items_by_code duplicate_item
WHERE item.id = duplicate_item.id
  AND duplicate_item.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_liquidacion_codigo_tecnico_periodo_tipo
  ON public.items_liquidacion (codigo_registro, tecnico_id, periodo_id, tipo)
  WHERE codigo_registro IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visitas_tecnicas_codigo_tecnico
  ON public.visitas_tecnicas (codigo_registro, tecnico_id)
  WHERE codigo_registro IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mantenimientos_codigo_registro
  ON public.mantenimientos (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recorridos_codigo_registro
  ON public.recorridos (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_actividades_codigo_registro
  ON public.registros_actividades (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reportes_actividad_codigo_tecnico_tipo
  ON public.reportes_actividad (codigo_registro, tecnico_id, tipo)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_registration_registry_type
  ON public.activity_registration_registry (tipo);

CREATE INDEX IF NOT EXISTS idx_visitas_tecnicas_codigo_registro
  ON public.visitas_tecnicas (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_codigo_registro
  ON public.mantenimientos (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recorridos_codigo_registro
  ON public.recorridos (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registros_actividades_codigo_registro
  ON public.registros_actividades (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reportes_actividad_codigo_registro
  ON public.reportes_actividad (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_items_liquidacion_codigo_registro
  ON public.items_liquidacion (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

COMMENT ON COLUMN public.items_liquidacion.codigo_registro IS
  'Código de la actividad origen. Se copia automáticamente desde reportes_actividad.';

COMMENT ON TABLE public.activity_registration_registry IS
  'Registro global de códigos de actividad. Evita reutilizar un código para otra actividad.';

COMMIT;
