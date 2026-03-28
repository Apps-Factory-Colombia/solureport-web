ALTER TABLE public.visitas_tecnicas
ADD COLUMN IF NOT EXISTS costo_cliente numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.visitas_tecnicas.costo_cliente IS 'Costo cliente definido manualmente por administracion para cada visita tecnica.';