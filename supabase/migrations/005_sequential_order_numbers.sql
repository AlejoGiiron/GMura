-- ============================================================
-- 005 — Numeración secuencial de órdenes por tienda
--
-- Objetivo:
--   Cada store mantiene su propia secuencia de order_number,
--   independiente de otras tiendas (#1 en store A no choca con
--   #1 en store B). El número se asigna automáticamente en un
--   trigger BEFORE INSERT, protegido por advisory lock para
--   evitar duplicados en inserts concurrentes.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN order_number integer;

-- Único por tienda. El WHERE evita choques durante el backfill.
CREATE UNIQUE INDEX idx_orders_store_number
  ON public.orders(store_id, order_number)
  WHERE order_number IS NOT NULL;

-- ----------------------------------------------------------
-- Función: asigna el siguiente order_number por tienda.
-- SECURITY DEFINER + search_path = public para que pueda leer
-- el MAX() incluso si el INSERT viene de un seller (RLS).
-- pg_advisory_xact_lock garantiza serialización a nivel
-- transacción para una misma store_id.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('orders_seq_' || NEW.store_id::text));

  SELECT COALESCE(MAX(order_number), 0) + 1
    INTO v_next
    FROM public.orders
   WHERE store_id = NEW.store_id;

  NEW.order_number := v_next;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION assign_order_number();

-- ----------------------------------------------------------
-- Backfill: asignar números a órdenes existentes por orden
-- cronológico dentro de cada tienda.
-- ----------------------------------------------------------
DO $$
DECLARE
  r record;
  current_store uuid;
  counter integer;
BEGIN
  current_store := NULL;
  counter := 0;
  FOR r IN
    SELECT id, store_id
      FROM public.orders
     WHERE order_number IS NULL
     ORDER BY store_id, created_at
  LOOP
    IF current_store IS DISTINCT FROM r.store_id THEN
      current_store := r.store_id;
      counter := 1;
    ELSE
      counter := counter + 1;
    END IF;
    UPDATE public.orders SET order_number = counter WHERE id = r.id;
  END LOOP;
END $$;

-- Tras el backfill toda fila tiene número → NOT NULL.
ALTER TABLE public.orders
  ALTER COLUMN order_number SET NOT NULL;

COMMENT ON COLUMN public.orders.order_number IS
  'Número secuencial visible para el usuario. Único por store_id, no global.';
