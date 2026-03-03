-- ============================================================
-- MIGRACIÓN: Agregar mes_inicio y dia_inicio a contratos_mantenimiento
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

ALTER TABLE contratos_mantenimiento
  ADD COLUMN IF NOT EXISTS mes_inicio  integer NOT NULL DEFAULT 1 CHECK (mes_inicio  BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS dia_inicio  integer NOT NULL DEFAULT 1 CHECK (dia_inicio  BETWEEN 1 AND 28);
