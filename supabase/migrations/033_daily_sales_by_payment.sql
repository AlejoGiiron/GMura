-- ============================================================
-- 033 — Pagos MIXTOS, Fase 3: daily_sales_summary por order_payments
--
-- OBJETIVO: que el desglose de ventas por método del reporte refleje pagos
-- MIXTOS. Hoy la vista agrupa por orders.payment_method (un método por orden);
-- con la 032 una venta puede repartirse en varios métodos, así que el dinero
-- debe agruparse desde order_payments.
--
-- PARIDAD (como la Fase 2): para datos de un solo método el reporte da EXACTO lo
-- mismo. Una venta de un método tiene UNA fila en order_payments (amount = total)
-- → agrupar por order_payments.method == agrupar por payment_method. Una venta
-- MIXTA reparte su total entre sus métodos.
--
-- EL RETO — dos granos en una misma vista:
--   · DINERO (total_sum): por método, repartido desde order_payments. La suma
--     del día = Σ order_payments = Σ totales de órdenes → NO se infla.
--   · MÉTRICAS POR-ORDEN (order_count, items_sold, subtotal_sum, discount_sum):
--     no tienen sentido "por método". Si se sumaran en cada fila de método, una
--     venta mixta se contaría 2 veces al totalizar el día. Solución: se atribuyen
--     SOLO a la fila del MÉTODO PRIMARIO de la orden (el pago de mayor monto), de
--     modo que sumar across-métodos cuenta cada orden UNA vez. Para una orden de
--     un solo método, ese método ES el primario → paridad exacta.
--
-- FIADOS y ventas total=0 (sin filas en order_payments, 032):
--   La vista de HOY los INCLUYE (no filtra is_credit): un fiado aparece como
--   payment_method='credit' con su total (revenue reconocido al vender, diseño
--   029); una venta $0 aparece con total_sum=0. Se PRESERVA esa semántica: la
--   rama NOT EXISTS del CTE order_split captura esas órdenes usando su
--   orders.payment_method + total, así siguen apareciendo idénticas.
--
-- Contrato de columnas SIN cambios (mismo nombre/tipo/orden que la 003), así que
-- useReports/ReportsPage NO requieren cambios. avg_ticket se conserva aunque
-- ningún consumidor lo use (los consumidores calculan su propio promedio).
--
-- Se usa DROP + CREATE (no CREATE OR REPLACE) para no chocar con el chequeo de
-- tipos de columna de OR REPLACE; idempotente por el IF EXISTS. La vista es hoja
-- (ninguna otra vista/función depende de ella).
--
-- Requiere: 003 (vista original), 032 (order_payments + backfill).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 033_daily_sales_by_payment.sql
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS public.daily_sales_summary;

CREATE VIEW public.daily_sales_summary
WITH (security_invoker = true)
AS
WITH order_split AS (
  -- Un "pago" por (orden, método). Las ventas directas se reparten por
  -- order_payments (032); fiados y ventas total=0 (sin filas en order_payments)
  -- caen a orders.payment_method con su total, preservando la vista anterior.
  -- Las ramas son mutuamente excluyentes (una orden tiene filas o no las tiene).
  SELECT op.order_id, op.method, op.amount
    FROM public.order_payments op
  UNION ALL
  SELECT o.id, o.payment_method, o.total
    FROM public.orders o
   WHERE o.status = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.order_payments op WHERE op.order_id = o.id
     )
),
order_meta AS (
  -- Una fila por orden completada: día (zona Bogotá), metadatos por-orden y su
  -- método primario (el pago de mayor monto; desempate estable por método). La
  -- subconsulta de items evita duplicar al contar unidades.
  SELECT
    o.id,
    o.store_id,
    (o.created_at AT TIME ZONE 'America/Bogota')::date AS sale_date,
    o.subtotal,
    o.discount,
    COALESCE(items.qty_total, 0) AS items_qty,
    (
      SELECT s.method FROM order_split s
       WHERE s.order_id = o.id
       ORDER BY s.amount DESC, s.method
       LIMIT 1
    ) AS primary_method
  FROM public.orders o
  LEFT JOIN (
    SELECT order_id, SUM(qty) AS qty_total
    FROM   public.order_items
    GROUP  BY order_id
  ) items ON items.order_id = o.id
  WHERE o.status = 'completed'
)
SELECT
  om.store_id,
  om.sale_date,
  s.method AS payment_method,
  -- Métricas por-orden: SOLO en la fila del método primario → sumar entre
  -- métodos cuenta cada venta (incl. mixta) una sola vez.
  COUNT(*) FILTER (WHERE s.method = om.primary_method)::integer            AS order_count,
  COALESCE(SUM(om.items_qty) FILTER (WHERE s.method = om.primary_method), 0)::integer AS items_sold,
  COALESCE(SUM(om.subtotal)  FILTER (WHERE s.method = om.primary_method), 0)          AS subtotal_sum,
  COALESCE(SUM(om.discount)  FILTER (WHERE s.method = om.primary_method), 0)          AS discount_sum,
  -- Dinero: SIEMPRE repartido por método (order_payments / fiado como credit).
  SUM(s.amount)                                                            AS total_sum,
  CASE
    WHEN COUNT(*) FILTER (WHERE s.method = om.primary_method) > 0
      THEN SUM(s.amount) / COUNT(*) FILTER (WHERE s.method = om.primary_method)
    ELSE 0
  END                                                                      AS avg_ticket
