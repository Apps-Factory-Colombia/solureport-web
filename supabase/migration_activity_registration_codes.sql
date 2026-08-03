-- Agrega un codigo de registro unico por actividad para evitar mezclas
-- entre visitas, recorridos, mantenimientos y sus espejos en reportes_actividad.
-- Tambien deja en 0 todas las visitas tecnicas de tipo entregas.
--
-- Compatibilidad:
-- - no agrega NOT NULL a las columnas nuevas
-- - no cambia claves primarias ni unicos existentes
-- - no obliga a la app movil o a la web a enviar codigo_registro
-- - si un reporte historico o nuevo no puede enlazarse de forma confiable con su
--   entidad origen, el codigo_registro puede quedar NULL y el frontend conserva
--   el fallback legacy actual para no romper agrupaciones ni vistas existentes

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
  ADD COLUMN IF NOT EXISTS tipo_visita character varying;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'reportes_actividad'
      AND constraint_name = 'reportes_actividad_visita_tecnica_id_fkey'
  ) THEN
    ALTER TABLE public.reportes_actividad
      ADD CONSTRAINT reportes_actividad_visita_tecnica_id_fkey
      FOREIGN KEY (visita_tecnica_id) REFERENCES public.visitas_tecnicas(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'reportes_actividad'
      AND constraint_name = 'reportes_actividad_recorrido_id_fkey'
  ) THEN
    ALTER TABLE public.reportes_actividad
      ADD CONSTRAINT reportes_actividad_recorrido_id_fkey
      FOREIGN KEY (recorrido_id) REFERENCES public.recorridos(id) ON DELETE SET NULL;
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS idx_reportes_actividad_visita_tecnica_id
  ON public.reportes_actividad (visita_tecnica_id)
  WHERE visita_tecnica_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reportes_actividad_recorrido_id
  ON public.reportes_actividad (recorrido_id)
  WHERE recorrido_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_activity_registration_code(prefix text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN upper(prefix)
    || '-'
    || to_char(now(), 'YYYYMMDD')
    || '-'
    || substr(replace(uuid_generate_v4()::text, '-', ''), 1, 8);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_visita_tecnica_registration_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
    NEW.codigo_registro := public.generate_activity_registration_code('VT');
  END IF;

  IF lower(coalesce(NEW.tipo_visita, '')) = 'entregas' THEN
    NEW.costo_visita_tecnica_default := 0;
    NEW.valor_cobrado_cliente := 0;
    NEW.valor_modificado := false;
    NEW.motivo_modificacion_valor := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_mantenimiento_registration_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
    NEW.codigo_registro := public.generate_activity_registration_code('MP');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_recorrido_registration_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
    NEW.codigo_registro := public.generate_activity_registration_code('RC');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_reporte_actividad_registration_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_code text;
  source_tipo_visita text;
BEGIN
  IF NEW.tipo = 'visita_tecnica' AND NEW.visita_tecnica_id IS NOT NULL THEN
    SELECT codigo_registro, tipo_visita
    INTO source_code, source_tipo_visita
    FROM public.visitas_tecnicas
    WHERE id = NEW.visita_tecnica_id;

    IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
      NEW.codigo_registro := source_code;
    END IF;

    IF nullif(btrim(coalesce(NEW.tipo_visita, '')), '') IS NULL THEN
      NEW.tipo_visita := source_tipo_visita;
    END IF;
  ELSIF NEW.tipo = 'mantenimiento_preventivo' AND NEW.mantenimiento_id IS NOT NULL THEN
    SELECT codigo_registro
    INTO source_code
    FROM public.mantenimientos
    WHERE id = NEW.mantenimiento_id;

    IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
      NEW.codigo_registro := source_code;
    END IF;
  ELSIF NEW.tipo = 'recorrido' AND NEW.recorrido_id IS NOT NULL THEN
    SELECT codigo_registro
    INTO source_code
    FROM public.recorridos
    WHERE id = NEW.recorrido_id;

    IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
      NEW.codigo_registro := source_code;
    END IF;
  END IF;

  IF NEW.tipo = 'visita_tecnica' AND lower(coalesce(NEW.tipo_visita, '')) = 'entregas' THEN
    NEW.costo_actividad_default := 0;
    NEW.costo_actividad := 0;
    NEW.valor_modificado := false;
    NEW.motivo_modificacion_valor := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_registro_actividad_registration_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF nullif(btrim(coalesce(NEW.codigo_registro, '')), '') IS NULL THEN
    NEW.codigo_registro := public.generate_activity_registration_code('AG');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visitas_tecnicas_registration_defaults ON public.visitas_tecnicas;
CREATE TRIGGER trg_visitas_tecnicas_registration_defaults
BEFORE INSERT OR UPDATE OF tipo_visita, costo_visita_tecnica_default, valor_cobrado_cliente, codigo_registro
ON public.visitas_tecnicas
FOR EACH ROW
EXECUTE FUNCTION public.ensure_visita_tecnica_registration_defaults();

DROP TRIGGER IF EXISTS trg_mantenimientos_registration_defaults ON public.mantenimientos;
CREATE TRIGGER trg_mantenimientos_registration_defaults
BEFORE INSERT OR UPDATE OF codigo_registro
ON public.mantenimientos
FOR EACH ROW
EXECUTE FUNCTION public.ensure_mantenimiento_registration_defaults();

DROP TRIGGER IF EXISTS trg_recorridos_registration_defaults ON public.recorridos;
CREATE TRIGGER trg_recorridos_registration_defaults
BEFORE INSERT OR UPDATE OF codigo_registro
ON public.recorridos
FOR EACH ROW
EXECUTE FUNCTION public.ensure_recorrido_registration_defaults();

DROP TRIGGER IF EXISTS trg_reportes_actividad_registration_defaults ON public.reportes_actividad;
CREATE TRIGGER trg_reportes_actividad_registration_defaults
BEFORE INSERT OR UPDATE OF tipo, codigo_registro, visita_tecnica_id, recorrido_id, mantenimiento_id, tipo_visita, costo_actividad_default, costo_actividad
ON public.reportes_actividad
FOR EACH ROW
EXECUTE FUNCTION public.ensure_reporte_actividad_registration_defaults();

DROP TRIGGER IF EXISTS trg_registros_actividades_registration_defaults ON public.registros_actividades;
CREATE TRIGGER trg_registros_actividades_registration_defaults
BEFORE INSERT OR UPDATE OF codigo_registro
ON public.registros_actividades
FOR EACH ROW
EXECUTE FUNCTION public.ensure_registro_actividad_registration_defaults();

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

UPDATE public.visitas_tecnicas
SET costo_visita_tecnica_default = 0,
    valor_cobrado_cliente = 0,
    valor_modificado = false,
    motivo_modificacion_valor = NULL
WHERE lower(coalesce(tipo_visita, '')) = 'entregas';

WITH matched_visits AS (
  SELECT
    ra.id AS report_id,
    (array_agg(vt.id ORDER BY vt.id))[1] AS visit_id,
    min(vt.codigo_registro) AS codigo_registro,
    min(vt.tipo_visita) AS tipo_visita
  FROM public.reportes_actividad ra
  INNER JOIN public.visitas_tecnicas vt
    ON ra.tipo = 'visita_tecnica'
   AND ra.tecnico_id = vt.tecnico_id
   AND ra.fecha = vt.fecha_inicio::date
   AND coalesce(ra.cliente_id::text, '') = coalesce(vt.cliente_id::text, '')
   AND coalesce(btrim(ra.descripcion), '') = coalesce(btrim(vt.descripcion), '')
  GROUP BY ra.id
  HAVING count(*) = 1
)
UPDATE public.reportes_actividad ra
SET visita_tecnica_id = mv.visit_id,
    tipo_visita = mv.tipo_visita,
    codigo_registro = coalesce(ra.codigo_registro, mv.codigo_registro)
FROM matched_visits mv
WHERE ra.id = mv.report_id;

WITH matched_recorridos AS (
  SELECT
    ra.id AS report_id,
    (array_agg(r.id ORDER BY r.id))[1] AS recorrido_id,
    min(r.codigo_registro) AS codigo_registro
  FROM public.reportes_actividad ra
  INNER JOIN public.recorridos r
    ON ra.tipo = 'recorrido'
   AND ra.tecnico_id = r.tecnico_id
   AND ra.fecha = r.fecha
   AND coalesce(ra.punto_partida, '') = coalesce(r.punto_partida, '')
   AND coalesce(ra.punto_llegada, '') = coalesce(r.punto_llegada, '')
   AND coalesce(ra.tipo_recorrido, '') = coalesce(r.tipo_recorrido, '')
  GROUP BY ra.id
  HAVING count(*) = 1
)
UPDATE public.reportes_actividad ra
SET recorrido_id = mr.recorrido_id,
    codigo_registro = coalesce(ra.codigo_registro, mr.codigo_registro)
FROM matched_recorridos mr
WHERE ra.id = mr.report_id;

UPDATE public.reportes_actividad ra
SET codigo_registro = m.codigo_registro
FROM public.mantenimientos m
WHERE ra.tipo = 'mantenimiento_preventivo'
  AND ra.mantenimiento_id = m.id
  AND nullif(btrim(coalesce(ra.codigo_registro, '')), '') IS NULL;

UPDATE public.reportes_actividad ra
SET costo_actividad_default = 0,
    costo_actividad = 0,
    valor_modificado = false,
    motivo_modificacion_valor = NULL,
    tipo_visita = 'entregas'
FROM public.visitas_tecnicas vt
WHERE ra.tipo = 'visita_tecnica'
  AND (
    ra.visita_tecnica_id = vt.id
    OR (
      ra.visita_tecnica_id IS NULL
      AND ra.tecnico_id = vt.tecnico_id
      AND ra.fecha = vt.fecha_inicio::date
      AND coalesce(ra.cliente_id::text, '') = coalesce(vt.cliente_id::text, '')
      AND coalesce(btrim(ra.descripcion), '') = coalesce(btrim(vt.descripcion), '')
    )
  )
  AND lower(coalesce(vt.tipo_visita, '')) = 'entregas';

UPDATE public.items_aprobacion ia
SET valor = 0
FROM public.visitas_tecnicas vt
WHERE ia.tipo = 'visita_tecnica'
  AND ia.referencia_id = vt.id
  AND lower(coalesce(vt.tipo_visita, '')) = 'entregas';
