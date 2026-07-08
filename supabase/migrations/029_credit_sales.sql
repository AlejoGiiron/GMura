-- ============================================================
-- 029 — Ventas a crédito (FIADOS)
--
-- Un FIADO es una VENTA a crédito: el cliente se lleva el producto, paga
-- una parte (o nada) y queda debiendo el resto.
--
-- MODELO (calca patrones existentes, no inventa):
--   · Es una orden normal con is_credit=true → descuenta stock (trigger
--     deduct_stock_on_sale) y se reconoce COMPLETA en reportes
--     (daily_sales_summary suma orders.total). El revenue se reconoce una
--     sola vez, al vender.
--   · is_credit EXCLUYE la orden del cuadre de caja (capa de aplicación),
--     igual que los separados excluyen la orden de conversión por
--     converted_order_id. El efectivo NO entra por la orden.
--   · El efectivo entra por credit_payments (calco de layaway_payments):
--     el pago inicial (puede ser $0) y los abonos posteriores, imputados
--     al turno donde se cobran (shift_id). Suman al cuadre como ingreso.
--   · orders.paid_amount = Σ credit_payments (trigger, calco de
--     update_layaway_paid_amount). Saldo del fiado = total − paid_amount.
--   · payment_method gana el valor 'credit' (marca la venta como fiada).
--   · Cartera (quién debe cuánto): vista credit_balance por cliente
--     (calco de supplier_balance).
--   · Autorizar un fiado requiere el permiso ventas.fiar (Admin/Dueño).
--
-- ASIMETRÍA INTENCIONAL (igual que separados): CAJA cuenta solo el efectivo
--   realmente cobrado (abonos); REPORTES reconocen la venta completa al vender.
--
-- Requiere: 001 (orders + trigger de stock), 008 (patrón layaway_payments),
--   012 (patrón supplier_balance), 020/021/023 (organizations + roles RBAC).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 028_credit_sales.sql
-- ============================================================


-- ============================================================
-- 0. ENUM: agregar 'credit' a payment_method
--
-- ALTER TYPE ... ADD VALUE va FUERA de la transacción principal, como
-- statement autocommiteado. Motivo: en Postgres un valor de enum recién
-- agregado no puede USARSE dentro de la MISMA transacción que lo agregó
-- (y en versiones viejas ADD VALUE ni siquiera corre dentro de un bloque
-- transaccional). Dejándolo autónomo y primero, el valor queda commiteado
-- y disponible; el resto del DDL (que NO referencia 'credit' en ningún
-- CHECK/insert) va aparte en su propio BEGIN/COMMIT.
--
-- IF NOT EXISTS lo hace idempotente. Nota: si la transacción de abajo
-- fallara y revirtiera, 'credit' YA quedó agregado (eso es inofensivo y el
-- re-run es no-op). Quitar un valor de enum requiere recrear el tipo — ver
-- la sección de reversión.
-- ============================================================

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'credit';

