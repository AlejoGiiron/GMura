-- ============================================================
-- G-Mura POS — Vistas de reportes
-- Migración: 003_reports_views.sql
-- ============================================================
-- Todas las vistas usan security_invoker = true para que las
-- políticas RLS de las tablas base filtren automáticamente
-- por la tienda del usuario autenticado.
-- ============================================================


-- ── Vista 1: daily_sales_summary ─────────────────────────────────────────────
-- Agrega ventas completadas por día (zona América/Bogotá) y método de pago.
-- La subconsulta de items evita duplicar subtotales al hacer el JOIN.

CREATE OR REPLACE VIEW public.daily_sales_summary
WITH (security_invoker = true)
AS
SELECT
  o.store_id,
  (o.created_at AT TIME ZONE 'America/Bogota')::date         AS sale_date,
  o.payment_method,
  COUNT(DISTINCT o.id)::integer                              AS order_count,
  COALESCE(SUM(items.qty_total), 0)::integer                 AS items_sold,
  SUM(o.subtotal)                                            AS subtotal_sum,
  SUM(o.discount)                                            AS discount_sum,
  SUM(o.total)                                               AS total_sum,
  CASE
    WHEN COUNT(DISTINCT o.id) > 0
      THEN SUM(o.total) / COUNT(DISTINCT o.id)
    ELSE 0
  END                                                        AS avg_ticket
FROM public.orders o
LEFT JOIN (
  SELECT order_id, SUM(qty) AS qty_total
  FROM   public.order_items
  GROUP  BY order_id
) items ON items.order_id = o.id
WHERE o.status = 'completed'
GROUP BY o.store_id, sale_date, o.payment_method;

COMMENT ON VIEW public.daily_sales_summary IS
  'Ventas completadas agrupadas por día (zona Bogotá) y método de pago. '
  'RLS de orders filtra automáticamente por tienda del usuario.';


-- ── Vista 2: product_performance ─────────────────────────────────────────────
-- Desempeño histórico de cada variante activa: unidades vendidas, ingresos
-- brutos y netos tras descontar devoluciones completadas.

CREATE OR REPLACE VIEW public.product_performance
WITH (security_invoker = true)
AS
SELECT
  v.id                                                                      AS variant_id,
  v.product_id,
  p.name                                                                    AS product_name,
  p.brand,
  c.name                                                                    AS category_name,
  v.size,
  v.color,
  v.sku,
  v.barcode,
  v.store_id,
  COALESCE(s.units_sold,   0)::integer                                     AS units_sold,
  COALESCE(s.revenue,      0)                                              AS revenue,
  COALESCE(r.return_units, 0)::integer                                     AS return_units,
  (COALESCE(s.units_sold, 0) - COALESCE(r.return_units, 0))::integer      AS net_units,
  COALESCE(s.revenue, 0) - COALESCE(r.return_revenue, 0)                  AS net_revenue
FROM public.variants v
JOIN  public.products    p ON p.id = v.product_id
LEFT JOIN public.categories c ON c.id = p.category_id
LEFT JOIN (
  -- Ventas por variante (sólo órdenes completadas)
  SELECT
    oi.variant_id,
    SUM(oi.qty)::integer                          AS units_sold,
    SUM(oi.qty::numeric * oi.unit_price)          AS revenue
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.status = 'completed'
  GROUP BY oi.variant_id
) s ON s.variant_id = v.id
LEFT JOIN (
  -- Devoluciones por variante (sólo devoluciones completadas)
  SELECT
    ri.variant_id,
    SUM(ri.qty)::integer                          AS return_units,
    SUM(ri.qty::numeric * ri.unit_price)          AS return_revenue
  FROM public.return_items ri
  JOIN public.returns ret ON ret.id = ri.return_id
  WHERE ret.status = 'completed'
  GROUP BY ri.variant_id
) r ON r.variant_id = v.id;

COMMENT ON VIEW public.product_performance IS
  'Desempeño histórico de variantes: unidades vendidas, ingresos brutos y netos '
  'tras devoluciones completadas. Filtrado por tienda via RLS de variants y orders.';


-- ── Vista 3: inventory_status ─────────────────────────────────────────────────
-- Estado actual del inventario por variante activa, con valor de stock
-- y clasificación: out (sin stock), low (stock ≤ min_stock), ok.

CREATE OR REPLACE VIEW public.inventory_status
WITH (security_invoker = true)
AS
SELECT
  v.id                                                        AS variant_id,
  v.product_id,
  p.name                                                      AS product_name,
  p.brand,
  c.name                                                      AS category_name,
  v.size,
  v.color,
  v.sku,
  v.barcode,
  v.store_id,
  v.stock_qty,
  v.min_stock,
  v.price,
  v.cost_price,
  COALESCE(v.stock_qty::numeric * v.cost_price, 0)           AS stock_value,
  CASE
    WHEN v.stock_qty  = 0             THEN 'out'
    WHEN v.stock_qty <= v.min_stock   THEN 'low'
    ELSE                                   'ok'
  END::text                                                   AS stock_state
FROM public.variants v
JOIN  public.products    p ON p.id = v.product_id
LEFT JOIN public.categories c ON c.id = p.category_id
WHERE v.is_active = true;

COMMENT ON VIEW public.inventory_status IS
  'Estado actual del inventario por variante activa. '
  'stock_state: out = sin stock, low = stock ≤ min_stock, ok = stock suficiente. '
  'stock_value = stock_qty × cost_price (0 si cost_price es NULL).';


-- ── Vista 4: returns_summary ──────────────────────────────────────────────────
-- Resumen de devoluciones completadas por día y tipo (return | exchange).
-- refund_amount sólo suma ítems con action = 'refund' (no los cambios).

CREATE OR REPLACE VIEW public.returns_summary
WITH (security_invoker = true)
AS
SELECT
  ret.store_id,
  (ret.created_at AT TIME ZONE 'America/Bogota')::date       AS return_date,
  ret.type                                                    AS return_type,
  COUNT(DISTINCT ret.id)::integer                            AS return_count,
  COALESCE(SUM(ri.qty_total), 0)::integer                   AS items_returned,
  COALESCE(SUM(ri.refund_amount), 0)                        AS refund_amount
FROM public.returns ret
LEFT JOIN (
  SELECT
    return_id,
    SUM(qty)                                                                    AS qty_total,
    SUM(CASE WHEN action = 'refund' THEN qty::numeric * unit_price ELSE 0 END) AS refund_amount
  FROM public.return_items
  GROUP BY return_id
) ri ON ri.return_id = ret.id
WHERE ret.status = 'completed'
GROUP BY ret.store_id, return_date, ret.type;

COMMENT ON VIEW public.returns_summary IS
  'Devoluciones completadas agrupadas por día (zona Bogotá) y tipo. '
  'refund_amount acumula sólo los ítems con action = refund; '
  'los ítems de cambio (exchange) cuentan en items_returned pero no en refund_amount.';
