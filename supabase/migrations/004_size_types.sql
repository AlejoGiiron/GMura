-- ============================================================
-- G-Mura POS — Tipos de talla configurables por producto
-- Migración: 004_size_types.sql
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size_type text NOT NULL DEFAULT 'letter';

COMMENT ON COLUMN public.products.size_type IS
  'Tipo de talla: letter | pants_co | shoes_co | baby | unique | custom';
