-- ============================================================
-- Tests de la 044 — venta neta + informes de planificación
--
-- Correr en el LAB, con la 044 YA aplicada:
--   ./scripts/lab-apply-migration.sh supabase/tests/044_purchase_planning_reports.test.sql
--
-- Fixtures propios (una organización, dos tiendas y dos usuarios inventados)
-- dentro de una transacción que termina en ROLLBACK: no deja NADA en la base.
-- Si un caso falla, RAISE EXCEPTION con el caso en el mensaje y psql corta.
--
-- Casos de la definición de venta neta (reporting.net_sales_lines):
--   01 venta normal con descuento ya bajado al unit_price → factor 1
--   02 descuento de orden SIN repartir → se prorratea entre los ítems
--   03 regalo → 1 unidad, $0
--   04 fiado → cuenta
--   05 conversión de separado → cuenta
--   06 cancelada → fuera
--   07 devolución de una venta de ANTES del período → se resta en la fecha de
--      la devolución; la venta original no aparece
--   08 ítem nuevo del cambio → cuenta a precio completo, SIN prorratear el
--      descuento de la orden de cambio (es el crédito de lo devuelto)
--   09 devolución al precio NETO (unit_price × factor de la orden original)
--   10 bordes del día civil de Bogotá
--   11 filtro de tiendas: otra tienda no entra; las dos juntas, sí
-- Casos de las RPC:
--   12 equivalencias de categoría en el consolidado: el MAPA explícito une
--      BLUSA/BLUSAS y BERMUDA H./BERMUDA; GORRA/GORRAS, fuera del mapa, NO
--   13 sin categoría: inferido dama, y "creado por traslado"
--   14 report_variant_performance respeta el período
--   15 acceso: tienda de otra org, usuario sin reportes.ver, interna no
--      alcanzable, y anon → 42501 (molde de la 041: EXECUTE revocado a anon)
-- ============================================================

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- IDs fijos y legibles para que un fallo se pueda rastrear a mano.
INSERT INTO public.organizations (id, name) VALUES
  ('44000000-0000-0000-0000-0000000000a1', 'TEST 044 Org'),
  ('44000000-0000-0000-0000-0000000000a2', 'TEST 044 Otra org');

INSERT INTO public.stores (id, name, organization_id) VALUES
  ('44000000-0000-0000-0000-0000000000b1', 'TEST A', '44000000-0000-0000-0000-0000000000a1'),
  ('44000000-0000-0000-0000-0000000000b2', 'TEST B', '44000000-0000-0000-0000-0000000000a1'),
  ('44000000-0000-0000-0000-0000000000b9', 'TEST X', '44000000-0000-0000-0000-0000000000a2');

INSERT INTO public.roles (id, organization_id, name, permissions) VALUES
  ('44000000-0000-0000-0000-0000000000c1', '44000000-0000-0000-0000-0000000000a1', 'TEST Informes', '["reportes.ver"]'),
  ('44000000-0000-0000-0000-0000000000c2', '44000000-0000-0000-0000-0000000000a1', 'TEST Caja',     '["pos.usar"]');

INSERT INTO auth.users (id, email) VALUES
  ('44000000-0000-0000-0000-0000000000d1', 'test044-admin@example.invalid'),
  ('44000000-0000-0000-0000-0000000000d2', 'test044-caja@example.invalid');

INSERT INTO public.profiles (id, email, full_name, role, store_id, current_store_id, organization_id, role_id) VALUES
  ('44000000-0000-0000-0000-0000000000d1', 'test044-admin@example.invalid', 'TEST admin', 'admin',
   '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000b1',
   '44000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000c1'),
  ('44000000-0000-0000-0000-0000000000d2', 'test044-caja@example.invalid', 'TEST caja', 'seller',
   '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000b1',
   '44000000-0000-0000-0000-0000000000a1', '44000000-0000-0000-0000-0000000000c2');

-- El admin ve A (base) y B (user_stores). X es de otra organización.
INSERT INTO public.user_stores (user_id, store_id) VALUES
  ('44000000-0000-0000-0000-0000000000d1', '44000000-0000-0000-0000-0000000000b2');

