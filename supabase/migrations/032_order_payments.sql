-- ============================================================
-- 032 — Pagos MIXTOS, Fase 1: tabla order_payments + backfill
--
-- OBJETIVO DE ESTA FASE (solo schema): permitir que una venta se pague con
-- VARIOS métodos (ej. $50.000 efectivo + $30.000 tarjeta). Hoy orders guarda
-- UN solo payment_method para todo el total. Esta migración agrega la tabla
-- hija order_payments (una fila por método+monto) y backfillea las ventas
-- existentes, SIN cambiar todavía ningún lector (cuadre/reportes) ni la UI.
--
-- Tras esta migración TODO sigue funcionando igual: orders.payment_method se
-- mantiene intacto y los lectores actuales lo siguen usando. Las fases 2 y 3
-- migran los lectores (cuadre, reportes) a leer desde order_payments ANTES de
-- que la fase 4 (POS) empiece a generar pagos mixtos, para que ninguna fase
-- intermedia rompa el cuadre.
--
-- MODELO — order_payments calca a ORDER_ITEMS, no a los abonos:
--   · Es un hijo de la orden escrito ATÓMICAMENTE con ella (mismo store, misma
--     vida). Por eso ON DELETE CASCADE (no RESTRICT como layaway_payments/
--     credit_payments): si la orden se borra —solo pasa en el rollback de
--     useCreateOrder ante un fallo— sus pagos se borran con ella, igual que
--     order_items.
--   · NO lleva created_by ni shift_id: los hereda de la orden (orders.created_by,
--     orders.shift_id). Los abonos SÍ los llevan porque llegan en momentos y
--     turnos distintos a la creación del separado/fiado; un order_payment nace
--     siempre junto a su orden.
--   · SÍ denormaliza store_id (como las tablas de pago hermanas) para que la
--     RLS sea una igualdad simple store_id = get_my_store_id() y la Fase 2
--     pueda filtrarla igual que a orders/layaway_payments/credit_payments.
--   · method NO admite 'credit': fiar es un flujo aparte (el efectivo del fiado
--     entra por credit_payments). CHECK (method <> 'credit') lo impide.
--
-- BACKFILL — de las órdenes existentes:
--   · Solo órdenes NO fiadas (is_credit = false) con total > 0.
--   · Una fila (order_id, store_id, payment_method, total) por orden.
--   · FIADOS EXCLUIDOS: su dinero NO entra por un pago directo de la orden sino
--     por credit_payments; backfillear su total como order_payment lo
--     doble-contaría. Un fiado queda con CERO filas en order_payments (su pago
--     ya vive en credit_payments), consistente con cómo el cuadre ya excluye
--     las órdenes is_credit y lee sus abonos aparte.
--   · total = 0 excluido: el CHECK (amount > 0) lo rechazaría y una venta de $0
--     no aportó efectivo; queda con cero filas y la paridad se cumple (0 = 0).
--   · INVARIANTE verificada abajo: para toda orden no-fiada, Σ order_payments =
--     orders.total. El backfill no pierde ni inventa plata → cuadre idéntico.
--
-- orders.payment_method: se MANTIENE sin cambios en esta fase. No se agrega el
--   valor 'mixed' al enum todavía: como las fases 2-3 migran los lectores antes
--   de que la fase 4 genere mixtos, durante 1-3 toda orden sigue siendo de un
--   solo método y payment_method sigue siendo fiel. La decisión sobre 'mixed'
--   (o un "método primario" denormalizado por trigger) se toma en la fase 4.
--
-- Requiere: 001 (orders + order_items), 029 (orders.is_credit).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 032_order_payments.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Tabla order_payments (calco estructural de order_items)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_payments (
  id             uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id       uuid           NOT NULL REFERENCES public.orders(id)  ON DELETE CASCADE,
  store_id       uuid           NOT NULL REFERENCES public.stores(id),
  method         payment_method NOT NULL,
  amount         numeric(12,2)  NOT NULL CHECK (amount > 0),
  created_at     timestamptz    NOT NULL DEFAULT now(),

  -- Fiar es un flujo aparte: el efectivo del fiado entra por credit_payments,
  -- nunca como un pago directo de la orden. 'credit' no cabe aquí.
  CONSTRAINT order_payments_method_not_credit CHECK (method <> 'credit')
);

COMMENT ON TABLE public.order_payments IS
  'Pagos de una venta directa, uno por método (pagos mixtos). Hijo de orders '
  'escrito atómicamente con ella (calco de order_items): ON DELETE CASCADE, sin '
  'created_by/shift_id (los hereda de la orden). Σ amount por orden = orders.total '
  'para órdenes no fiadas. Los fiados NO tienen filas aquí (su dinero entra por '
  'credit_payments).';
COMMENT ON COLUMN public.order_payments.order_id IS
  'Orden pagada. ON DELETE CASCADE: los pagos son parte de la orden (como '
  'order_items); si la orden se borra —solo en el rollback de useCreateOrder— '
  'se borran con ella.';
COMMENT ON COLUMN public.order_payments.store_id IS
  'Denormalizado desde la orden (como layaway_payments/credit_payments) para una '
  'RLS por igualdad simple. Write-once: se setea = orders.store_id al insertar.';
COMMENT ON COLUMN public.order_payments.method IS
  'Método de este pago. cash/card/transfer/addi. NUNCA credit (ver CHECK).';

-- ------------------------------------------------------------
-- 2. Índices (calco de order_items / *_payments)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON public.order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_store_id ON public.order_payments(store_id);

