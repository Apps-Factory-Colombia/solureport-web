-- Asistencia V3: historial diario, reglas versionables, memorandos y trazabilidad.
-- Esta migración es idempotente y no elimina información existente.

BEGIN;

ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS minutos_gracia_tardanza integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS minutos_corte_no_reportado integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS minutos_no_reportado integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS porcentaje_descuento_reposicion numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memorando_asistencia_automatico boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS fundamento_asistencia text,
  ADD COLUMN IF NOT EXISTS regimen_sancionatorio_asistencia text;

ALTER TABLE public.registros_asistencia
  ADD COLUMN IF NOT EXISTS categoria_llegada text,
  ADD COLUMN IF NOT EXISTS minutos_adeudados integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regla_id uuid,
  ADD COLUMN IF NOT EXISTS regla_version text,
  ADD COLUMN IF NOT EXISTS porcentaje_regla_aplicada numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tipo_descuento text,
  ADD COLUMN IF NOT EXISTS calculado_en timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_ajuste text,
  ADD COLUMN IF NOT EXISTS ajustado_por_id uuid,
  ADD COLUMN IF NOT EXISTS ajustado_en timestamptz;

CREATE TABLE IF NOT EXISTS public.asistencia_reglas (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  tipo_evento text NOT NULL,
  porcentaje_descuento numeric NOT NULL DEFAULT 0 CHECK (porcentaje_descuento BETWEEN 0 AND 100),
  minutos_adeudados integer NOT NULL DEFAULT 0 CHECK (minutos_adeudados >= 0),
  genera_memorando boolean NOT NULL DEFAULT false,
  tipo_memorando text,
  vigente_desde date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Bogota')::date,
  vigente_hasta date,
  version integer NOT NULL DEFAULT 1,
  activo boolean NOT NULL DEFAULT true,
  creado_por_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'registros_asistencia_regla_id_fkey'
  ) THEN
    ALTER TABLE public.registros_asistencia
      ADD CONSTRAINT registros_asistencia_regla_id_fkey
      FOREIGN KEY (regla_id) REFERENCES public.asistencia_reglas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.asistencia_memorandos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  periodo_id uuid REFERENCES public.periodos_liquidacion(id) ON DELETE SET NULL,
  numero text NOT NULL UNIQUE,
  tipo text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','generado','por_firmar','firmado','anulado')),
  titulo text NOT NULL,
  narrativa text,
  fundamento text,
  regimen_sancionatorio text,
  plantilla_version text NOT NULL DEFAULT 'asistencia-v1',
  pdf_url text,
  firma_trabajador_nombre text,
  firma_trabajador_documento text,
  firmado_en timestamptz,
  generado_por_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  generado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  anulado_en timestamptz,
  motivo_anulacion text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.asistencia_memorando_eventos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  memorando_id uuid NOT NULL REFERENCES public.asistencia_memorandos(id) ON DELETE CASCADE,
  asistencia_id uuid REFERENCES public.registros_asistencia(id) ON DELETE SET NULL,
  orden integer NOT NULL DEFAULT 0,
  fecha_snapshot date NOT NULL,
  hora_programada_snapshot time,
  hora_llegada_snapshot time,
  minutos_snapshot integer NOT NULL DEFAULT 0,
  minutos_adeudados_snapshot integer NOT NULL DEFAULT 0,
  estado_snapshot text,
  categoria_snapshot text,
  porcentaje_snapshot numeric NOT NULL DEFAULT 0,
  foto_url_snapshot text,
  ubicacion_snapshot text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (memorando_id, asistencia_id)
);

CREATE TABLE IF NOT EXISTS public.asistencia_descuentos (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asistencia_id uuid NOT NULL REFERENCES public.registros_asistencia(id) ON DELETE CASCADE,
  periodo_id uuid NOT NULL REFERENCES public.periodos_liquidacion(id) ON DELETE CASCADE,
  tecnico_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  porcentaje numeric NOT NULL DEFAULT 0,
  porcentaje_acumulado numeric NOT NULL DEFAULT 0,
  minutos_adeudados integer NOT NULL DEFAULT 0,
  valor numeric NOT NULL DEFAULT 0,
  regla_version text,
  aplicado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (asistencia_id, periodo_id)
);

ALTER TABLE public.asistencia_descuentos
  ADD COLUMN IF NOT EXISTS porcentaje_acumulado numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minutos_adeudados integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regla_version text,
  ADD COLUMN IF NOT EXISTS aplicado_en timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE UNIQUE INDEX IF NOT EXISTS asistencia_memorandos_usuario_periodo_tipo_uidx
  ON public.asistencia_memorandos (usuario_id, periodo_id, tipo)
  WHERE periodo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS registros_asistencia_fecha_idx
  ON public.registros_asistencia (fecha DESC, usuario_id);

CREATE INDEX IF NOT EXISTS registros_asistencia_estado_fecha_idx
  ON public.registros_asistencia (estado_entrada, fecha DESC);

CREATE INDEX IF NOT EXISTS asistencia_memorandos_periodo_idx
  ON public.asistencia_memorandos (periodo_id, generado_en DESC);

CREATE INDEX IF NOT EXISTS asistencia_memorandos_usuario_idx
  ON public.asistencia_memorandos (usuario_id, generado_en DESC);

CREATE INDEX IF NOT EXISTS asistencia_memorando_eventos_asistencia_idx
  ON public.asistencia_memorando_eventos (asistencia_id);

CREATE INDEX IF NOT EXISTS asistencia_descuentos_periodo_tecnico_idx
  ON public.asistencia_descuentos (periodo_id, tecnico_id);

