-- ============================================================
-- G-Mura POS — Schema inicial
-- Migración: 001_initial_schema.sql
-- ============================================================
-- NOTA: Esta migración añade columna updated_at a tablas mutables
-- (profiles, stores, categories, products, variants, customers,
--  orders, returns, cash_shifts). Los tipos TypeScript en
--  src/types/database.types.ts deben actualizarse para incluirla.
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. TIPOS ENUMERADOS
-- ============================================================

CREATE TYPE user_role     AS ENUM ('admin', 'seller');
CREATE TYPE order_status  AS ENUM ('completed', 'cancelled', 'returned');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'transfer', 'nequi');
CREATE TYPE movement_type AS ENUM ('sale', 'return', 'adjustment', 'purchase');
CREATE TYPE return_type   AS ENUM ('return', 'exchange');
CREATE TYPE return_status AS ENUM ('pending', 'completed');
CREATE TYPE return_action AS ENUM ('refund', 'exchange');


-- ============================================================
-- 2. FUNCIONES AUXILIARES
-- ============================================================

-- Devuelve el store_id del usuario autenticado.
-- SECURITY DEFINER para que bypasee RLS al leer profiles.
CREATE OR REPLACE FUNCTION get_my_store_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT store_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Devuelve el rol del usuario autenticado.
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Actualiza updated_at al momento actual en cada UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 3. TABLAS
-- (orden de dependencias: stores → profiles → categories →
--  products → variants → customers → orders → order_items →
--  stock_movements → returns → return_items → cash_shifts)
-- ============================================================