INSERT INTO public.categories (id, name, store_id) VALUES
  ('44000000-0000-0000-0000-0000000000e1', 'BLUSA',         '44000000-0000-0000-0000-0000000000b1'),
  ('44000000-0000-0000-0000-0000000000e2', 'BERMUDA H.',    '44000000-0000-0000-0000-0000000000b1'),
  ('44000000-0000-0000-0000-0000000000e3', 'PANTALON DAMA', '44000000-0000-0000-0000-0000000000b1'),
  ('44000000-0000-0000-0000-0000000000e4', 'BLUSAS',        '44000000-0000-0000-0000-0000000000b2'),
  ('44000000-0000-0000-0000-0000000000e5', 'BERMUDA',       '44000000-0000-0000-0000-0000000000b2'),
  ('44000000-0000-0000-0000-0000000000e6', 'GORRA',         '44000000-0000-0000-0000-0000000000b1'),
  ('44000000-0000-0000-0000-0000000000e7', 'GORRAS',        '44000000-0000-0000-0000-0000000000b2');

INSERT INTO public.products (id, name, brand, store_id, category_id, size_type) VALUES
  -- tienda A
  ('44000000-0000-0000-0000-0000000001a1', 'PRETINA ANCHA', 'DOMINA', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000e3', 'pants_women'),
  ('44000000-0000-0000-0000-0000000001a2', 'BLUSA TIRAS',   NULL,     '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000e1', 'letter'),
  ('44000000-0000-0000-0000-0000000001a3', 'BERMUDA STIL',  'STIL',   '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000e2', 'pants_men'),
  -- tienda B
  ('44000000-0000-0000-0000-0000000001b1', 'BLUSA BOTONES', NULL,     '44000000-0000-0000-0000-0000000000b2', '44000000-0000-0000-0000-0000000000e4', 'letter'),
  ('44000000-0000-0000-0000-0000000001b2', 'BERMUDA ARS',   NULL,     '44000000-0000-0000-0000-0000000000b2', '44000000-0000-0000-0000-0000000000e5', 'pants_men'),
  ('44000000-0000-0000-0000-0000000001b3', 'BAGGY',         'NAVI',   '44000000-0000-0000-0000-0000000000b2', NULL, 'pants_women'),
  ('44000000-0000-0000-0000-0000000001b4', 'GORRA PLANA',   NULL,     '44000000-0000-0000-0000-0000000000b2', NULL, 'unique'),
  ('44000000-0000-0000-0000-0000000001a4', 'GORRA NY',      NULL,     '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000e6', 'unique'),
  ('44000000-0000-0000-0000-0000000001b5', 'GORRA LA',      NULL,     '44000000-0000-0000-0000-0000000000b2', '44000000-0000-0000-0000-0000000000e7', 'unique'),
  -- tienda X (otra org)
  ('44000000-0000-0000-0000-0000000001c1', 'AJENO',         NULL,     '44000000-0000-0000-0000-0000000000b9', NULL, 'letter');

INSERT INTO public.variants (id, product_id, store_id, size, color, price, stock_qty) VALUES
  ('44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', '44000000-0000-0000-0000-0000000000b1', '10', 'AZUL',  89000, 100),
  ('44000000-0000-0000-0000-0000000002a2', '44000000-0000-0000-0000-0000000001a2', '44000000-0000-0000-0000-0000000000b1', 'M',  'NEGRO', 50000, 100),
  ('44000000-0000-0000-0000-0000000002a3', '44000000-0000-0000-0000-0000000001a3', '44000000-0000-0000-0000-0000000000b1', '30', 'AZUL',  95000, 100),
  ('44000000-0000-0000-0000-0000000002b1', '44000000-0000-0000-0000-0000000001b1', '44000000-0000-0000-0000-0000000000b2', 'M',  'BLANCO',46000, 100),
  ('44000000-0000-0000-0000-0000000002b2', '44000000-0000-0000-0000-0000000001b2', '44000000-0000-0000-0000-0000000000b2', '30', 'AZUL',  70000, 100),
  ('44000000-0000-0000-0000-0000000002b3', '44000000-0000-0000-0000-0000000001b3', '44000000-0000-0000-0000-0000000000b2', '8',  'NEGRO', 89000, 100),
  ('44000000-0000-0000-0000-0000000002b4', '44000000-0000-0000-0000-0000000001b4', '44000000-0000-0000-0000-0000000000b2', 'UNICA', NULL, 30000, 5),
  ('44000000-0000-0000-0000-0000000002a4', '44000000-0000-0000-0000-0000000001a4', '44000000-0000-0000-0000-0000000000b1', 'UNICA', NULL, 30000, 3),
  ('44000000-0000-0000-0000-0000000002b5', '44000000-0000-0000-0000-0000000001b5', '44000000-0000-0000-0000-0000000000b2', 'UNICA', NULL, 30000, 4),
  ('44000000-0000-0000-0000-0000000002c1', '44000000-0000-0000-0000-0000000001c1', '44000000-0000-0000-0000-0000000000b9', 'M',  NULL,    10000, 100);

INSERT INTO public.customers (id, full_name, store_id) VALUES
  ('44000000-0000-0000-0000-0000000003a1', 'TEST cliente', '44000000-0000-0000-0000-0000000000b1');

-- La GORRA de B nació al recibir un traslado A → B (dest_action create_product).
INSERT INTO public.transfers (id, organization_id, from_store_id, to_store_id, status, created_by) VALUES
  ('44000000-0000-0000-0000-0000000004a1', '44000000-0000-0000-0000-0000000000a1',
   '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000b2', 'received',
   '44000000-0000-0000-0000-0000000000d1');
INSERT INTO public.transfer_items (transfer_id, from_variant_id, dest_action, to_product_id, qty_sent, product_name, unit_price) VALUES
  ('44000000-0000-0000-0000-0000000004a1', '44000000-0000-0000-0000-0000000002a2', 'create_product',
   '44000000-0000-0000-0000-0000000001b4', 5, 'GORRA PLANA', 30000);

-- ── Órdenes ─────────────────────────────────────────────────────────────────
-- Período de prueba: septiembre 2026 (Bogotá). Horas a las 15:00 UTC = 10:00 Bogotá.
INSERT INTO public.orders (id, store_id, created_by, status, subtotal, discount, total, payment_method, is_credit, return_id, created_at) VALUES
  -- 01 venta normal: lista 2×89.000, descuento 10.000 ya bajado al unit_price (84.000)
  ('44000000-0000-0000-0000-000000000101', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed', 178000, 10000, 168000, 'cash', false, NULL, '2026-09-05 15:00+00'),
  -- 02 descuento de orden SIN repartir: ítems 100.000 + 50.000, descuento 15.000
  ('44000000-0000-0000-0000-000000000102', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed', 150000, 15000, 135000, 'cash', false, NULL, '2026-09-06 15:00+00'),
  -- 03 regalo: total 0
  ('44000000-0000-0000-0000-000000000103', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  50000, 50000,      0, 'cash', false, NULL, '2026-09-07 15:00+00'),
  -- 04 fiado
  ('44000000-0000-0000-0000-000000000104', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  89000,     0,  89000, 'credit', true, NULL, '2026-09-08 15:00+00'),
  -- 05 conversión de separado
  ('44000000-0000-0000-0000-000000000105', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  89000,     0,  89000, 'cash', false, NULL, '2026-09-09 15:00+00'),
  -- 06 cancelada
  ('44000000-0000-0000-0000-000000000106', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'cancelled', 445000,    0, 445000, 'cash', false, NULL, '2026-09-10 15:00+00'),
  -- 07 venta de AGOSTO que se cambia en septiembre (lista 89.000, se vendió a 80.000)
  ('44000000-0000-0000-0000-000000000107', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  89000,  9000,  80000, 'cash', false, NULL, '2026-08-20 15:00+00'),
  -- 09 venta de septiembre con descuento de orden sin repartir (factor 0,9) que se devuelve en OCTUBRE
  ('44000000-0000-0000-0000-000000000109', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  50000,  5000,  45000, 'cash', false, NULL, '2026-09-03 15:00+00'),
  -- 10 2026-09-01 03:00 UTC = 31 de agosto 22:00 en Bogotá → NO es septiembre
  ('44000000-0000-0000-0000-000000000110', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  89000,     0,  89000, 'cash', false, NULL, '2026-09-01 03:00+00'),
  -- 10 2026-10-01 04:59:59 UTC = 30 de septiembre 23:59:59 en Bogotá → SÍ es septiembre
  ('44000000-0000-0000-0000-000000000111', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1', 'completed',  89000,     0,  89000, 'cash', false, NULL, '2026-10-01 04:59:59+00'),
  -- 11 tienda B
  ('44000000-0000-0000-0000-000000000112', '44000000-0000-0000-0000-0000000000b2', '44000000-0000-0000-0000-0000000000d1', 'completed', 205000,     0, 205000, 'cash', false, NULL, '2026-09-15 15:00+00'),
  -- 11 tienda X (otra org)
  ('44000000-0000-0000-0000-000000000113', '44000000-0000-0000-0000-0000000000b9', '44000000-0000-0000-0000-0000000000d1', 'completed',  10000,     0,  10000, 'cash', false, NULL, '2026-09-15 15:00+00');

INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price, is_gift, gift_reason) VALUES
  ('44000000-0000-0000-0000-000000000101', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 2,  84000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000102', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1, 100000, 100000, false, NULL),
  ('44000000-0000-0000-0000-000000000102', '44000000-0000-0000-0000-0000000002a2', '44000000-0000-0000-0000-0000000001a2', 1,  50000,  50000, false, NULL),
  ('44000000-0000-0000-0000-000000000103', '44000000-0000-0000-0000-0000000002a2', '44000000-0000-0000-0000-0000000001a2', 1,      0,  50000, true, 'regalo'),
  ('44000000-0000-0000-0000-000000000104', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000105', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000106', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 5,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000107', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1,  80000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000109', '44000000-0000-0000-0000-0000000002a2', '44000000-0000-0000-0000-0000000001a2', 1,  50000,  50000, false, NULL),
  ('44000000-0000-0000-0000-000000000110', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000111', '44000000-0000-0000-0000-0000000002a1', '44000000-0000-0000-0000-0000000001a1', 1,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000112', '44000000-0000-0000-0000-0000000002b1', '44000000-0000-0000-0000-0000000001b1', 1,  46000,  46000, false, NULL),
  ('44000000-0000-0000-0000-000000000112', '44000000-0000-0000-0000-0000000002b2', '44000000-0000-0000-0000-0000000001b2', 1,  70000,  70000, false, NULL),
  ('44000000-0000-0000-0000-000000000112', '44000000-0000-0000-0000-0000000002b3', '44000000-0000-0000-0000-0000000001b3', 1,  89000,  89000, false, NULL),
  ('44000000-0000-0000-0000-000000000113', '44000000-0000-0000-0000-0000000002c1', '44000000-0000-0000-0000-0000000001c1', 1,  10000,  10000, false, NULL);

-- 05: el separado que se convirtió en la orden 105.
INSERT INTO public.layaways (store_id, customer_id, created_by, status, subtotal, total, paid_amount, expires_at, completed_at, converted_order_id, created_at) VALUES
  ('44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000003a1', '44000000-0000-0000-0000-0000000000d1',
   'completed', 89000, 89000, 89000, '2026-12-01', '2026-09-09 15:00+00', '44000000-0000-0000-0000-000000000105', '2026-08-01 15:00+00');

-- 07/08: cambio el 12 de septiembre. Devuelve la de agosto (80.000), se lleva la
-- BERMUDA de 95.000. La orden del cambio lleva discount 80.000 (crédito).
INSERT INTO public.returns (id, original_order_id, store_id, created_by, type, status, created_at) VALUES
  ('44000000-0000-0000-0000-000000000201', '44000000-0000-0000-0000-000000000107', '44000000-0000-0000-0000-0000000000b1',
   '44000000-0000-0000-0000-0000000000d1', 'exchange', 'completed', '2026-09-12 15:00+00'),
  -- 09: devolución en octubre de la venta 109
  ('44000000-0000-0000-0000-000000000202', '44000000-0000-0000-0000-000000000109', '44000000-0000-0000-0000-0000000000b1',
   '44000000-0000-0000-0000-0000000000d1', 'return', 'completed', '2026-10-02 15:00+00');
INSERT INTO public.return_items (return_id, variant_id, qty, unit_price, action) VALUES
  ('44000000-0000-0000-0000-000000000201', '44000000-0000-0000-0000-0000000002a1', 1, 80000, 'exchange'),
  ('44000000-0000-0000-0000-000000000202', '44000000-0000-0000-0000-0000000002a2', 1, 50000, 'refund');

INSERT INTO public.orders (id, store_id, created_by, status, subtotal, discount, total, payment_method, return_id, created_at) VALUES
  ('44000000-0000-0000-0000-000000000108', '44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000d1',
   'completed', 95000, 80000, 15000, 'cash', '44000000-0000-0000-0000-000000000201', '2026-09-12 15:05+00');
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price) VALUES
  ('44000000-0000-0000-0000-000000000108', '44000000-0000-0000-0000-0000000002a3', '44000000-0000-0000-0000-0000000001a3', 1, 95000, 95000);


-- ── 01..11: reporting.net_sales_lines (como postgres, igual que la llaman las RPC) ──
CREATE TEMP TABLE t_sep ON COMMIT DROP AS
  SELECT * FROM reporting.net_sales_lines(
    ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-09-01', '2026-09-30');

DO $$
DECLARE
  n integer; a numeric;
BEGIN
  -- 01
  SELECT SUM(units), SUM(amount) INTO n, a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000101';
  IF n IS DISTINCT FROM 2 OR a IS DISTINCT FROM 168000 THEN
    RAISE EXCEPTION '01 venta normal: esperaba 2 uds / 168000, dio % / %', n, a; END IF;

  -- 02
  SELECT amount INTO a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000102' AND variant_id = '44000000-0000-0000-0000-0000000002a1';
  IF a IS DISTINCT FROM 90000 THEN RAISE EXCEPTION '02 prorrateo: el ítem de 100000 debía quedar en 90000, dio %', a; END IF;
  SELECT amount INTO a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000102' AND variant_id = '44000000-0000-0000-0000-0000000002a2';
  IF a IS DISTINCT FROM 45000 THEN RAISE EXCEPTION '02 prorrateo: el ítem de 50000 debía quedar en 45000, dio %', a; END IF;

  -- 03
  SELECT SUM(units), SUM(amount) INTO n, a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000103' AND is_gift;
  IF n IS DISTINCT FROM 1 OR a IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '03 regalo: esperaba 1 ud / $0, dio % / %', n, a; END IF;

  -- 04 y 05
  IF NOT EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000104' AND kind = 'sale' AND units = 1) THEN
    RAISE EXCEPTION '04 fiado: no cuenta como venta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000105' AND kind = 'sale' AND units = 1) THEN
    RAISE EXCEPTION '05 conversión de separado: no cuenta como venta'; END IF;

  -- 06
  IF EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000106') THEN
    RAISE EXCEPTION '06 cancelada: aparece en las ventas'; END IF;

  -- 07
  IF EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000107') THEN
    RAISE EXCEPTION '07 la venta de agosto aparece en septiembre'; END IF;
  SELECT units, amount INTO n, a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000201';
  IF n IS DISTINCT FROM -1 OR a IS DISTINCT FROM -80000 THEN
    RAISE EXCEPTION '07 devolución: esperaba -1 / -80000 el 12-sep, dio % / %', n, a; END IF;
  IF (SELECT sold_on FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000201') <> '2026-09-12' THEN
    RAISE EXCEPTION '07 devolución: no quedó con la fecha de la devolución'; END IF;

  -- 08
  SELECT units, amount INTO n, a FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000108';
  IF n IS DISTINCT FROM 1 OR a IS DISTINCT FROM 95000 THEN
    RAISE EXCEPTION '08 ítem del cambio: esperaba 1 / 95000 (sin prorratear el crédito), dio % / %', n, a; END IF;
  IF (SELECT kind FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000108') <> 'exchange_sale' THEN
    RAISE EXCEPTION '08 ítem del cambio: kind incorrecto'; END IF;

  -- 09 (septiembre: la venta está, la devolución de octubre no)
  IF NOT EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000109' AND amount = 45000) THEN
    RAISE EXCEPTION '09 la venta con factor 0,9 no quedó en 45000'; END IF;
  IF EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000202') THEN
    RAISE EXCEPTION '09 la devolución de octubre aparece en septiembre'; END IF;

  -- 10
  IF EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000110') THEN
    RAISE EXCEPTION '10 una venta del 31-ago 22:00 Bogotá cayó en septiembre'; END IF;
  IF NOT EXISTS (SELECT 1 FROM t_sep WHERE source_id = '44000000-0000-0000-0000-000000000111' AND sold_on = '2026-09-30') THEN
    RAISE EXCEPTION '10 una venta del 30-sep 23:59 Bogotá no cayó el 30-sep'; END IF;

  -- 11
  IF EXISTS (SELECT 1 FROM t_sep WHERE store_id <> '44000000-0000-0000-0000-0000000000b1') THEN
    RAISE EXCEPTION '11 aparecen ventas de otra tienda'; END IF;

  -- Total neto de A en septiembre: 2+2+1+1+1−1+1+1+1 = 9 unidades
  SELECT SUM(units) INTO n FROM t_sep;
  IF n IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'total neto de A en septiembre: esperaba 9, dio %', n; END IF;
END;
$$;

DO $$
DECLARE
  n integer; a numeric;
BEGIN
  -- 09 en octubre: la devolución resta al precio NETO (50000 × 0,9)
  SELECT units, amount INTO n, a
    FROM reporting.net_sales_lines(ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-10-01', '2026-10-31')
   WHERE source_id = '44000000-0000-0000-0000-000000000202';
  IF n IS DISTINCT FROM -1 OR a IS DISTINCT FROM -45000 THEN
    RAISE EXCEPTION '09 devolución al neto: esperaba -1 / -45000, dio % / %', n, a; END IF;

  -- 11 las dos tiendas juntas: entra la venta de B, nunca la de X
  SELECT SUM(units) INTO n
    FROM reporting.net_sales_lines(ARRAY['44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000b2']::uuid[], '2026-09-01', '2026-09-30');
  IF n IS DISTINCT FROM 12 THEN RAISE EXCEPTION '11 consolidado A+B: esperaba 12 uds, dio %', n; END IF;
END;
$$;


-- ── 12..15: las RPC, como el usuario admin de prueba ─────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"44000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

CREATE TEMP TABLE t_cat ON COMMIT DROP AS
  SELECT * FROM public.report_sales_by_category(
    ARRAY['44000000-0000-0000-0000-0000000000b1', '44000000-0000-0000-0000-0000000000b2']::uuid[],
    '2026-09-01', '2026-09-30');

DO $$
DECLARE
  n integer;
BEGIN
  -- 12 BLUSA (A) y BLUSAS (B) → la misma llave
  SELECT count(DISTINCT store_id) INTO n FROM t_cat WHERE category_key = 'BLUSA';
  IF n <> 2 THEN RAISE EXCEPTION '12 BLUSA/BLUSAS no comparten llave (tiendas con BLUSA: %)', n; END IF;

  -- 12 BERMUDA H. (A) y BERMUDA (B) → BERMUDA, por el mapa
  SELECT count(DISTINCT store_id) INTO n FROM t_cat WHERE category_key = 'BERMUDA';
  IF n <> 2 THEN RAISE EXCEPTION '12 BERMUDA H./BERMUDA no comparten llave (tiendas: %)', n; END IF;

  -- 12 GORRA (A) y GORRAS (B) NO están en el mapa → quedan separadas
  IF NOT EXISTS (SELECT 1 FROM t_cat WHERE category_key = 'GORRA'  AND available_qty = 3)
  OR NOT EXISTS (SELECT 1 FROM t_cat WHERE category_key = 'GORRAS' AND available_qty = 4) THEN
    RAISE EXCEPTION '12 GORRA/GORRAS se unieron sin estar en el mapa (¿volvió una heurística de plural?)';
  END IF;

  -- 12 la curva por talla: PANTALON DAMA talla 10 en A = 2+1+1+1−1+1 = 5 netas
  SELECT units_net INTO n FROM t_cat
   WHERE category_key = 'PANTALON DAMA' AND size = '10' AND store_id = '44000000-0000-0000-0000-0000000000b1';
  IF n IS DISTINCT FROM 5 THEN RAISE EXCEPTION '12 PANTALON DAMA T10 en A: esperaba 5 netas, dio %', n; END IF;

  -- 13 sin categoría + pants_women → inferido dama
  IF NOT EXISTS (SELECT 1 FROM t_cat WHERE category_key = '~INFERIDO DAMA' AND category_source = 'inferred' AND units_net = 1) THEN
    RAISE EXCEPTION '13 el BAGGY sin categoría no quedó como DAMA (INFERIDO)'; END IF;

  -- 13 sin categoría creado por traslado (sin ventas, pero con stock: aparece igual)
  IF NOT EXISTS (SELECT 1 FROM t_cat WHERE category_key = '~SIN CATEGORIA' AND from_transfer AND available_qty = 5 AND units_net = 0) THEN
    RAISE EXCEPTION '13 la GORRA creada por traslado no quedó como SIN CATEGORÍA / from_transfer'; END IF;
END;
$$;

DO $$
DECLARE
  n integer;
BEGIN
  -- 14 desempeño por variante respeta el período: variante a1 en septiembre =
  -- vendidas 2+1+1+1+1 = 6, devueltas 1, netas 5 (la de agosto y la cancelada no)
  SELECT units_sold INTO n FROM public.report_variant_performance(
    ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-09-01', '2026-09-30')
   WHERE variant_id = '44000000-0000-0000-0000-0000000002a1';
  IF n IS DISTINCT FROM 6 THEN RAISE EXCEPTION '14 vendidas de a1 en septiembre: esperaba 6, dio %', n; END IF;

  SELECT net_units INTO n FROM public.report_variant_performance(
    ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-08-01', '2026-08-31')
   WHERE variant_id = '44000000-0000-0000-0000-0000000002a1';
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION '14 netas de a1 en agosto (107 + 110): esperaba 2, dio %', n; END IF;

  -- 15 tienda de otra organización
  BEGIN
    PERFORM public.report_sales_by_category(ARRAY['44000000-0000-0000-0000-0000000000b9']::uuid[], '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '15 dejó leer una tienda de otra organización';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No tenés acceso%' THEN RAISE; END IF;
  END;

  -- 15 la interna no se puede llamar desde el cliente
  BEGIN
    PERFORM * FROM reporting.net_sales_lines(ARRAY['44000000-0000-0000-0000-0000000000b9']::uuid[], '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '15 reporting.net_sales_lines quedó al alcance de authenticated';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- 15 usuario sin reportes.ver
SELECT set_config('request.jwt.claims',
  '{"sub":"44000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.report_variant_performance(ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '15 dejó ver reportes sin reportes.ver';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No tenés permiso%' THEN RAISE; END IF;
  END;
END;
$$;

-- 15 sin sesión: anon NO tiene EXECUTE sobre las RPC (molde de la 041) → 42501.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.report_sales_by_category(ARRAY['44000000-0000-0000-0000-0000000000b1']::uuid[], '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '15 anon pudo ejecutar report_sales_by_category';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE '044 tests OK: 15 casos.';
END;
$$;

ROLLBACK;
