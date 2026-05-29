-- ============================================================
-- 011 — Proveedores y compras
--
-- Modelo:
--   - suppliers: proveedores de la tienda con condiciones comerciales.
--   - purchase_invoices: facturas de compra. Cada item incrementa
--     stock automáticamente vía trigger (similar a devoluciones).
--   - purchase_invoice_items: líneas de la factura. El costo unitario
--     puede opcionalmente actualizar variants.cost_price (update_cost).
--   - supplier_payments: pagos a proveedores. Los pagos en efectivo
--     durante un turno abierto generan un cash_expense automático
--     para que afecten el cuadre de caja.
--
-- Decisiones de negocio:
--   - La factura puede incluir productos del catálogo o nuevos
--     (la UI crea product + variant antes de insertar el item).
--   - No se almacena PDF/imagen de la factura física.
--   - El enum payment_method ya incluye cash/card/transfer/addi (006).
--   - El enum movement_type ya incluye 'purchase' (001).
-- ============================================================


-- ============================================================
-- 1. TIPO ENUMERADO
-- ============================================================

CREATE TYPE invoice_status AS ENUM (
  'pending', 'partial', 'paid', 'cancelled'
);


-- ============================================================
-- 2. TABLAS
-- ============================================================

-- ----------------------------------------------------------
-- SUPPLIERS: Proveedores de la tienda
-- ----------------------------------------------------------
CREATE TABLE public.suppliers (
  id                  uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id            uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  nit                 text,
  contact_name        text,
  phone               text,
  email               text,
  address             text,
  payment_terms_days  integer     NOT NULL DEFAULT 30,
  is_active           boolean     NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_terms_non_negative CHECK (payment_terms_days >= 0)
);

COMMENT ON TABLE public.suppliers IS
  'Proveedores de la tienda con sus condiciones comerciales.';


-- ----------------------------------------------------------
-- PURCHASE_INVOICES: Cabecera de factura de compra
-- ----------------------------------------------------------
CREATE TABLE public.purchase_invoices (
  id              uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number  text           NOT NULL,
  store_id        uuid           NOT NULL REFERENCES stores(id)    ON DELETE RESTRICT,
  supplier_id     uuid           NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  created_by      uuid           NOT NULL REFERENCES profiles(id),
  invoice_date    date           NOT NULL,
  due_date        date,
  status          invoice_status NOT NULL DEFAULT 'pending',
  subtotal        numeric(12,2)  NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax             numeric(12,2)  NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total           numeric(12,2)  NOT NULL CHECK (total >= 0),
  paid_amount     numeric(12,2)  NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes           text,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  -- Mismo número de factura no puede repetirse para el mismo proveedor en la tienda
  UNIQUE (store_id, supplier_id, invoice_number)
);

COMMENT ON TABLE public.purchase_invoices IS
  'Facturas de compra. Cada item incrementa stock automáticamente.';


-- ----------------------------------------------------------
-- PURCHASE_INVOICE_ITEMS: Líneas de la factura de compra
-- El INSERT incrementa stock (y opcionalmente cost_price) en variants.
-- ----------------------------------------------------------
CREATE TABLE public.purchase_invoice_items (
  id            uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id    uuid           NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  variant_id    uuid           NOT NULL REFERENCES variants(id)         ON DELETE RESTRICT,
  product_id    uuid           NOT NULL REFERENCES products(id)         ON DELETE RESTRICT,
  qty           integer        NOT NULL CHECK (qty > 0),
  unit_cost     numeric(12,2)  NOT NULL CHECK (unit_cost >= 0),
  subtotal      numeric(12,2)  NOT NULL CHECK (subtotal >= 0),
  update_cost   boolean        NOT NULL DEFAULT false
);

COMMENT ON COLUMN public.purchase_invoice_items.update_cost IS
  'Si true, el trigger actualiza variants.cost_price al insertar.';


