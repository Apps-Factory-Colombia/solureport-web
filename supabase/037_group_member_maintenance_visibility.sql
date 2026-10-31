-- Mantiene la visibilidad y el permiso de reporte de los mantenimientos
-- programados alineados con la membresía vigente del grupo.
-- No crea actividades ni modifica asignaciones históricas.

CREATE OR REPLACE FUNCTION public.usuario_puede_reportar_mantenimiento(
  p_usuario_id uuid,
  p_mantenimiento_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
      JOIN public.mantenimientos_programados m ON m.id = p_mantenimiento_id
      LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
     WHERE u.id = p_usuario_id
       AND u.estado = 'activo'
       AND (
         u.rol IN ('admin', 'supervisor')
         OR g.lider_id = p_usuario_id
         OR EXISTS (
           SELECT 1
             FROM public.grupo_miembros gm
            WHERE gm.grupo_id = m.grupo_id
              AND gm.usuario_id = p_usuario_id
              AND gm.fecha_inicio <= (now() AT TIME ZONE 'America/Bogota')::date
              AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= (now() AT TIME ZONE 'America/Bogota')::date)
         )
         OR EXISTS (
           SELECT 1
             FROM public.mantenimientos_programados_participantes mp
            WHERE mp.mantenimiento_id = m.id
              AND mp.usuario_id = p_usuario_id
              AND mp.estado = 'activo'
         )
         OR (
           m.tecnico_principal_id = p_usuario_id
           AND NOT EXISTS (
             SELECT 1
               FROM public.mantenimientos_programados_participantes mp
              WHERE mp.mantenimiento_id = m.id
                AND mp.estado = 'activo'
           )
         )
       )
  );
$function$;
