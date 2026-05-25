-- ============================================================
-- 008 — Sistema de separados (layaways)
--
-- Modelo:
--   - Stock RESERVADO al crear el separado (variants.reserved_qty),
--     no descontado. Disponible = stock_qty - reserved_qty.
--   - Los abonos (layaway_payments) son FINALES. Al cancelar/expirar
--     un separado solo se libera el stock; el reembolso del dinero
--     ya abonado es un proceso manual del negocio (no se modela aquí).
--   - Al completar (status = 'completed') se libera reserved_qty
--     Y se descuenta stock_qty, registrando movimientos 'sale'.
--   - Numeración secuencial por tienda igual que orders.
-- ============================================================


-- ============================================================
-- 1. TIPO ENUMERADO
-- ============================================================

CREATE TYPE layaway_status AS ENUM (
  'active', 'completed', 'cancelled', 'expired'
);


-- ============================================================
-- 2. COLUMNA reserved_qty EN VARIANTS
-- ============================================================

ALTER TABLE public.variants
  ADD COLUMN reserved_qty integer NOT NULL DEFAULT 0
  CHECK (reserved_qty >= 0);

COMMENT ON COLUMN public.variants.reserved_qty IS
  'Stock reservado en separados activos. Disponible = stock_qty - reserved_qty.';


-- ============================================================
-- 3. TABLAS
-- ============================================================

-- ----------------------------------------------------------
-- LAYAWAYS: Cabecera de separado
-- ----------------------------------------------------------
CREATE TABLE public.layaways (
  id                    uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  layaway_number        integer        NOT NULL,
  store_id              uuid           NOT NULL REFERENCES public.stores(id)    ON DELETE RESTRICT,
  customer_id           uuid           NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  created_by            uuid           NOT NULL REFERENCES public.profiles(id)  ON DELETE RESTRICT,
  status                layaway_status NOT NULL DEFAULT 'active',
  total                 numeric(12,2)  NOT NULL CHECK (total > 0),
  paid_amount           numeric(12,2)  NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  expires_at            timestamptz    NOT NULL,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  converted_order_id    uuid           REFERENCES public.orders(id) ON DELETE SET NULL,
  notes                 text,
  created_at            timestamptz    NOT NULL DEFAULT now(),
  updated_at            timestamptz    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.layaways IS
  'Separados (layaway). Stock reservado por variant.reserved_qty hasta completar o cancelar. Abonos finales, no reembolsables al cancelar.';

-- Numeración única por tienda
CREATE UNIQUE INDEX idx_layaways_store_number
  ON public.layaways(store_id, layaway_number);


-- ----------------------------------------------------------
-- LAYAWAY_ITEMS: Líneas del separado
-- ----------------------------------------------------------
CREATE TABLE public.layaway_items (
  id           uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  layaway_id   uuid           NOT NULL REFERENCES public.layaways(id) ON DELETE CASCADE,
  variant_id   uuid           NOT NULL REFERENCES public.variants(id) ON DELETE RESTRICT,
  product_id   uuid           NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty          integer        NOT NULL CHECK (qty > 0),
  unit_price   numeric(12,2)  NOT NULL CHECK (unit_price >= 0)
);


-- ----------------------------------------------------------
-- LAYAWAY_PAYMENTS: Abonos del separado (finales, no reembolsables)
-- ----------------------------------------------------------
CREATE TABLE public.layaway_payments (
  id              uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  layaway_id      uuid           NOT NULL REFERENCES public.layaways(id) ON DELETE RESTRICT,
  store_id        uuid           NOT NULL REFERENCES public.stores(id),
  amount          numeric(12,2)  NOT NULL CHECK (amount > 0),
  payment_method  payment_method NOT NULL,
  created_by      uuid           NOT NULL REFERENCES public.profiles(id),
  notes           text,
  created_at      timestamptz    NOT NULL DEFAULT now()
);


-- ============================================================
-- 4. TRIGGERS
-- ============================================================

-- ----------------------------------------------------------
-- Asigna layaway_number secuencial por tienda.
-- Mismo patrón que orders (advisory lock por store_id).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_layaway_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('layaways_seq_' || NEW.store_id::text)
  );

  SELECT COALESCE(MAX(layaway_number), 0) + 1 INTO v_next
    FROM public.layaways
   WHERE store_id = NEW.store_id;

  NEW.layaway_number := v_next;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_layaway_number
  BEFORE INSERT ON public.layaways
  FOR EACH ROW EXECUTE FUNCTION assign_layaway_number();


