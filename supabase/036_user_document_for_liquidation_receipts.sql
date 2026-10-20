-- Documento de identidad para el comprobante individual de liquidación.
-- Aditiva: los usuarios existentes pueden completar el dato desde el administrador.
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS cedula text;

COMMENT ON COLUMN public.usuarios.cedula IS
  'Número de cédula/documento del trabajador; dato usado en comprobantes de liquidación.';
