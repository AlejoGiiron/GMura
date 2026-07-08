-- ============================================================
-- 030 — Gating server-side de FIADOS (ventas.fiar en orders_insert)
--
-- Endurecimiento: que NO se pueda crear una orden fiada (is_credit=true) vía
-- API sin el permiso ventas.fiar, aunque alguien saltee la UI.
--
-- Enfoque (el más robusto y menos invasivo): ampliar el WITH CHECK de la
-- política de INSERT de orders. Una venta normal (is_credit=false) sigue
-- pidiendo solo pos.usar; una fiada exige ADEMÁS ventas.fiar. Declarativo,
-- sin RPC, y la mutation del cliente no cambia.
--
-- Requiere: 024 (orders_insert con has_permission('pos.usar')) y 029
-- (orders.is_credit). Idempotente: DROP POLICY IF EXISTS + CREATE.
--
-- NOTA: los credit_payments (abonos) NO se gatean con ventas.fiar: cobrar una
-- cuota es tarea de caja de cualquier usuario de la tienda (su policy de 029
-- sigue siendo solo por store_id).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 030_credit_order_rls.sql
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS orders_insert ON public.orders;
CREATE POLICY orders_insert ON public.orders FOR INSERT
  WITH CHECK (
    store_id = get_my_store_id()
    AND has_permission('pos.usar')
    -- Fiar (is_credit=true) exige ventas.fiar; venta normal no se ve afectada.
    AND (NOT is_credit OR has_permission('ventas.fiar'))
  );

COMMENT ON POLICY orders_insert ON public.orders IS
  'INSERT de ventas: requiere pos.usar; si is_credit=true (fiado) requiere '
  'además ventas.fiar. Filtra por tienda del usuario.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.orders'::regclass AND polname = 'orders_insert'
  ) THEN
    RAISE EXCEPTION '030: no quedó la política orders_insert.';
  END IF;
  RAISE NOTICE '030 OK: orders_insert exige ventas.fiar para órdenes fiadas.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. La política incluye la rama de ventas.fiar:
--      SELECT pg_get_expr(polwithcheck, polrelid)
--        FROM pg_policy WHERE polrelid='public.orders'::regclass AND polname='orders_insert';
--      -- ... AND (NOT is_credit OR has_permission('ventas.fiar'))
--
-- 2. En contexto de un VENDEDOR sin ventas.fiar (SET ROLE authenticated +
--    request.jwt.claims): un INSERT con is_credit=true debe FALLAR por RLS;
--    con is_credit=false debe pasar (si tiene pos.usar).
--
-- 3. En contexto de un ADMIN con ventas.fiar: el INSERT is_credit=true pasa.


-- ============================================================
-- REVERSIÓN (vuelve a la política de 024, sin el gate de fiar)
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS orders_insert ON public.orders;
--   CREATE POLICY orders_insert ON public.orders FOR INSERT
--     WITH CHECK (store_id = get_my_store_id() AND has_permission('pos.usar'));
-- COMMIT;
