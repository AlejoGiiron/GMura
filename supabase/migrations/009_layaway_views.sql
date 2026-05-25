-- ============================================================
-- 009 — Vistas de reportes para separados
--
-- security_invoker = true → las políticas RLS de layaways y
-- customers filtran automáticamente por la tienda del usuario.
-- ============================================================


-- ── Vista 1: layaway_summary ─────────────────────────────────────────────────
-- Resumen agrupado por tienda y estado. Útil para KPIs del dashboard.
CREATE OR REPLACE VIEW public.layaway_summary
WITH (security_invoker = true)
AS
SELECT
  l.store_id,
  l.status,
  COUNT(DISTINCT l.id)::integer            AS layaway_count,
  COALESCE(SUM(l.total), 0)                AS total_amount,
  COALESCE(SUM(l.paid_amount), 0)          AS paid_amount,
  COALESCE(SUM(l.total - l.paid_amount), 0) AS pending_amount
FROM public.layaways l
GROUP BY l.store_id, l.status;

COMMENT ON VIEW public.layaway_summary IS
  'Resumen de separados por tienda y estado. Útil para dashboard de reportes.';


-- ── Vista 2: layaway_expiring_soon ───────────────────────────────────────────
-- Separados activos que vencen en los próximos 7 días, ordenados por
-- proximidad de vencimiento.
CREATE OR REPLACE VIEW public.layaway_expiring_soon
WITH (security_invoker = true)
AS
SELECT
  l.id,
  l.layaway_number,
  l.store_id,
  l.customer_id,
  c.full_name AS customer_name,
  c.phone     AS customer_phone,
  l.total,
  l.paid_amount,
  (l.total - l.paid_amount) AS pending_amount,
  l.expires_at,
  EXTRACT(day FROM (l.expires_at - now()))::integer AS days_until_expiry
FROM public.layaways l
JOIN public.customers c ON c.id = l.customer_id
WHERE l.status = 'active'
  AND l.expires_at BETWEEN now() AND now() + interval '7 days';

COMMENT ON VIEW public.layaway_expiring_soon IS
  'Separados activos que vencen en los próximos 7 días, ordenados ASC.';
