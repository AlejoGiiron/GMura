-- ============================================================
-- 006 — Limpieza de payment_method: eliminar 'nequi', agregar 'addi'
--
-- Estado final del enum: cash, card, transfer, addi.
-- Las órdenes existentes con 'nequi' se migran a 'transfer' antes de
-- eliminar el valor del enum (PostgreSQL no permite DROP VALUE).
--
-- NOTA: las tablas supplier_payments y layaway_payments aún no existen
-- en este punto del proyecto. Cuando se creen, descomentar las líneas
-- correspondientes (UPDATE + ALTER TABLE).
-- ============================================================

-- Paso 1: agregar 'addi'
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'addi';

-- Paso 2: migrar órdenes con 'nequi' → 'transfer'
UPDATE public.orders SET payment_method = 'transfer'
WHERE payment_method = 'nequi';

-- UPDATE public.supplier_payments SET payment_method = 'transfer'
-- WHERE payment_method = 'nequi';

-- UPDATE public.layaway_payments SET payment_method = 'transfer'
-- WHERE payment_method = 'nequi';

-- Paso 3: crear nuevo enum sin 'nequi'
CREATE TYPE payment_method_new AS ENUM
  ('cash', 'card', 'transfer', 'addi');

-- Paso 4: cambiar columnas al nuevo tipo
ALTER TABLE public.orders
  ALTER COLUMN payment_method TYPE payment_method_new
  USING payment_method::text::payment_method_new;

-- ALTER TABLE public.supplier_payments
--   ALTER COLUMN payment_method TYPE payment_method_new
--   USING payment_method::text::payment_method_new;

-- ALTER TABLE public.layaway_payments
--   ALTER COLUMN payment_method TYPE payment_method_new
--   USING payment_method::text::payment_method_new;

-- Paso 5: eliminar enum viejo y renombrar nuevo
DROP TYPE payment_method;
ALTER TYPE payment_method_new RENAME TO payment_method;

COMMENT ON TYPE payment_method IS
  'Métodos de pago: cash, card, transfer, addi.';
