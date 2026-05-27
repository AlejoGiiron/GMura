-- ============================================================
-- 010 — Descuento en separados (layaways)
--
-- Permite aplicar un descuento al crear el separado, idéntico al
-- patrón ya soportado en orders (subtotal, discount, total).
--
-- Convención:
--   subtotal = sum(qty * unit_price) en layaway_items
--   total    = subtotal - discount  (constraint enforced)
--
-- El descuento máximo aplicable lo controla la UI según la
-- configuración por tienda (stores.config.layaway_discount_mode/value).
-- ============================================================

ALTER TABLE public.layaways
  ADD COLUMN subtotal numeric(12,2),
  ADD COLUMN discount numeric(12,2) NOT NULL DEFAULT 0
    CHECK (discount >= 0);

COMMENT ON COLUMN public.layaways.subtotal IS
  'Subtotal antes de descuento. Total = subtotal - discount.';

COMMENT ON COLUMN public.layaways.discount IS
  'Descuento aplicado al crear el separado. Cap por la UI según stores.config.layaway_discount_*.';

-- Backfill: para separados existentes asumimos discount = 0 y
-- subtotal = total. La constraint de coherencia se agrega DESPUÉS.
UPDATE public.layaways SET subtotal = total WHERE subtotal IS NULL;

ALTER TABLE public.layaways
  ALTER COLUMN subtotal SET NOT NULL;

-- Coherencia: total siempre = subtotal - discount.
-- Se tolera una diferencia de 0.5 para que pequeños redondeos no
-- rompan layaways legacy backfilleados.
ALTER TABLE public.layaways
  ADD CONSTRAINT layaways_total_matches_subtotal_minus_discount
  CHECK (
    abs(coalesce(subtotal, total) - discount - total) <= 0.5
  );
