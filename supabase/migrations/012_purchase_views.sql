-- ============================================================
-- 012 — Vistas de reportes para compras y proveedores
--
-- security_invoker = true → las políticas RLS de purchase_invoices
-- y suppliers filtran automáticamente por la tienda del usuario.
-- ============================================================


-- ── Vista 1: purchase_summary ────────────────────────────────────────────────
-- Compras agregadas por mes y proveedor. Excluye facturas canceladas.
CREATE OR REPLACE VIEW public.purchase_summary
WITH (security_invoker = true)
AS
SELECT
  i.store_id,
  i.supplier_id,
  s.name AS supplier_name,
  date_trunc('month', i.invoice_date)::date AS month,
  COUNT(DISTINCT i.id)::integer AS invoice_count,
  COALESCE(SUM(i.total), 0) AS total_purchased,
  COALESCE(SUM(i.paid_amount), 0) AS total_paid,
  COALESCE(SUM(i.total - i.paid_amount), 0) AS total_pending
FROM public.purchase_invoices i
JOIN public.suppliers s ON s.id = i.supplier_id
WHERE i.status != 'cancelled'
GROUP BY i.store_id, i.supplier_id, s.name,
         date_trunc('month', i.invoice_date);

COMMENT ON VIEW public.purchase_summary IS
  'Compras por mes y proveedor. Excluye facturas canceladas.';


-- ── Vista 2: supplier_balance ────────────────────────────────────────────────
-- Saldo consolidado por proveedor (activos e inactivos). Una deuda es deuda
-- aunque el proveedor esté inactivo: no se filtra por is_active aquí. El filtro
-- is_active solo aplica al listado de proveedores del tab Proveedores.
CREATE OR REPLACE VIEW public.supplier_balance
WITH (security_invoker = true)
AS
SELECT
  s.id AS supplier_id,
  s.store_id,
  s.name AS supplier_name,
  s.nit,
  COUNT(DISTINCT i.id) FILTER (
    WHERE i.status IN ('pending', 'partial')
  )::integer AS open_invoices,
  COALESCE(SUM(i.total) FILTER (
    WHERE i.status != 'cancelled'
  ), 0) AS total_purchased,
  COALESCE(SUM(i.total - i.paid_amount) FILTER (
    WHERE i.status IN ('pending', 'partial')
  ), 0) AS pending_amount,
  COUNT(DISTINCT i.id) FILTER (
    WHERE i.status IN ('pending', 'partial')
      AND i.due_date < CURRENT_DATE
  )::integer AS overdue_invoices
FROM public.suppliers s
LEFT JOIN public.purchase_invoices i ON i.supplier_id = s.id
GROUP BY s.id, s.store_id, s.name, s.nit;

COMMENT ON VIEW public.supplier_balance IS
  'Saldo consolidado por proveedor (activos e inactivos). Útil para cuentas por pagar.';