-- ----------------------------------------------------------
-- STORES: Cada tienda es un tenant independiente
-- ----------------------------------------------------------
CREATE TABLE public.stores (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text        NOT NULL,
  address      text,
  phone        text,
  logo_url     text,
  config       jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.stores            IS 'Tiendas registradas. Cada tienda es un tenant independiente.';
COMMENT ON COLUMN public.stores.config     IS 'Configuración libre de la tienda (impresora, moneda, etc.).';


-- ----------------------------------------------------------
-- PROFILES: Extiende auth.users con datos del negocio
-- ----------------------------------------------------------
CREATE TABLE public.profiles (
  id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  full_name    text        NOT NULL,
  role         user_role   NOT NULL DEFAULT 'seller',
  store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.profiles          IS 'Perfil extendido de auth.users. Un registro por usuario, ligado a una tienda.';
COMMENT ON COLUMN public.profiles.role     IS 'admin: acceso total. seller: ventas, devoluciones, consultas.';


-- ----------------------------------------------------------
-- CATEGORIES: Categorías de productos por tienda
-- ----------------------------------------------------------
CREATE TABLE public.categories (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text        NOT NULL,
  color        text,
  sort_order   integer     NOT NULL DEFAULT 0,
  store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  is_active    boolean     NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.categories            IS 'Categorías de productos. Cada tienda administra las suyas.';
COMMENT ON COLUMN public.categories.color      IS 'Color HEX para identificar visualmente la categoría en el POS.';
COMMENT ON COLUMN public.categories.sort_order IS 'Orden de visualización en el catálogo (menor = primero).';


-- ----------------------------------------------------------
-- PRODUCTS: Catálogo de productos del negocio
-- ----------------------------------------------------------
CREATE TABLE public.products (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text        NOT NULL,
  description  text,
  brand        text,
  store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  category_id  uuid        REFERENCES public.categories(id) ON DELETE SET NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.products             IS 'Catálogo de productos. El stock se gestiona a nivel de variante, no de producto.';
COMMENT ON COLUMN public.products.category_id IS 'Nullable: el producto puede existir sin categoría asignada.';


-- ----------------------------------------------------------
-- VARIANTS: Variantes de producto (talla + color)
-- El stock vive aquí, no en products.
-- ----------------------------------------------------------
CREATE TABLE public.variants (
  id           uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id   uuid           NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  store_id     uuid           NOT NULL REFERENCES public.stores(id)   ON DELETE CASCADE,
  size         text,
  color        text,
  sku          text,
  barcode      text,
  price        numeric(12,2)  NOT NULL DEFAULT 0,
  cost_price   numeric(12,2),
  stock_qty    integer        NOT NULL DEFAULT 0,
  min_stock    integer        NOT NULL DEFAULT 0,
  created_at   timestamptz    NOT NULL DEFAULT now(),
  updated_at   timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT variants_price_non_negative      CHECK (price >= 0),
  CONSTRAINT variants_cost_non_negative       CHECK (cost_price IS NULL OR cost_price >= 0),
  CONSTRAINT variants_stock_non_negative      CHECK (stock_qty >= 0),
  CONSTRAINT variants_min_stock_non_negative  CHECK (min_stock >= 0),

  -- Un código de barras identifica una variante de forma global
  CONSTRAINT variants_barcode_unique          UNIQUE (barcode),
  -- SKU único dentro de la tienda (permite NULL múltiples)
  CONSTRAINT variants_sku_unique_per_store    UNIQUE (store_id, sku),
  -- No pueden existir dos variantes con la misma talla+color en el mismo producto
  -- NULLS NOT DISTINCT: (product_id, NULL, NULL) también es único por producto
  CONSTRAINT variants_combo_unique            UNIQUE NULLS NOT DISTINCT (product_id, size, color)
);

COMMENT ON TABLE  public.variants           IS 'Variantes de producto (talla + color). stock_qty se actualiza via trigger.';
COMMENT ON COLUMN public.variants.stock_qty IS 'Stock actual. El trigger en order_items lo descuenta; en return_items lo incrementa.';
COMMENT ON COLUMN public.variants.min_stock IS 'Alerta de stock bajo cuando stock_qty <= min_stock.';
COMMENT ON COLUMN public.variants.barcode   IS 'Código de barras único globalmente. Permite NULL para variantes sin código.';


-- ----------------------------------------------------------
-- CUSTOMERS: Clientes registrados (CRM básico)
-- ----------------------------------------------------------
CREATE TABLE public.customers (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name    text        NOT NULL,
  phone        text,
  email        text,
  document_id  text,
  store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.customers             IS 'Clientes registrados. Permiten historial de compras y CRM.';
COMMENT ON COLUMN public.customers.document_id IS 'Cédula u otro documento de identidad (opcional).';


-- ----------------------------------------------------------
-- ORDERS: Cabecera de venta
-- ----------------------------------------------------------
CREATE TABLE public.orders (
  id             uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id       uuid           NOT NULL REFERENCES public.stores(id)   ON DELETE RESTRICT,
  customer_id    uuid           REFERENCES public.customers(id)          ON DELETE SET NULL,
  created_by     uuid           NOT NULL REFERENCES public.profiles(id)  ON DELETE RESTRICT,
  status         order_status   NOT NULL DEFAULT 'completed',
  subtotal       numeric(12,2)  NOT NULL DEFAULT 0,
  discount       numeric(12,2)  NOT NULL DEFAULT 0,
  total          numeric(12,2)  NOT NULL DEFAULT 0,
  payment_method payment_method NOT NULL,
  cash_received  numeric(12,2),
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT orders_subtotal_non_negative  CHECK (subtotal >= 0),
  CONSTRAINT orders_discount_non_negative  CHECK (discount >= 0),
  CONSTRAINT orders_total_non_negative     CHECK (total >= 0),
  CONSTRAINT orders_cash_non_negative      CHECK (cash_received IS NULL OR cash_received >= 0)
);

COMMENT ON TABLE  public.orders               IS 'Cabecera de venta. total = subtotal - discount.';
COMMENT ON COLUMN public.orders.customer_id   IS 'Nullable: las ventas rápidas no requieren cliente registrado.';
COMMENT ON COLUMN public.orders.cash_received IS 'Solo aplica cuando payment_method = cash. Permite calcular cambio.';


-- ----------------------------------------------------------
-- ORDER_ITEMS: Líneas de cada venta
-- El INSERT dispara la deducción de stock en variants.
-- ----------------------------------------------------------
CREATE TABLE public.order_items (
  id           uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     uuid           NOT NULL REFERENCES public.orders(id)   ON DELETE CASCADE,
  variant_id   uuid           NOT NULL REFERENCES public.variants(id) ON DELETE RESTRICT,
  product_id   uuid           NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty          integer        NOT NULL,
  unit_price   numeric(12,2)  NOT NULL,
  created_at   timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT order_items_qty_positive    CHECK (qty > 0),
  CONSTRAINT order_items_price_positive  CHECK (unit_price >= 0)
);

COMMENT ON TABLE  public.order_items           IS 'Líneas de venta. El trigger deduct_stock_on_sale descuenta stock al insertar.';
COMMENT ON COLUMN public.order_items.product_id IS 'Desnormalizado para mantener historial aunque se elimine la variante.';


-- ----------------------------------------------------------
-- STOCK_MOVEMENTS: Auditoría completa de movimientos de stock
-- ----------------------------------------------------------
CREATE TABLE public.stock_movements (
  id           uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id   uuid          NOT NULL REFERENCES public.variants(id)  ON DELETE RESTRICT,
  store_id     uuid          NOT NULL REFERENCES public.stores(id)    ON DELETE RESTRICT,
  type         movement_type NOT NULL,
  qty          integer       NOT NULL,
  reference_id uuid,
  notes        text,
  created_by   uuid          NOT NULL REFERENCES public.profiles(id)  ON DELETE RESTRICT,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.stock_movements             IS 'Auditoría de stock. qty negativo = salida (venta), positivo = entrada (devolución/compra).';
COMMENT ON COLUMN public.stock_movements.qty         IS 'Cantidad con signo: negativo para salidas, positivo para entradas.';
COMMENT ON COLUMN public.stock_movements.reference_id IS 'FK libre a la orden, devolución u otro documento que originó el movimiento.';


-- ----------------------------------------------------------
-- RETURNS: Cabecera de devoluciones y cambios
-- ----------------------------------------------------------
CREATE TABLE public.returns (
  id                uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_order_id uuid          NOT NULL REFERENCES public.orders(id)  ON DELETE RESTRICT,
  store_id          uuid          NOT NULL REFERENCES public.stores(id)   ON DELETE RESTRICT,
  created_by        uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  type              return_type   NOT NULL,
  status            return_status NOT NULL DEFAULT 'pending',
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.returns                  IS 'Cabecera de devoluciones/cambios. Siempre ligada a una orden original.';
COMMENT ON COLUMN public.returns.type             IS 'return: se devuelve dinero. exchange: se cambia por otro artículo.';
COMMENT ON COLUMN public.returns.original_order_id IS 'Referencia a la venta original. No se puede borrar la orden si tiene devoluciones.';


-- ----------------------------------------------------------
-- RETURN_ITEMS: Líneas de cada devolución
-- El INSERT dispara la reposición de stock en variants.
-- ----------------------------------------------------------
CREATE TABLE public.return_items (
  id           uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id    uuid           NOT NULL REFERENCES public.returns(id)  ON DELETE CASCADE,
  variant_id   uuid           NOT NULL REFERENCES public.variants(id) ON DELETE RESTRICT,
  qty          integer        NOT NULL,
  unit_price   numeric(12,2)  NOT NULL,
  action       return_action  NOT NULL,

  CONSTRAINT return_items_qty_positive    CHECK (qty > 0),
  CONSTRAINT return_items_price_positive  CHECK (unit_price >= 0)
);

COMMENT ON TABLE  public.return_items        IS 'Líneas de devolución. El trigger restore_stock_on_return repone stock al insertar.';
COMMENT ON COLUMN public.return_items.action IS 'refund: se reembolsa dinero. exchange: se genera un cambio por otra variante.';


-- ----------------------------------------------------------
-- CASH_SHIFTS: Turnos de caja (apertura y cierre)
-- ----------------------------------------------------------
CREATE TABLE public.cash_shifts (
  id              uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        uuid           NOT NULL REFERENCES public.stores(id)   ON DELETE RESTRICT,
  opened_by       uuid           NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_by       uuid           REFERENCES public.profiles(id)          ON DELETE RESTRICT,
  opening_amount  numeric(12,2)  NOT NULL DEFAULT 0,
  closing_amount  numeric(12,2),
  opened_at       timestamptz    NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  updated_at      timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT cash_shifts_opening_non_negative CHECK (opening_amount >= 0),
  CONSTRAINT cash_shifts_closing_non_negative CHECK (closing_amount IS NULL OR closing_amount >= 0)
);

COMMENT ON TABLE  public.cash_shifts                IS 'Turnos de caja. Un turno por día/vendedor. closed_at NULL = turno abierto.';
COMMENT ON COLUMN public.cash_shifts.opening_amount IS 'Monto inicial de efectivo al abrir caja.';
COMMENT ON COLUMN public.cash_shifts.closing_amount IS 'Monto contado al cerrar caja. NULL mientras el turno está abierto.';


-- ============================================================
-- 4. TRIGGERS updated_at
-- ============================================================

CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_variants_updated_at
  BEFORE UPDATE ON public.variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_returns_updated_at
  BEFORE UPDATE ON public.returns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cash_shifts_updated_at
  BEFORE UPDATE ON public.cash_shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 5. TRIGGERS DE STOCK
-- ============================================================

-- ----------------------------------------------------------
-- Descuenta stock al insertar una línea de venta.
-- También registra el movimiento en stock_movements.
-- SECURITY DEFINER: bypasea RLS para escribir en stock_movements
-- desde el contexto de un vendedor.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id     uuid;
  v_created_by   uuid;
  v_current_stock integer;
BEGIN
  SELECT store_id, created_by
    INTO v_store_id, v_created_by
    FROM public.orders
   WHERE id = NEW.order_id;

  SELECT stock_qty
    INTO v_current_stock
    FROM public.variants
   WHERE id = NEW.variant_id;

  IF v_current_stock < NEW.qty THEN
    RAISE EXCEPTION
      'Stock insuficiente para la variante %. Disponible: %, Requerido: %',
      NEW.variant_id, v_current_stock, NEW.qty;
  END IF;

  UPDATE public.variants
     SET stock_qty = stock_qty - NEW.qty
   WHERE id = NEW.variant_id;

  INSERT INTO public.stock_movements
    (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES
    (NEW.variant_id, v_store_id, 'sale', -NEW.qty, NEW.order_id, v_created_by);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deduct_stock_on_sale
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION deduct_stock_on_sale();


-- ----------------------------------------------------------
-- Incrementa stock al insertar una línea de devolución.
-- También registra el movimiento en stock_movements.
-- Aplica tanto a 'refund' como a 'exchange' (en ambos casos
-- el artículo regresa al inventario).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION restore_stock_on_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   uuid;
  v_created_by uuid;
BEGIN
  SELECT store_id, created_by
    INTO v_store_id, v_created_by
    FROM public.returns
   WHERE id = NEW.return_id;

  UPDATE public.variants
     SET stock_qty = stock_qty + NEW.qty
   WHERE id = NEW.variant_id;

  INSERT INTO public.stock_movements
    (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES
    (NEW.variant_id, v_store_id, 'return', NEW.qty, NEW.return_id, v_created_by);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_restore_stock_on_return
  AFTER INSERT ON public.return_items
  FOR EACH ROW EXECUTE FUNCTION restore_stock_on_return();


-- ============================================================
-- 6. ÍNDICES
-- ============================================================

-- Búsqueda de variantes por código de barras en el POS (crítico para velocidad)
CREATE INDEX idx_variants_barcode     ON public.variants(barcode) WHERE barcode IS NOT NULL;
-- Listado de variantes de un producto
CREATE INDEX idx_variants_product_id  ON public.variants(product_id);
CREATE INDEX idx_variants_store_id    ON public.variants(store_id);

-- Líneas de una orden
CREATE INDEX idx_order_items_order_id   ON public.order_items(order_id);
CREATE INDEX idx_order_items_variant_id ON public.order_items(variant_id);

-- Auditoría de stock por variante y por tienda
CREATE INDEX idx_stock_movements_variant_id ON public.stock_movements(variant_id);
CREATE INDEX idx_stock_movements_store_id   ON public.stock_movements(store_id);

-- Historial de órdenes (listado cronológico inverso)
CREATE INDEX idx_orders_store_created  ON public.orders(store_id, created_at DESC);
CREATE INDEX idx_orders_customer_id    ON public.orders(customer_id) WHERE customer_id IS NOT NULL;

-- Devoluciones de una orden
CREATE INDEX idx_returns_original_order ON public.returns(original_order_id);

-- Búsqueda de clientes dentro de la tienda
CREATE INDEX idx_customers_store_id    ON public.customers(store_id);
CREATE INDEX idx_customers_phone       ON public.customers(store_id, phone) WHERE phone IS NOT NULL;

-- Catálogo de productos
CREATE INDEX idx_products_store_id     ON public.products(store_id);
CREATE INDEX idx_profiles_store_id     ON public.profiles(store_id);


-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.stores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shifts     ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------
-- STORES
-- ----------------------------------------------------------
CREATE POLICY "stores_select_own"
  ON public.stores FOR SELECT
  USING (id = get_my_store_id());

CREATE POLICY "stores_update_admin"
  ON public.stores FOR UPDATE
  USING (id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- PROFILES
-- get_my_store_id() es SECURITY DEFINER, por lo que puede leer
-- profiles sin triggear estas políticas (sin recursión).
-- ----------------------------------------------------------
CREATE POLICY "profiles_select_same_store"
  ON public.profiles FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR (store_id = get_my_store_id() AND get_my_role() = 'admin')
  );


-- ----------------------------------------------------------
-- CATEGORIES
-- ----------------------------------------------------------
CREATE POLICY "categories_select"
  ON public.categories FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "categories_insert_admin"
  ON public.categories FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "categories_update_admin"
  ON public.categories FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "categories_delete_admin"
  ON public.categories FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- PRODUCTS
-- ----------------------------------------------------------
CREATE POLICY "products_select"
  ON public.products FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "products_insert_admin"
  ON public.products FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "products_update_admin"
  ON public.products FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "products_delete_admin"
  ON public.products FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- VARIANTS
-- ----------------------------------------------------------
CREATE POLICY "variants_select"
  ON public.variants FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "variants_insert_admin"
  ON public.variants FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "variants_update_admin"
  ON public.variants FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');

CREATE POLICY "variants_delete_admin"
  ON public.variants FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- CUSTOMERS
-- Todos los usuarios de la tienda pueden crear y editar clientes.
-- ----------------------------------------------------------
CREATE POLICY "customers_select"
  ON public.customers FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "customers_insert"
  ON public.customers FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "customers_update"
  ON public.customers FOR UPDATE
  USING (store_id = get_my_store_id());

CREATE POLICY "customers_delete_admin"
  ON public.customers FOR DELETE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- ORDERS
-- Sellers crean órdenes; solo admins pueden cambiar su status.
-- ----------------------------------------------------------
CREATE POLICY "orders_select"
  ON public.orders FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "orders_insert"
  ON public.orders FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "orders_update_admin"
  ON public.orders FOR UPDATE
  USING (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- ORDER_ITEMS
-- Acceso a través de la orden padre (misma tienda).
-- ----------------------------------------------------------
CREATE POLICY "order_items_select"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND o.store_id = get_my_store_id()
    )
  );

CREATE POLICY "order_items_insert"
  ON public.order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_id
         AND o.store_id = get_my_store_id()
    )
  );


-- ----------------------------------------------------------
-- STOCK_MOVEMENTS
-- Los inserts automáticos desde triggers usan SECURITY DEFINER
-- y no pasan por estas políticas.
-- Los admins pueden insertar ajustes manuales de inventario.
-- ----------------------------------------------------------
CREATE POLICY "stock_movements_select"
  ON public.stock_movements FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "stock_movements_insert_admin"
  ON public.stock_movements FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND get_my_role() = 'admin');


-- ----------------------------------------------------------
-- RETURNS
-- Todos los usuarios de la tienda pueden crear devoluciones.
-- ----------------------------------------------------------
CREATE POLICY "returns_select"
  ON public.returns FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "returns_insert"
  ON public.returns FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "returns_update"
  ON public.returns FOR UPDATE
  USING (store_id = get_my_store_id());


-- ----------------------------------------------------------
-- RETURN_ITEMS
-- Acceso a través de la devolución padre (misma tienda).
-- ----------------------------------------------------------
CREATE POLICY "return_items_select"
  ON public.return_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.returns r
       WHERE r.id = return_id
         AND r.store_id = get_my_store_id()
    )
  );

CREATE POLICY "return_items_insert"
  ON public.return_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.returns r
       WHERE r.id = return_id
         AND r.store_id = get_my_store_id()
    )
  );


-- ----------------------------------------------------------
-- CASH_SHIFTS
-- Cualquier usuario puede abrir un turno.
-- Solo el dueño del turno o un admin puede cerrarlo.
-- ----------------------------------------------------------
CREATE POLICY "cash_shifts_select"
  ON public.cash_shifts FOR SELECT
  USING (store_id = get_my_store_id());

CREATE POLICY "cash_shifts_insert"
  ON public.cash_shifts FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

CREATE POLICY "cash_shifts_update"
  ON public.cash_shifts FOR UPDATE
  USING (
    store_id = get_my_store_id()
    AND (opened_by = auth.uid() OR get_my_role() = 'admin')
  );
