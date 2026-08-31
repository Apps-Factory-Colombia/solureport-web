-- Corrección del trigger diferido de huella semántica.
-- El evento de la tabla principal usa NEW.id; las tablas hijas usan
-- NEW/OLD.actividad_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_huella_semantica_actividad_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actividad_id uuid;
  v_tipo text;
  v_cliente_id uuid;
  v_sede_id uuid;
  v_grupo_id uuid;
  v_fecha date;
  v_descripcion text;
  v_observaciones text;
  v_catalogo_id uuid;
  v_especificacion text;
  v_mantenimiento_id uuid;
  v_mantenimiento_titulo text;
  v_mantenimiento_tipo text;
  v_mantenimiento_descripcion text;
  v_visita_tipo text;
  v_receptor_nombre text;
  v_receptor_cedula text;
  v_receptor_cargo text;
  v_partida text;
  v_llegada text;
  v_recorrido_tipo text;
  v_participantes jsonb;
  v_huella text;
BEGIN
  IF TG_TABLE_NAME = 'actividades_operativas' THEN
    v_actividad_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_actividad_id := OLD.actividad_id;
  ELSE
    v_actividad_id := NEW.actividad_id;
  END IF;

  SELECT
    a.tipo, a.cliente_id, a.sede_id, a.grupo_id, a.fecha_operacion,
    a.descripcion, a.observaciones
  INTO
    v_tipo, v_cliente_id, v_sede_id, v_grupo_id, v_fecha,
    v_descripcion, v_observaciones
  FROM public.actividades_operativas a
  WHERE a.id = v_actividad_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT c.catalogo_actividad_id, c.especificacion
  INTO v_catalogo_id, v_especificacion
  FROM public.actividades_operativas_catalogo c
  WHERE c.actividad_id = v_actividad_id
  ORDER BY c.catalogo_actividad_id, c.especificacion
  LIMIT 1;

  SELECT m.mantenimiento_programado_id, m.titulo, m.tipo_pendiente,
         m.descripcion_pendiente
  INTO v_mantenimiento_id, v_mantenimiento_titulo, v_mantenimiento_tipo,
       v_mantenimiento_descripcion
  FROM public.actividades_operativas_mantenimientos m
  WHERE m.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT v.tipo_visita, v.receptor_nombre, v.receptor_cedula, v.receptor_cargo
  INTO v_visita_tipo, v_receptor_nombre, v_receptor_cedula, v_receptor_cargo
  FROM public.actividades_operativas_visitas v
  WHERE v.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT r.punto_partida, r.punto_llegada, r.tipo_recorrido
  INTO v_partida, v_llegada, v_recorrido_tipo
  FROM public.actividades_operativas_recorridos r
  WHERE r.actividad_id = v_actividad_id
  LIMIT 1;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('tecnico_id', p1.tecnico_id::text)
              ORDER BY p1.tecnico_id::text),
    '[]'::jsonb
  )
  INTO v_participantes
  FROM (
    SELECT DISTINCT p2.tecnico_id
    FROM public.actividades_operativas_participantes p2
    WHERE p2.actividad_id = v_actividad_id
  ) p1;

  v_huella := public.calcular_huella_semantica_actividad(
    v_tipo, v_cliente_id, v_sede_id, v_grupo_id, v_fecha,
    v_descripcion, v_observaciones,
    v_catalogo_id, v_especificacion,
    v_mantenimiento_id, v_mantenimiento_titulo, v_mantenimiento_tipo,
    v_mantenimiento_descripcion,
    v_visita_tipo, v_receptor_nombre, v_receptor_cedula, v_receptor_cargo,
    v_partida, v_llegada, v_recorrido_tipo, v_participantes
  );

  UPDATE public.actividades_operativas
  SET huella_semantica = v_huella,
      updated_at = clock_timestamp()
  WHERE id = v_actividad_id
    AND huella_semantica IS DISTINCT FROM v_huella;

  RETURN NULL;
END;
$$;

COMMIT;

