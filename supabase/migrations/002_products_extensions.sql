-- ============================================================
-- G-Mura POS — Extensiones al catálogo de productos
-- Migración: 002_products_extensions.sql
-- ============================================================

-- Imagen principal del producto (Supabase Storage, bucket: product-images)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text;

-- Control de variantes activas/inactivas sin perder historial
ALTER TABLE public.variants
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.image_url
  IS 'URL pública desde Supabase Storage, bucket product-images.';

COMMENT ON COLUMN public.variants.is_active
  IS 'false = variante desactivada; no aparece en el POS pero conserva historial de ventas.';
