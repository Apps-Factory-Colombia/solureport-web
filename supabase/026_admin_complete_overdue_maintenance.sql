-- Permite que un administrador cierre manualmente un mantenimiento vencido
-- cuando el trabajo sí fue realizado pero la entrega operativa quedó
-- pendiente o incompleta. No modifica el contrato ni elimina las entregas
-- independientes de los técnicos.
BEGIN;

ALTER TABLE public.mantenimientos_programados
  ADD COLUMN IF NOT EXISTS admin_completado_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_completado_por_id uuid;

CREATE INDEX IF NOT EXISTS idx_mantenimientos_programados_admin_completado
  ON public.mantenimientos_programados (admin_completado_at)
  WHERE admin_completado_at IS NOT NULL;

COMMENT ON COLUMN public.mantenimientos_programados.admin_completado_at IS
  'Fecha y hora en que un administrador confirmó manualmente que el mantenimiento fue realizado.';
COMMENT ON COLUMN public.mantenimientos_programados.admin_completado_por_id IS
  'Usuario administrador que confirmó manualmente el mantenimiento.';

COMMIT;
