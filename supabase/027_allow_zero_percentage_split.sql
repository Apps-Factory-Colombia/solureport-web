-- Permite que administración distribuya una actividad compartida como
-- 100% para un técnico y 0% para otro, sin duplicar el mantenimiento.
-- El porcentaje cero mantiene al técnico visible, pero sin valor de pago.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

ALTER TABLE public.mantenimientos_programados_participantes
  DROP CONSTRAINT IF EXISTS mantenimientos_programados_participantes_porcentaje_check;
ALTER TABLE public.mantenimientos_programados_participantes
  ADD CONSTRAINT mantenimientos_programados_participantes_porcentaje_check
  CHECK (porcentaje >= 0 AND porcentaje <= 100);

ALTER TABLE public.actividades_operativas_participantes
  DROP CONSTRAINT IF EXISTS actividades_operativas_participantes_porcentaje_check;
ALTER TABLE public.actividades_operativas_participantes
  ADD CONSTRAINT actividades_operativas_participantes_porcentaje_check
  CHECK (porcentaje >= 0 AND porcentaje <= 100);

ALTER TABLE public.liquidacion_items
  DROP CONSTRAINT IF EXISTS liquidacion_items_porcentaje_check;
ALTER TABLE public.liquidacion_items
  ADD CONSTRAINT liquidacion_items_porcentaje_check
  CHECK (porcentaje >= 0 AND porcentaje <= 100);

COMMENT ON CONSTRAINT actividades_operativas_participantes_porcentaje_check
  ON public.actividades_operativas_participantes IS
  'Permite 0% para un participante sin pago, manteniendo la entrega independiente en la actividad compartida.';

COMMENT ON CONSTRAINT mantenimientos_programados_participantes_porcentaje_check
  ON public.mantenimientos_programados_participantes IS
  'Permite 0% para un técnico asignado cuando administración distribuye todo el valor a otro participante.';

COMMENT ON CONSTRAINT liquidacion_items_porcentaje_check
  ON public.liquidacion_items IS
  'Permite conservar un item de liquidación con 0% y valor cero para un participante sin pago.';

COMMIT;