COMMENT ON TYPE payment_method IS
  'Métodos de pago: cash, card, transfer, addi, credit. '
  '''credit'' marca una venta FIADA (a crédito); el efectivo real entra por '
  'credit_payments, no por la orden.';


-- ============================================================
-- Resto de la migración: atómico (BEGIN/COMMIT). Idempotente.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Extender orders
--    is_credit    : marca la venta como fiada. La excluye del cuadre de caja
--                   (capa de aplicación) y la incluye en la cartera.
--    paid_amount  : Σ de credit_payments. Saldo = total − paid_amount.
--                   SOLO es significativo cuando is_credit=true. En ventas
--                   normales queda en 0 y NO se lee (el cuadre y los reportes
--                   usan total, no paid_amount). Ver nota de "sin backfill".
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_credit boolean NOT NULL DEFAULT false;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0
    CHECK (paid_amount >= 0);

COMMENT ON COLUMN public.orders.is_credit IS
  'true = venta FIADA (a crédito). Se EXCLUYE del cuadre de caja (el efectivo '
  'entra por credit_payments) pero se reconoce completa en reportes. Default '
  'false → las ventas existentes quedan como no-fiadas (sin backfill).';

COMMENT ON COLUMN public.orders.paid_amount IS
  'Suma de los abonos (credit_payments) de la orden. Saldo del fiado = '
  'total − paid_amount. SOLO significativo cuando is_credit=true; en ventas '
  'normales queda 0 y no se consulta.';

-- ------------------------------------------------------------
-- 2. Tabla credit_payments (calco de layaway_payments, 008 + 026)
--    Abonos del fiado: pago inicial ($>0) y posteriores. Inmutables
--    (solo SELECT/INSERT en RLS), imputados al turno por shift_id.
--    is_historical: para cargar fiados VIEJOS cuyo abono se recibió antes
--    (mismo patrón que #3C en separados); no entra al cuadre.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_payments (
  id              uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        uuid           NOT NULL REFERENCES public.orders(id)    ON DELETE RESTRICT,
  store_id        uuid           NOT NULL REFERENCES public.stores(id),
  amount          numeric(12,2)  NOT NULL CHECK (amount > 0),
  payment_method  payment_method NOT NULL,
  created_by      uuid           NOT NULL REFERENCES public.profiles(id),
  -- Turno donde se cobró el abono. NULL para abonos históricos (no entran a caja).
  shift_id        uuid           REFERENCES public.cash_shifts(id) ON DELETE SET NULL,
  is_historical   boolean        NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_payments IS
  'Abonos de ventas fiadas (calco de layaway_payments). El pago inicial y los '
  'posteriores. Suman a orders.paid_amount vía trigger. is_historical=true = '
  'dinero recibido antes de cargar el fiado (no cuenta en caja).';
COMMENT ON COLUMN public.credit_payments.order_id IS
  'Orden fiada. ON DELETE RESTRICT: no se borra una orden con abonos (registro '
  'financiero, mismo criterio que layaway_payments).';
COMMENT ON COLUMN public.credit_payments.is_historical IS
  'true = abono recibido ANTES de cargar el fiado en el sistema; suma al saldo '
  'pero NO cuenta como ingreso de caja (mismo patrón que #3C en separados).';

CREATE INDEX IF NOT EXISTS idx_credit_payments_order_id ON public.credit_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_store_id ON public.credit_payments(store_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_shift_id ON public.credit_payments(shift_id);

-- Índice parcial para la cartera y la exclusión del cuadre: solo órdenes fiadas.
CREATE INDEX IF NOT EXISTS idx_orders_is_credit
  ON public.orders(customer_id) WHERE is_credit;

-- ------------------------------------------------------------
-- 3. Trigger: mantener orders.paid_amount = Σ credit_payments
--    Calco de update_layaway_paid_amount (008), acumula (no recalcula).
--
--    DIFERENCIA con el de layaways: este es SECURITY DEFINER. La política
--    RLS de UPDATE de orders es admin-only (orders_update_admin), mientras
--    que la de layaways es por tienda. Un abono registrado por un VENDEDOR
--    (cobrar una cuota es tarea de caja) dispararía este trigger; sin
--    SECURITY DEFINER, el UPDATE de orders lo bloquearía RLS. Mismo criterio
--    que deduct_stock_on_sale (que escribe con SECURITY DEFINER desde el
--    contexto de un vendedor). El abono NO inserta 'credit' como método.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_order_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
     SET paid_amount = paid_amount + NEW.amount
   WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_order_paid_amount ON public.credit_payments;
CREATE TRIGGER trg_update_order_paid_amount
  AFTER INSERT ON public.credit_payments
  FOR EACH ROW EXECUTE FUNCTION update_order_paid_amount();

-- ------------------------------------------------------------
-- 4. RLS de credit_payments (calco de layaway_payments: SELECT/INSERT
--    por tienda; sin UPDATE/DELETE → registro inmutable).
-- ------------------------------------------------------------
ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_payments_select" ON public.credit_payments;
CREATE POLICY "credit_payments_select"
  ON public.credit_payments FOR SELECT
  USING (store_id = get_my_store_id());

DROP POLICY IF EXISTS "credit_payments_insert" ON public.credit_payments;
CREATE POLICY "credit_payments_insert"
  ON public.credit_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

-- ------------------------------------------------------------
-- 5. Vista credit_balance (cartera, calco de supplier_balance, 012)
--    Por cliente: cuánto debe, cuántos fiados abiertos, total fiado.
--    security_invoker=true → RLS de orders/customers filtra por tienda.
--    Solo cuenta órdenes status='completed' (un fiado cancelado/devuelto no
--    es deuda). LEFT JOIN a todos los clientes (como supplier_balance);
--    el hook/UI filtra pending_amount > 0.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.credit_balance
WITH (security_invoker = true)
AS
SELECT
  c.id        AS customer_id,
  c.store_id,
  c.full_name AS customer_name,
  c.phone,
  COUNT(DISTINCT o.id) FILTER (
    WHERE o.is_credit AND o.status = 'completed' AND o.total > o.paid_amount
  )::integer AS open_credits,
  COALESCE(SUM(o.total) FILTER (
    WHERE o.is_credit AND o.status = 'completed'
  ), 0) AS total_credit_sales,
  COALESCE(SUM(o.total - o.paid_amount) FILTER (
    WHERE o.is_credit AND o.status = 'completed' AND o.total > o.paid_amount
  ), 0) AS pending_amount
FROM public.customers c
LEFT JOIN public.orders o ON o.customer_id = c.id
GROUP BY c.id, c.store_id, c.full_name, c.phone;

COMMENT ON VIEW public.credit_balance IS
  'Cartera de fiados por cliente (calco de supplier_balance). pending_amount = '
  'saldo adeudado en fiados completados. El hook/UI filtra pending_amount > 0.';

-- ------------------------------------------------------------
-- 6. Permiso ventas.fiar → rol Administrador (calco de ventas.regalo, 027)
--    · Dueño: NO se toca ('*' ya lo cubre y es inmutable). Excluido por
--      NOT permissions ? '*'.
--    · Vendedor: NO lleva ventas.fiar.
--    · Idempotente: guard NOT permissions ? 'ventas.fiar'.
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = permissions || '["ventas.fiar"]'::jsonb
 WHERE organization_id = (
         SELECT id FROM public.organizations WHERE name = 'La Bodega del Jeans'
       )
   AND name = 'Administrador'
   AND NOT permissions ? '*'
   AND NOT permissions ? 'ventas.fiar';

-- ------------------------------------------------------------
-- 7. Autoverificación (aborta y revierte TODO si algo no quedó bien)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name = 'La Bodega del Jeans';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No existe la organización ''La Bodega del Jeans'' (¿se aplicó la 020?).';
  END IF;

  -- Administrador DEBE tener ventas.fiar
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Administrador'
       AND permissions ? 'ventas.fiar'
  ) THEN
    RAISE EXCEPTION 'Administrador no quedó con ventas.fiar (¿existe el rol? ¿se aplicaron 021/023?).';
  END IF;

  -- Vendedor NO debe tener ventas.fiar
  IF EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Vendedor'
       AND permissions ? 'ventas.fiar'
  ) THEN
    RAISE EXCEPTION 'El Vendedor NO debe tener ventas.fiar, pero lo tiene.';
  END IF;

  -- Dueño intacto (comodín)
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Dueño'
       AND permissions ? '*'
  ) THEN
    RAISE EXCEPTION 'El rol Dueño no quedó con el comodín ''*'' (no debió tocarse).';
  END IF;

  RAISE NOTICE '029 OK: orders.is_credit/paid_amount + credit_payments + trigger + credit_balance; ventas.fiar → Administrador. Vendedor y Dueño intactos.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Enum:
--      SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
--       WHERE t.typname='payment_method' ORDER BY e.enumsortorder;
--      -- cash, card, transfer, addi, credit
--
-- 2. Columnas de orders:
--      SELECT column_name, data_type, column_default, is_nullable
--        FROM information_schema.columns
--       WHERE table_name='orders' AND column_name IN ('is_credit','paid_amount');
--      -- is_credit boolean/false/NOT NULL ; paid_amount numeric/0/NOT NULL
--
-- 3. Sin backfill: todas las órdenes existentes quedan is_credit=false, paid_amount=0.
--      SELECT is_credit, count(*) FROM public.orders GROUP BY is_credit;
--
-- 4. Trigger suma al saldo (smoke test en BEGIN...ROLLBACK):
--      -- Crear una orden is_credit=true total 100000, insertar credit_payment 30000,
--      -- confirmar orders.paid_amount=30000 y saldo=70000. ROLLBACK.
--
-- 5. Permisos por rol:
--      SELECT name, permissions ? 'ventas.fiar' AS tiene_fiar
--        FROM public.roles ORDER BY name;
--      -- Administrador: true · Vendedor: false · Dueño: false (lo cubre '*')
--
-- 6. has_permission() por rol (autenticado como cada uno):
--      SELECT has_permission('ventas.fiar');
--      -- Administrador → true · Vendedor → false · Dueño → true (comodín)
--
-- 7. Cartera:
--      SELECT * FROM public.credit_balance WHERE pending_amount > 0;


-- ============================================================
-- REVERSIÓN
-- ============================================================
-- Nota: si ya hay fiados cargados (orders.is_credit=true o filas en
-- credit_payments), la reversión PIERDE esos datos y su trazabilidad.
-- Revisar antes:
--   SELECT count(*) FROM public.credit_payments;                 -- debe ser 0
--   SELECT count(*) FROM public.orders WHERE is_credit;          -- debe ser 0
--
-- BEGIN;
--   DROP VIEW IF EXISTS public.credit_balance;
--   DROP TRIGGER IF EXISTS trg_update_order_paid_amount ON public.credit_payments;
--   DROP FUNCTION IF EXISTS update_order_paid_amount();
--   DROP TABLE IF EXISTS public.credit_payments;   -- (RLS y policies caen con la tabla)
--   DROP INDEX IF EXISTS public.idx_orders_is_credit;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS paid_amount;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS is_credit;
--   UPDATE public.roles SET permissions = permissions - 'ventas.fiar'
--    WHERE name = 'Administrador' AND NOT permissions ? '*';
-- COMMIT;
--
-- El valor de enum 'credit' NO se puede quitar con DROP VALUE (no existe en
-- Postgres). Para eliminarlo habría que recrear el tipo payment_method sin
-- 'credit' y migrar todas las columnas que lo usan (orders, layaway_payments,
-- supplier_payments, credit_payments) — patrón de la 006. En la práctica se
-- deja 'credit' en el enum (inofensivo si no se usa).
-- ============================================================