-- ------------------------------------------------------------
-- 3. RLS (calco de layaway_payments/credit_payments: SELECT/INSERT por tienda;
--    sin UPDATE/DELETE directos → registro inmutable). El borrado en CASCADE
--    desde orders no pasa por estas políticas (lo aplica la FK, no DML directo),
--    así que el rollback de useCreateOrder sigue funcionando.
-- ------------------------------------------------------------
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_payments_select" ON public.order_payments;
CREATE POLICY "order_payments_select"
  ON public.order_payments FOR SELECT
  USING (store_id = get_my_store_id());

DROP POLICY IF EXISTS "order_payments_insert" ON public.order_payments;
CREATE POLICY "order_payments_insert"
  ON public.order_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id());

-- ------------------------------------------------------------
-- 4. Backfill de las órdenes existentes
--    Una fila por orden NO fiada con total > 0. Idempotente: el NOT EXISTS
--    evita duplicar si la migración se re-corre.
-- ------------------------------------------------------------
INSERT INTO public.order_payments (order_id, store_id, method, amount)
SELECT o.id, o.store_id, o.payment_method, o.total
  FROM public.orders o
 WHERE o.is_credit = false
   AND o.total > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.order_payments op WHERE op.order_id = o.id
   );

-- ------------------------------------------------------------
-- 5. Autoverificación de PARIDAD (aborta y revierte TODO si algo no cuadra).
--    Con ON_ERROR_STOP=1 (lab-apply) esto hace fallar la aplicación en vez de
--    dejar un backfill silenciosamente incorrecto.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_bad_parity   integer;
  v_credit_rows  integer;
  v_missing      integer;
BEGIN
  -- (a) PARIDAD: ninguna orden no-fiada con total > 0 puede tener
  --     Σ order_payments distinto de su total. LEFT JOIN + COALESCE cubre el
  --     caso de total = 0 (0 filas → suma 0 = total 0), que aquí ya excluimos.
  SELECT count(*) INTO v_bad_parity
    FROM public.orders o
    LEFT JOIN (
      SELECT order_id, SUM(amount) AS paid
        FROM public.order_payments
       GROUP BY order_id
    ) p ON p.order_id = o.id
   WHERE o.is_credit = false
     AND o.total > 0
     AND COALESCE(p.paid, 0) <> o.total;
  IF v_bad_parity > 0 THEN
    RAISE EXCEPTION
      'Backfill de order_payments SIN PARIDAD: % órdenes no-fiadas donde Σ pagos <> total.',
      v_bad_parity;
  END IF;

  -- (b) Ningún fiado debe tener filas en order_payments (su dinero va por
  --     credit_payments; una fila aquí sería doble conteo).
  SELECT count(*) INTO v_credit_rows
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
   WHERE o.is_credit = true;
  IF v_credit_rows > 0 THEN
    RAISE EXCEPTION
      'order_payments tiene % filas ligadas a órdenes FIADAS (no debería haber ninguna).',
      v_credit_rows;
  END IF;

  -- (c) Ninguna orden "cobrable" (no fiada, total > 0, completada) debe quedar
  --     sin pago tras el backfill.
  SELECT count(*) INTO v_missing
    FROM public.orders o
   WHERE o.is_credit = false
     AND o.total > 0
     AND o.status = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.order_payments op WHERE op.order_id = o.id
     );
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      '% órdenes cobrables quedaron SIN pago en order_payments tras el backfill.',
      v_missing;
  END IF;

  RAISE NOTICE
    '032 OK: order_payments creada + backfill con paridad. Fiados excluidos (0 filas), sin órdenes cobrables sin pago.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar en el lab)
-- ============================================================
-- 1. Estructura de la tabla:
--      \d+ public.order_payments
--
-- 2. PARIDAD global (debe devolver 0 filas = todo cuadra):
--      SELECT o.id, o.total, COALESCE(SUM(op.amount), 0) AS paid
--        FROM public.orders o
--        LEFT JOIN public.order_payments op ON op.order_id = o.id
--       WHERE o.is_credit = false AND o.total > 0
--       GROUP BY o.id, o.total
--      HAVING COALESCE(SUM(op.amount), 0) <> o.total;
--
-- 3. Fiados sin pagos directos (debe devolver 0):
--      SELECT count(*) FROM public.order_payments op
--        JOIN public.orders o ON o.id = op.order_id
--       WHERE o.is_credit;
--
-- 4. Conteo: filas backfilleadas vs órdenes cobrables (deben coincidir):
--      SELECT
--        (SELECT count(*) FROM public.order_payments)                       AS filas_pago,
--        (SELECT count(*) FROM public.orders
--          WHERE is_credit = false AND total > 0)                           AS ordenes_cobrables;
--
-- 5. RLS activa:
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'order_payments'; -- t
--      SELECT polname FROM pg_policy
--        WHERE polrelid = 'public.order_payments'::regclass;                 -- select + insert


-- ============================================================
-- REVERSIÓN
-- ============================================================
-- order_payments es aditiva y NO se lee todavía (fase 1). Revertir es seguro
-- mientras no se hayan migrado los lectores (fases 2-3) ni generado mixtos:
--
--   BEGIN;
--     DROP TABLE IF EXISTS public.order_payments;  -- RLS, policies, índices y
--                                                  -- el backfill caen con la tabla
--   COMMIT;
--
-- orders.payment_method no se tocó, así que al soltar la tabla el sistema queda
-- exactamente como antes de la 032.
-- ============================================================
