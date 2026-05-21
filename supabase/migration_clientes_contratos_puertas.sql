-- MIGRACION: mover configuracion de puertas al contrato y agregar NIT/Cedula al cliente

BEGIN;

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS nit_cedula character varying;

ALTER TABLE public.contratos_mantenimiento
  ADD COLUMN IF NOT EXISTS puertas_peatonales integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS puertas_vehiculares integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_puerta_peatonal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_puerta_vehicular numeric NOT NULL DEFAULT 0;

-- Conserva datos existentes copiando las cantidades historicas del cliente al contrato.
UPDATE public.contratos_mantenimiento AS contrato
SET
  puertas_peatonales = COALESCE(cliente.puertas_peatonales, 0),
  puertas_vehiculares = COALESCE(cliente.puertas_vehiculares, 0)
FROM public.clientes AS cliente
WHERE cliente.id = contrato.cliente_id
  AND COALESCE(contrato.puertas_peatonales, 0) = 0
  AND COALESCE(contrato.puertas_vehiculares, 0) = 0;

COMMIT;