-- updated_at
CREATE TRIGGER trg_layaways_updated_at
  BEFORE UPDATE ON public.layaways
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------
-- Reservar stock al insertar layaway_item.
-- Valida disponible = stock_qty - reserved_qty antes de reservar.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_stock_on_layaway()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available integer;
BEGIN
  SELECT (stock_qty - reserved_qty) INTO v_available
    FROM public.variants
   WHERE id = NEW.variant_id;

  IF v_available < NEW.qty THEN
    RAISE EXCEPTION
      'Stock insuficiente para la variante %. Disponible: %, requerido: %',
      NEW.variant_id, v_available, NEW.qty;
  END IF;

  UPDATE public.variants
     SET reserved_qty = reserved_qty + NEW.qty
   WHERE id = NEW.variant_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reserve_stock_on_layaway
  AFTER INSERT ON public.layaway_items
  FOR EACH ROW EXECUTE FUNCTION reserve_stock_on_layaway();


-- ----------------------------------------------------------
-- Liberar reserved_qty cuando un separado pasa de 'active'
-- a 'cancelled' o 'expired'. NO se ejecuta para 'completed'
-- (esa transición se maneja en fulfill_stock_on_layaway_completion,
-- que además descuenta stock_qty real).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION release_stock_on_layaway_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active'
     AND NEW.status IN ('cancelled', 'expired')
  THEN
    UPDATE public.variants v
       SET reserved_qty = reserved_qty - li.qty
      FROM public.layaway_items li
     WHERE li.layaway_id = NEW.id
       AND li.variant_id = v.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_release_stock_on_layaway_change
  AFTER UPDATE ON public.layaways
  FOR EACH ROW EXECUTE FUNCTION release_stock_on_layaway_change();


-- ----------------------------------------------------------
-- Al completar un separado: SOLO liberar reserved_qty.
-- NO toca stock_qty ni inserta stock_movements: el descuento
-- real lo hace deduct_stock_on_sale cuando la UI crea la
-- order + order_items asociada al layaway completado.
-- Si este trigger descontara stock, habría doble descuento.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION fulfill_stock_on_layaway_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'completed' THEN
    UPDATE public.variants v
       SET reserved_qty = reserved_qty - li.qty
      FROM public.layaway_items li
     WHERE li.layaway_id = NEW.id
       AND li.variant_id = v.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fulfill_stock_on_layaway_completion
  AFTER UPDATE ON public.layaways
  FOR EACH ROW EXECUTE FUNCTION fulfill_stock_on_layaway_completion();


-- ----------------------------------------------------------
-- Mantener paid_amount sincronizado con la suma de abonos.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_layaway_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.layaways
     SET paid_amount = paid_amount + NEW.amount
   WHERE id = NEW.layaway_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_layaway_paid_amount
  AFTER INSERT ON public.layaway_payments
  FOR EACH ROW EXECUTE FUNCTION update_layaway_paid_amount();


-- ============================================================
-- 5. FUNCIÓN PARA EXPIRAR SEPARADOS VENCIDOS
-- ============================================================

-- Marca como 'expired' todos los separados activos cuya fecha
-- de expiración ya pasó. Devuelve la cantidad de filas afectadas.
-- Pensada para ser invocada por un cron job (pg_cron / edge function).
CREATE OR REPLACE FUNCTION expire_overdue_layaways()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.layaways
     SET status = 'expired'
   WHERE status = 'active'
     AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ============================================================
-- 6. ÍNDICES
-- ============================================================

CREATE INDEX idx_layaways_store_id    ON public.layaways(store_id);
CREATE INDEX idx_layaways_customer_id ON public.layaways(customer_id);
CREATE INDEX idx_layaways_status      ON public.layaways(status);
CREATE INDEX idx_layaways_expires_at  ON public.layaways(expires_at);

CREATE INDEX idx_layaway_items_layaway_id ON public.layaway_items(layaway_id);
CREATE INDEX idx_layaway_items_variant_id ON public.layaway_items(variant_id);

CREATE INDEX idx_layaway_payments_layaway_id ON public.layaway_payments(layaway_id);
CREATE INDEX idx_layaway_payments_store_id   ON public.layaway_payments(store_id);


-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.layaways         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layaway_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layaway_payments ENABLE ROW LEVEL SECURITY;


-- LAYAWAYS
CREATE POLICY "layaways_select"
  ON public.layaways FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "layaways_insert"
  ON public.layaways FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "layaways_update"
  ON public.layaways FOR UPDATE
  USING (store_id = get_my_store_id());

CREATE POLICY "layaways_delete_admin"
  ON public.layaways FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- LAYAWAY_ITEMS (acceso a través del layaway padre)
CREATE POLICY "layaway_items_select"
  ON public.layaway_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.layaways l
     WHERE l.id = layaway_id AND l.store_id = get_my_store_id()
  ));

CREATE POLICY "layaway_items_insert"
  ON public.layaway_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.layaways l
     WHERE l.id = layaway_id AND l.store_id = get_my_store_id()
  ));


-- LAYAWAY_PAYMENTS
CREATE POLICY "layaway_payments_select"
  ON public.layaway_payments FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "layaway_payments_insert"
  ON public.layaway_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id());
