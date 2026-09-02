-- Corrige la vigencia de miembros y reportadores para que use la fecha de
-- negocio de Colombia y no la fecha UTC de la sesión de PostgreSQL.
-- Es idempotente y puede ejecutarse tanto en una BD nueva como en V2.

BEGIN;

ALTER TABLE public.grupo_miembros
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date;

ALTER TABLE public.grupo_reportadores_actividad
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date;

-- Las filas afectadas por el bug se crearon con CURRENT_DATE (UTC) durante
-- una jornada que todavía era el día anterior en Bogotá. Solo se corrige ese
-- patrón inequívoco; no se alteran fechas futuras introducidas manualmente.
UPDATE public.grupo_miembros
   SET fecha_inicio = (created_at AT TIME ZONE 'America/Bogota')::date
 WHERE created_at IS NOT NULL
   AND fecha_inicio = (created_at AT TIME ZONE 'UTC')::date
   AND fecha_inicio > (created_at AT TIME ZONE 'America/Bogota')::date;

UPDATE public.grupo_reportadores_actividad
   SET fecha_inicio = (created_at AT TIME ZONE 'America/Bogota')::date
 WHERE created_at IS NOT NULL
   AND fecha_inicio = (created_at AT TIME ZONE 'UTC')::date
   AND fecha_inicio > (created_at AT TIME ZONE 'America/Bogota')::date;

ALTER TABLE public.grupo_miembros
  ALTER COLUMN fecha_inicio SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  ALTER COLUMN fecha_inicio SET NOT NULL;

ALTER TABLE public.grupo_reportadores_actividad
  ALTER COLUMN fecha_inicio SET DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  ALTER COLUMN fecha_inicio SET NOT NULL;

CREATE OR REPLACE FUNCTION public.usuario_puede_reportar_grupo(
  p_usuario_id uuid,
  p_grupo_id uuid,
  p_fecha date DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date)
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
     WHERE u.id = p_usuario_id
       AND u.estado = 'activo'
       AND (
         u.rol IN ('admin', 'supervisor')
         OR EXISTS (
           SELECT 1
             FROM public.grupos_trabajo g
            WHERE g.id = p_grupo_id
              AND g.lider_id = p_usuario_id
              AND COALESCE(g.estado, 'activo') = 'activo'
         )
         OR EXISTS (
           SELECT 1
             FROM public.grupo_miembros gm
            WHERE gm.grupo_id = p_grupo_id
              AND gm.usuario_id = p_usuario_id
              AND gm.fecha_inicio <= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date)
              AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date))
              AND (
                NOT EXISTS (
                  SELECT 1
                    FROM public.grupo_reportadores_actividad gra
                   WHERE gra.grupo_id = p_grupo_id
                     AND gra.fecha_inicio <= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date)
                     AND (gra.fecha_fin IS NULL OR gra.fecha_fin >= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date))
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.grupo_reportadores_actividad gra
                   WHERE gra.grupo_id = p_grupo_id
                     AND gra.usuario_id = p_usuario_id
                     AND gra.fecha_inicio <= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date)
                     AND (gra.fecha_fin IS NULL OR gra.fecha_fin >= COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date))
                )
              )
         )
       )
  );
$$;

COMMIT;