-- ----------------------------------------------------------
-- SUPPLIER_PAYMENTS: Pagos a proveedores
-- Pagos en efectivo durante un turno abierto generan un cash_expense.
-- ----------------------------------------------------------
CREATE TABLE public.supplier_payments (
  id              uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      uuid           NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  store_id        uuid           NOT NULL REFERENCES stores(id),
  amount          numeric(12,2)  NOT NULL CHECK (amount > 0),
  payment_date    date           NOT NULL DEFAULT CURRENT_DATE,
  payment_method  payment_method NOT NULL,
  reference       text,
  notes           text,
  created_by      uuid           NOT NULL REFERENCES profiles(id),
  shift_id        uuid           REFERENCES cash_shifts(id) ON DELETE SET NULL,
  created_at      timestamptz    NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.supplier_payments.shift_id IS
  'Turno en el que se registró el pago. Permite vincular pagos en
   efectivo al cuadre de caja del turno correspondiente.';


-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- ----------------------------------------------------------
-- Incrementa stock al insertar item de compra.
-- Si update_cost = true, también actualiza cost_price.
-- Registra el movimiento en stock_movements (type = 'purchase').
-- SECURITY DEFINER: bypasea RLS para escribir en stock_movements.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION increase_stock_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   uuid;
  v_created_by uuid;
BEGIN
  SELECT store_id, created_by INTO v_store_id, v_created_by
  FROM purchase_invoices WHERE id = NEW.invoice_id;

  IF NEW.update_cost THEN
    UPDATE variants
    SET stock_qty  = stock_qty + NEW.qty,
        cost_price = NEW.unit_cost
    WHERE id = NEW.variant_id;
  ELSE
    UPDATE variants
    SET stock_qty = stock_qty + NEW.qty
    WHERE id = NEW.variant_id;
  END IF;

  INSERT INTO stock_movements
    (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES
    (NEW.variant_id, v_store_id, 'purchase', NEW.qty,
     NEW.invoice_id, v_created_by);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_increase_stock_on_purchase
  AFTER INSERT ON purchase_invoice_items
  FOR EACH ROW EXECUTE FUNCTION increase_stock_on_purchase();


-- ----------------------------------------------------------
-- Actualiza paid_amount y status al insertar un pago.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_invoice_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(12,2);
  v_paid  numeric(12,2);
BEGIN
  SELECT total INTO v_total
  FROM purchase_invoices WHERE id = NEW.invoice_id;

  UPDATE purchase_invoices
  SET paid_amount = paid_amount + NEW.amount
  WHERE id = NEW.invoice_id
  RETURNING paid_amount INTO v_paid;

  UPDATE purchase_invoices
  SET status = CASE
    WHEN v_paid >= v_total THEN 'paid'::invoice_status
    WHEN v_paid > 0        THEN 'partial'::invoice_status
    ELSE 'pending'::invoice_status
  END
  WHERE id = NEW.invoice_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_invoice_payment_status
  AFTER INSERT ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION update_invoice_payment_status();


-- ----------------------------------------------------------
-- Crea un cash_expense automático si el pago es en efectivo
-- durante un turno abierto, para que afecte el cuadre de caja.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION register_supplier_payment_as_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_name  text;
  v_invoice_number text;
  v_current_shift_id uuid;
BEGIN
  -- Solo aplica si es pago en efectivo Y hay shift_id asignado
  IF NEW.payment_method = 'cash' AND NEW.shift_id IS NOT NULL THEN
    -- Verificar que el turno esté abierto
    SELECT id INTO v_current_shift_id
    FROM cash_shifts
    WHERE id = NEW.shift_id AND closed_at IS NULL;

    IF v_current_shift_id IS NOT NULL THEN
      -- Obtener datos para el motivo
      SELECT s.name, i.invoice_number
      INTO v_supplier_name, v_invoice_number
      FROM purchase_invoices i
      JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.id = NEW.invoice_id;

      INSERT INTO cash_expenses
        (shift_id, store_id, amount, reason, notes, created_by)
      VALUES
        (NEW.shift_id,
         NEW.store_id,
         NEW.amount,
         'Pago a proveedor: ' || v_supplier_name,
         'Factura ' || v_invoice_number ||
           COALESCE(' · ' || NEW.notes, ''),
         NEW.created_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_register_supplier_payment_as_expense
  AFTER INSERT ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION register_supplier_payment_as_expense();


-- ----------------------------------------------------------
-- updated_at en suppliers y purchase_invoices
-- ----------------------------------------------------------
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_purchase_invoices_updated_at
  BEFORE UPDATE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 4. ÍNDICES
-- ============================================================

CREATE INDEX idx_suppliers_store_id   ON suppliers(store_id);
CREATE INDEX idx_suppliers_is_active  ON suppliers(is_active);

CREATE INDEX idx_invoices_store_id     ON purchase_invoices(store_id);
CREATE INDEX idx_invoices_supplier_id  ON purchase_invoices(supplier_id);
CREATE INDEX idx_invoices_status       ON purchase_invoices(status);
CREATE INDEX idx_invoices_invoice_date ON purchase_invoices(invoice_date);
CREATE INDEX idx_invoices_due_date     ON purchase_invoices(due_date)
  WHERE status IN ('pending', 'partial');

CREATE INDEX idx_invoice_items_invoice_id ON purchase_invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_variant_id ON purchase_invoice_items(variant_id);

CREATE INDEX idx_supplier_payments_invoice_id ON supplier_payments(invoice_id);
CREATE INDEX idx_supplier_payments_store_id   ON supplier_payments(store_id);
CREATE INDEX idx_supplier_payments_shift_id   ON supplier_payments(shift_id)
  WHERE shift_id IS NOT NULL;


-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments      ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------
-- SUPPLIERS
-- ----------------------------------------------------------
CREATE POLICY "suppliers_select"
  ON suppliers FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "suppliers_insert_admin"
  ON suppliers FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "suppliers_update_admin"
  ON suppliers FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "suppliers_delete_admin"
  ON suppliers FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- PURCHASE_INVOICES
-- ----------------------------------------------------------
CREATE POLICY "purchase_invoices_select"
  ON purchase_invoices FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "purchase_invoices_insert_admin"
  ON purchase_invoices FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "purchase_invoices_update_admin"
  ON purchase_invoices FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- PURCHASE_INVOICE_ITEMS (acceso a través de la factura padre)
-- ----------------------------------------------------------
CREATE POLICY "purchase_invoice_items_select"
  ON purchase_invoice_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM purchase_invoices i
    WHERE i.id = invoice_id AND i.store_id = get_my_store_id()
  ));

CREATE POLICY "purchase_invoice_items_insert_admin"
  ON purchase_invoice_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM purchase_invoices i
    WHERE i.id = invoice_id
      AND i.store_id = get_my_store_id()
      AND get_my_role() = 'admin'
  ));


-- ----------------------------------------------------------
-- SUPPLIER_PAYMENTS
-- ----------------------------------------------------------
CREATE POLICY "supplier_payments_select"
  ON supplier_payments FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "supplier_payments_insert_admin"
  ON supplier_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');