INSERT INTO public.asistencia_reglas
  (codigo, nombre, tipo_evento, porcentaje_descuento, minutos_adeudados, genera_memorando, tipo_memorando)
VALUES
  ('a_tiempo', 'Ingreso dentro de la tolerancia', 'a_tiempo', 0, 0, false, NULL),
  ('tardanza_leve', 'Retardo leve reportado', 'tardanza_leve', 5, 0, true, 'impuntualidad'),
  ('reposicion', 'Llegada fuera del corte con reporte', 'reposicion', 0, 0, true, 'reposicion'),
  ('no_reportado', 'Omisión de registro de entrada', 'no_reportado', 30, 30, true, 'omision_marcacion')
ON CONFLICT (codigo) DO NOTHING;

UPDATE public.registros_asistencia AS r
   SET categoria_llegada = CASE
         WHEN r.estado_entrada = 'no_reportado' THEN 'no_reportado'
         WHEN r.estado_entrada = 'tarde' AND r.hora_entrada_real IS NOT NULL THEN 'tardanza_leve'
         ELSE 'a_tiempo'
       END,
       minutos_adeudados = CASE
         WHEN r.estado_entrada = 'no_reportado' THEN 30
         WHEN r.hora_entrada_real IS NULL OR r.hora_entrada_real <= r.hora_entrada_programada THEN 0
         ELSE GREATEST(0, EXTRACT(EPOCH FROM (r.hora_entrada_real - r.hora_entrada_programada))::integer / 60)
       END,
       porcentaje_regla_aplicada = COALESCE(r.porcentaje_descuento, 0),
       regla_version = COALESCE(r.regla_version, 'legacy'),
       calculado_en = COALESCE(r.calculado_en, clock_timestamp())
 WHERE r.categoria_llegada IS NULL;

-- Reconciliación inicial: las tardanzas existentes también deben verse en la
-- liquidación abierta. No se modifican periodos cerrados ni recorridos.
WITH totals AS (
  SELECT a.usuario_id, p.id AS periodo_id,
         LEAST(100, GREATEST(0, SUM(CASE WHEN a.descuento_aplicado THEN COALESCE(a.porcentaje_descuento, 0) ELSE 0 END))) AS porcentaje
    FROM public.registros_asistencia a
    JOIN public.periodos_liquidacion p
      ON a.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
   WHERE p.estado = 'abierto'
   GROUP BY a.usuario_id, p.id
)
UPDATE public.liquidacion_items AS li
   SET descuento_tardanza = ROUND(COALESCE(li.valor_ganado_original, li.valor_ganado) * totals.porcentaje / 100, 2),
       valor_ganado = ROUND(COALESCE(li.valor_ganado_original, li.valor_ganado) * (1 - totals.porcentaje / 100), 2),
       porcentaje_descuento_tardanza = totals.porcentaje,
       updated_at = clock_timestamp()
  FROM totals
 WHERE li.tecnico_id = totals.usuario_id
   AND li.periodo_id = totals.periodo_id
   AND li.tipo <> 'recorrido'
   AND li.estado <> 'anulado';

WITH event_totals AS (
  SELECT a.usuario_id, p.id AS periodo_id,
         SUM(CASE WHEN a.descuento_aplicado THEN COALESCE(a.porcentaje_descuento, 0) ELSE 0 END) AS bruto,
         LEAST(100, GREATEST(0, SUM(CASE WHEN a.descuento_aplicado THEN COALESCE(a.porcentaje_descuento, 0) ELSE 0 END))) AS acumulado
    FROM public.registros_asistencia a
    JOIN public.periodos_liquidacion p
      ON a.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
   WHERE p.estado = 'abierto'
   GROUP BY a.usuario_id, p.id
), liquid_totals AS (
  SELECT tecnico_id, periodo_id, COALESCE(SUM(descuento_tardanza), 0) AS valor
    FROM public.liquidacion_items
   WHERE tipo <> 'recorrido' AND estado <> 'anulado'
   GROUP BY tecnico_id, periodo_id
)
INSERT INTO public.asistencia_descuentos
  (asistencia_id, periodo_id, tecnico_id, porcentaje, porcentaje_acumulado, minutos_adeudados, valor, regla_version)
SELECT a.id, et.periodo_id, a.usuario_id, COALESCE(a.porcentaje_descuento, 0), et.acumulado,
       COALESCE(a.minutos_adeudados, a.minutos_retraso, 0),
       CASE WHEN et.bruto > 0 THEN ROUND(COALESCE(lt.valor, 0) * COALESCE(a.porcentaje_descuento, 0) / et.bruto, 2) ELSE 0 END,
       COALESCE(a.regla_version, 'attendance-v3')
  FROM public.registros_asistencia a
  JOIN public.periodos_liquidacion p
    ON a.fecha BETWEEN p.fecha_inicio AND p.fecha_fin
  JOIN event_totals et ON et.usuario_id = a.usuario_id AND et.periodo_id = p.id
  LEFT JOIN liquid_totals lt ON lt.tecnico_id = a.usuario_id AND lt.periodo_id = p.id
 WHERE p.estado = 'abierto'
   AND a.descuento_aplicado = true
   AND COALESCE(a.porcentaje_descuento, 0) > 0
ON CONFLICT (asistencia_id, periodo_id) DO UPDATE SET
  porcentaje = EXCLUDED.porcentaje,
  porcentaje_acumulado = EXCLUDED.porcentaje_acumulado,
  minutos_adeudados = EXCLUDED.minutos_adeudados,
  valor = EXCLUDED.valor,
  regla_version = EXCLUDED.regla_version,
  aplicado_en = clock_timestamp();

COMMIT;