FROM order_meta om
JOIN order_split s ON s.order_id = om.id
GROUP BY om.store_id, om.sale_date, s.method;

COMMENT ON VIEW public.daily_sales_summary IS
  'Ventas completadas por día (zona Bogotá) y método de pago. El DINERO se '
  'reparte por order_payments (pagos mixtos, 032); las métricas por-orden '
  '(order_count, items_sold, subtotal_sum, discount_sum) se atribuyen al método '
  'PRIMARIO de cada orden para no duplicar al totalizar el día. Fiados y ventas '
  '$0 (sin order_payments) caen a orders.payment_method con su total, igual que '
  'antes. RLS de las tablas base filtra por tienda.';

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar en el lab)
-- ============================================================
-- 1. El total del día NO se infla ni se pierde (Σ total_sum de la vista =
--    Σ total de órdenes completadas). Debe devolver 0 filas descuadradas:
--      SELECT v.sale_date, v.store_id, v.tv, o.to_
--        FROM (SELECT store_id, sale_date, SUM(total_sum) tv
--                FROM public.daily_sales_summary GROUP BY store_id, sale_date) v
--        JOIN (SELECT store_id, (created_at AT TIME ZONE 'America/Bogota')::date d,
--                     SUM(total) to_
--                FROM public.orders WHERE status='completed'
--               GROUP BY store_id, d) o
--          ON o.store_id=v.store_id AND o.d=v.sale_date
--       WHERE v.tv <> o.to_;
--
-- 2. order_count del día = número de órdenes completadas del día (sin duplicar):
--      -- Σ order_count por día debe igualar COUNT de órdenes completadas del día.
--
-- 3. Fiados presentes como 'credit' (revenue preservado):
--      SELECT payment_method, SUM(total_sum) FROM public.daily_sales_summary
--       WHERE payment_method='credit' GROUP BY payment_method;


-- ============================================================
-- REVERSIÓN — restaura la vista de la 003 (agrupa por orders.payment_method)
-- ============================================================
-- BEGIN;
--   DROP VIEW IF EXISTS public.daily_sales_summary;
--   CREATE VIEW public.daily_sales_summary WITH (security_invoker = true) AS
--   SELECT
--     o.store_id,
--     (o.created_at AT TIME ZONE 'America/Bogota')::date AS sale_date,
--     o.payment_method,
--     COUNT(DISTINCT o.id)::integer               AS order_count,
--     COALESCE(SUM(items.qty_total), 0)::integer  AS items_sold,
--     SUM(o.subtotal)                             AS subtotal_sum,
--     SUM(o.discount)                             AS discount_sum,
--     SUM(o.total)                                AS total_sum,
--     CASE WHEN COUNT(DISTINCT o.id) > 0 THEN SUM(o.total) / COUNT(DISTINCT o.id)
--          ELSE 0 END                             AS avg_ticket
--   FROM public.orders o
--   LEFT JOIN (SELECT order_id, SUM(qty) AS qty_total FROM public.order_items GROUP BY order_id) items
--     ON items.order_id = o.id
--   WHERE o.status = 'completed'
--   GROUP BY o.store_id, sale_date, o.payment_method;
-- COMMIT;
-- ============================================================
