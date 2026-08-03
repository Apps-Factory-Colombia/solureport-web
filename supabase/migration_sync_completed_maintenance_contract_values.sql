-- Keeps the executable maintenance and its contractual installment in sync.
-- Existing positive charged values are preserved because they may have been edited manually.

CREATE OR REPLACE FUNCTION public.sync_completed_maintenance_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contrato_mantenimiento_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.estado, '')) IN ('realizado', 'completado') THEN
    UPDATE public.contrato_mantenimientos cm
    SET tecnico_id = COALESCE(NEW.tecnico_id, cm.tecnico_id),
        fecha_programada = COALESCE(NEW.fecha_programada, cm.fecha_programada),
        fecha_realizado = COALESCE(NEW.fecha_cierre::date, NEW.fecha_programada::date, CURRENT_DATE),
        estado = 'realizado',
        costo_tecnico_total = GREATEST(0, ROUND(COALESCE(NEW.costo_tecnico_total, 0))),
        valor_recaudado = CASE
          WHEN COALESCE(cm.valor_recaudado, 0) > 0 THEN cm.valor_recaudado
          ELSE COALESCE(c.costo_por_mantenimiento, 0)
        END
    FROM public.contratos_mantenimiento c
    WHERE cm.id = NEW.contrato_mantenimiento_id
      AND c.id = cm.contrato_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_completed_maintenance_contract ON public.mantenimientos;
CREATE TRIGGER trg_sync_completed_maintenance_contract
AFTER INSERT OR UPDATE OF estado, fecha_cierre, fecha_programada, tecnico_id, costo_tecnico_total, contrato_mantenimiento_id
ON public.mantenimientos
FOR EACH ROW
EXECUTE FUNCTION public.sync_completed_maintenance_contract();

UPDATE public.contrato_mantenimientos cm
SET tecnico_id = COALESCE(m.tecnico_id, cm.tecnico_id),
    fecha_programada = COALESCE(m.fecha_programada, cm.fecha_programada),
    fecha_realizado = COALESCE(m.fecha_cierre::date, m.fecha_programada::date, CURRENT_DATE),
    estado = 'realizado',
    costo_tecnico_total = GREATEST(0, ROUND(COALESCE(m.costo_tecnico_total, 0))),
    valor_recaudado = CASE
      WHEN COALESCE(cm.valor_recaudado, 0) > 0 THEN cm.valor_recaudado
      ELSE COALESCE(c.costo_por_mantenimiento, 0)
    END
FROM public.mantenimientos m,
     public.contratos_mantenimiento c
WHERE m.contrato_mantenimiento_id = cm.id
  AND c.id = cm.contrato_id
  AND LOWER(COALESCE(m.estado, '')) IN ('realizado', 'completado');

UPDATE public.contrato_mantenimientos cm
SET valor_recaudado = c.costo_por_mantenimiento
FROM public.contratos_mantenimiento c
WHERE c.id = cm.contrato_id
  AND cm.estado = 'realizado'
  AND COALESCE(cm.valor_recaudado, 0) = 0
  AND COALESCE(c.costo_por_mantenimiento, 0) > 0;
