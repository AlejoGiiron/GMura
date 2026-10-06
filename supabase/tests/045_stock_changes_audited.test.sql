-- ============================================================
-- Tests de la 045 — el stock solo cambia con registro
--
-- Correr en el LAB, con la 045 YA aplicada (y re-aplicada después de cualquier
-- lab-restore: ver CLAUDE.md):
--   ./scripts/lab-apply-migration.sh supabase/tests/045_stock_changes_audited.test.sql
--
-- Fixtures propios (una organización, dos tiendas, dos usuarios inventados)
-- dentro de una transacción que termina en ROLLBACK: no deja NADA en la base.
-- Todo lo importante corre como `authenticated` (el rol de la app vía
-- PostgREST): como postgres el guardián deja pasar todo y no probaría nada.
--
--   01 el caso que motiva todo: una pestaña con el stock viejo intenta guardar
--      precio + stock mientras se vendió → rechazado; guardar solo el precio
--      → el stock queda como lo dejó la venta
--   02 ajuste con motivo → stock + movimiento (usuario y motivo) juntos
--   03 ajuste sin motivo / delta 0 → rechazado
--   04 ajuste por debajo de lo reservado → rechazado con mensaje claro
--   05 conteo físico con stock cambiado (p_expected_qty) → rechazado
--   06 rol con productos.gestionar SIN inventario.gestionar: edita precio, no
--      stock (ni directo, ni por la RPC, ni como stock inicial)
--   07 escritura directa de stock_qty / reserved_qty con el admin → rechazada;
--      mandar el MISMO valor (pestaña vieja) no rompe la edición
--   08 variante nueva con stock → movimiento "Stock inicial"; en 0 → nada
--   09 venta, devolución, compra, separado (reserva y conversión) y traslado
--      (despacho y recepción) siguen moviendo stock y registrando movimiento
--   10 ajuste de una variante de OTRA tienda → rechazado ([5])
-- ============================================================

BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (id, name) VALUES
  ('45000000-0000-0000-0000-0000000000a1', 'TEST 045 Org');

INSERT INTO public.stores (id, name, organization_id) VALUES
  ('45000000-0000-0000-0000-0000000000b1', 'TEST 045 A', '45000000-0000-0000-0000-0000000000a1'),
  ('45000000-0000-0000-0000-0000000000b2', 'TEST 045 B', '45000000-0000-0000-0000-0000000000a1');

INSERT INTO public.roles (id, organization_id, name, permissions) VALUES
  ('45000000-0000-0000-0000-0000000000c1', '45000000-0000-0000-0000-0000000000a1', 'TEST Dueño',    '["*"]'),
  ('45000000-0000-0000-0000-0000000000c2', '45000000-0000-0000-0000-0000000000a1', 'TEST Catálogo', '["productos.gestionar", "inventario.ver"]');

INSERT INTO auth.users (id, email) VALUES
  ('45000000-0000-0000-0000-0000000000d1', 'test045-admin@example.invalid'),
  ('45000000-0000-0000-0000-0000000000d2', 'test045-catalogo@example.invalid');

INSERT INTO public.profiles (id, email, full_name, role, store_id, current_store_id, organization_id, role_id) VALUES
  ('45000000-0000-0000-0000-0000000000d1', 'test045-admin@example.invalid', 'TEST admin', 'admin',
   '45000000-0000-0000-0000-0000000000b1', '45000000-0000-0000-0000-0000000000b1',
   '45000000-0000-0000-0000-0000000000a1', '45000000-0000-0000-0000-0000000000c1'),
  ('45000000-0000-0000-0000-0000000000d2', 'test045-catalogo@example.invalid', 'TEST catálogo', 'admin',
   '45000000-0000-0000-0000-0000000000b1', '45000000-0000-0000-0000-0000000000b1',
   '45000000-0000-0000-0000-0000000000a1', '45000000-0000-0000-0000-0000000000c2');

INSERT INTO public.user_stores (user_id, store_id) VALUES
  ('45000000-0000-0000-0000-0000000000d1', '45000000-0000-0000-0000-0000000000b2');

-- Como postgres: el guardián deja pasar (migraciones / SQL editor) y el
-- trigger de stock inicial no registra porque no hay usuario (NOTICE).
INSERT INTO public.products (id, name, store_id, size_type) VALUES
  ('45000000-0000-0000-0000-0000000001a1', 'PANTALON TEST', '45000000-0000-0000-0000-0000000000b1', 'pants_women'),
  ('45000000-0000-0000-0000-0000000001b1', 'PANTALON TEST', '45000000-0000-0000-0000-0000000000b2', 'pants_women');

INSERT INTO public.variants (id, product_id, store_id, size, color, price, stock_qty) VALUES
  ('45000000-0000-0000-0000-0000000002a1', '45000000-0000-0000-0000-0000000001a1', '45000000-0000-0000-0000-0000000000b1', '10', 'AZUL', 89000, 10),
  ('45000000-0000-0000-0000-0000000002b1', '45000000-0000-0000-0000-0000000001b1', '45000000-0000-0000-0000-0000000000b2', '10', 'AZUL', 89000, 3);

INSERT INTO public.customers (id, full_name, store_id) VALUES
  ('45000000-0000-0000-0000-0000000003a1', 'TEST cliente', '45000000-0000-0000-0000-0000000000b1');

INSERT INTO public.suppliers (id, name, store_id) VALUES
  ('45000000-0000-0000-0000-0000000004a1', 'TEST proveedor', '45000000-0000-0000-0000-0000000000b1');


-- ── Como el ADMIN de prueba (rol authenticated) ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"45000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

-- 01 el caso que motiva todo
DO $$
DECLARE
  v_old integer;
  v_now integer;
BEGIN
  -- La pestaña abrió el formulario con este stock…
  SELECT stock_qty INTO v_old FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1';

  -- …mientras tanto, la caja vende 2.
  INSERT INTO public.orders (id, store_id, created_by, status, subtotal, discount, total, payment_method)
  VALUES ('45000000-0000-0000-0000-000000000101', '45000000-0000-0000-0000-0000000000b1',
          '45000000-0000-0000-0000-0000000000d1', 'completed', 178000, 0, 178000, 'cash');
  INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
  VALUES ('45000000-0000-0000-0000-000000000101', '45000000-0000-0000-0000-0000000002a1',
          '45000000-0000-0000-0000-0000000001a1', 2, 89000, 89000);

  -- Código VIEJO: guarda precio + el stock que mostraba → rechazado.
  BEGIN
    UPDATE public.variants SET price = 95000, stock_qty = v_old WHERE id = '45000000-0000-0000-0000-0000000002a1';
    RAISE EXCEPTION '01 la pestaña vieja des-vendió la prenda';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El stock no se edita directamente%' THEN RAISE; END IF;
  END;

  -- Código NUEVO: guarda solo el precio → el stock queda como lo dejó la venta.
  UPDATE public.variants SET price = 95000 WHERE id = '45000000-0000-0000-0000-0000000002a1';
  SELECT stock_qty INTO v_now FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1';
  IF v_now <> v_old - 2 THEN
    RAISE EXCEPTION '01 tras editar el precio el stock es %, esperaba % (la venta)', v_now, v_old - 2;
  END IF;
END;
$$;

-- 02 ajuste con motivo (stock 8 → 11)
DO $$
DECLARE
  r record;
  m record;
BEGIN
  SELECT * INTO r FROM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 3, '  Llegaron 3 de bodega  ');
  IF r.stock_qty <> 11 THEN RAISE EXCEPTION '02 stock tras el ajuste: %, esperaba 11', r.stock_qty; END IF;
  SELECT * INTO m FROM public.stock_movements WHERE id = r.movement_id;
  IF m.type <> 'adjustment' OR m.qty <> 3 OR m.notes <> 'Llegaron 3 de bodega'
     OR m.created_by <> '45000000-0000-0000-0000-0000000000d1' THEN
    RAISE EXCEPTION '02 movimiento mal registrado: % % "%" por %', m.type, m.qty, m.notes, m.created_by;
  END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 11 THEN
    RAISE EXCEPTION '02 la variante no quedó en 11';
  END IF;
END;
$$;

-- 03 sin motivo / delta 0
DO $$
BEGIN
  BEGIN
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 1, '  ');
    RAISE EXCEPTION '03 aceptó un ajuste sin motivo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El motivo del ajuste es obligatorio%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 0, 'nada');
    RAISE EXCEPTION '03 aceptó un ajuste de 0';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'La cantidad del ajuste tiene que ser distinta de 0%' THEN RAISE; END IF;
  END;
END;
$$;

-- 04 por debajo de lo reservado: un separado aparta 4 (también prueba que el
-- trigger de reserva sigue pudiendo escribir reserved_qty)
INSERT INTO public.layaways (id, store_id, customer_id, created_by, status, subtotal, total, expires_at)
VALUES ('45000000-0000-0000-0000-000000000301', '45000000-0000-0000-0000-0000000000b1',
        '45000000-0000-0000-0000-0000000003a1', '45000000-0000-0000-0000-0000000000d1',
        'active', 356000, 356000, now() + interval '30 days');
INSERT INTO public.layaway_items (layaway_id, variant_id, product_id, qty, unit_price, list_price)
VALUES ('45000000-0000-0000-0000-000000000301', '45000000-0000-0000-0000-0000000002a1',
        '45000000-0000-0000-0000-0000000001a1', 4, 89000, 89000);

DO $$
BEGIN
  IF (SELECT reserved_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 4 THEN
    RAISE EXCEPTION '09 el separado no reservó (reserve_stock_on_layaway frenado por el guardián?)';
  END IF;
  BEGIN
    -- hay 11, reservadas 4: sacar 8 dejaría 3 < 4
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', -8, 'Merma');
    RAISE EXCEPTION '04 dejó bajar el stock por debajo de lo reservado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No se puede dejar menos de lo apartado en separados%' THEN RAISE; END IF;
  END;
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 11 THEN
    RAISE EXCEPTION '04 el ajuste rechazado igual tocó el stock';
  END IF;
END;
$$;

-- 05 conteo físico con el stock cambiado
DO $$
BEGIN
  BEGIN
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 1, 'Conteo', 10);
    RAISE EXCEPTION '05 aceptó un conteo sobre un stock que ya cambió';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El stock cambió mientras ajustabas%' THEN RAISE; END IF;
  END;
  -- con el stock correcto, pasa: conté 12 → +1 sobre 11
  PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 1, 'Conteo', 11);
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 12 THEN
    RAISE EXCEPTION '05 el conteo válido no dejó 12';
  END IF;
END;
$$;

-- 07 escritura directa con el admin
DO $$
BEGIN
  BEGIN
    UPDATE public.variants SET stock_qty = 50 WHERE id = '45000000-0000-0000-0000-0000000002a1';
    RAISE EXCEPTION '07 el admin escribió stock_qty directo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El stock no se edita directamente%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.variants SET reserved_qty = 0 WHERE id = '45000000-0000-0000-0000-0000000002a1';
    RAISE EXCEPTION '07 el admin escribió reserved_qty directo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Las unidades reservadas las manejan los separados%' THEN RAISE; END IF;
  END;
  -- pestaña vieja que manda el MISMO stock: la edición pasa
  UPDATE public.variants SET min_stock = 2, stock_qty = 12 WHERE id = '45000000-0000-0000-0000-0000000002a1';
  IF (SELECT min_stock FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 2 THEN
    RAISE EXCEPTION '07 mandar el mismo stock rompió una edición válida';
  END IF;
END;
$$;

-- 08 stock inicial
INSERT INTO public.variants (id, product_id, store_id, size, color, price, stock_qty) VALUES
  ('45000000-0000-0000-0000-0000000002a2', '45000000-0000-0000-0000-0000000001a1', '45000000-0000-0000-0000-0000000000b1', '12', 'AZUL', 89000, 5),
  ('45000000-0000-0000-0000-0000000002a3', '45000000-0000-0000-0000-0000000001a1', '45000000-0000-0000-0000-0000000000b1', '14', 'AZUL', 89000, 0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements
                  WHERE variant_id = '45000000-0000-0000-0000-0000000002a2'
                    AND type = 'adjustment' AND qty = 5 AND notes = 'Stock inicial'
                    AND created_by = '45000000-0000-0000-0000-0000000000d1') THEN
    RAISE EXCEPTION '08 la variante creada con 5 no registró "Stock inicial"';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE variant_id = '45000000-0000-0000-0000-0000000002a3') THEN
    RAISE EXCEPTION '08 la variante creada en 0 registró un movimiento';
  END IF;
END;
$$;

-- 09 los caminos autorizados siguen funcionando (variante a1, stock 12, reservadas 4)
DO $$
DECLARE
  v_stock integer;
BEGIN
  -- Venta (ya ejercitada en 01): stock bajó y quedó el movimiento 'sale'
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements
                  WHERE variant_id = '45000000-0000-0000-0000-0000000002a1' AND type = 'sale' AND qty = -2) THEN
    RAISE EXCEPTION '09 venta: no registró el movimiento';
  END IF;

  -- Devolución de 1 de la venta 101 → 13
  INSERT INTO public.returns (id, original_order_id, store_id, created_by, type, status)
  VALUES ('45000000-0000-0000-0000-000000000201', '45000000-0000-0000-0000-000000000101',
          '45000000-0000-0000-0000-0000000000b1', '45000000-0000-0000-0000-0000000000d1', 'return', 'completed');
  INSERT INTO public.return_items (return_id, variant_id, qty, unit_price, action)
  VALUES ('45000000-0000-0000-0000-000000000201', '45000000-0000-0000-0000-0000000002a1', 1, 89000, 'refund');
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1';
  IF v_stock <> 13 OR NOT EXISTS (SELECT 1 FROM public.stock_movements
       WHERE variant_id = '45000000-0000-0000-0000-0000000002a1' AND type = 'return' AND qty = 1) THEN
    RAISE EXCEPTION '09 devolución: stock % (esperaba 13) o falta el movimiento', v_stock;
  END IF;

  -- Compra de 5 → 18
  INSERT INTO public.purchase_invoices (id, invoice_number, store_id, supplier_id, created_by, invoice_date, subtotal, total)
  VALUES ('45000000-0000-0000-0000-000000000401', 'TEST-045', '45000000-0000-0000-0000-0000000000b1',
          '45000000-0000-0000-0000-0000000004a1', '45000000-0000-0000-0000-0000000000d1', current_date, 250000, 250000);
  INSERT INTO public.purchase_invoice_items (invoice_id, variant_id, product_id, qty, unit_cost, subtotal)
  VALUES ('45000000-0000-0000-0000-000000000401', '45000000-0000-0000-0000-0000000002a1',
          '45000000-0000-0000-0000-0000000001a1', 5, 50000, 250000);
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1';
  IF v_stock <> 18 OR NOT EXISTS (SELECT 1 FROM public.stock_movements
       WHERE variant_id = '45000000-0000-0000-0000-0000000002a1' AND type = 'purchase' AND qty = 5) THEN
    RAISE EXCEPTION '09 compra: stock % (esperaba 18) o falta el movimiento', v_stock;
  END IF;

  -- Conversión del separado de 4: la orden descuenta 4 (→ 14) y completar el
  -- separado libera la reserva (→ 0)
  INSERT INTO public.orders (id, store_id, created_by, status, subtotal, discount, total, payment_method, customer_id)
  VALUES ('45000000-0000-0000-0000-000000000102', '45000000-0000-0000-0000-0000000000b1',
          '45000000-0000-0000-0000-0000000000d1', 'completed', 356000, 0, 356000, 'cash',
          '45000000-0000-0000-0000-0000000003a1');
  UPDATE public.layaways SET converted_order_id = '45000000-0000-0000-0000-000000000102'
   WHERE id = '45000000-0000-0000-0000-000000000301';
  INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
  VALUES ('45000000-0000-0000-0000-000000000102', '45000000-0000-0000-0000-0000000002a1',
          '45000000-0000-0000-0000-0000000001a1', 4, 89000, 89000);
  UPDATE public.layaways SET status = 'completed', completed_at = now()
   WHERE id = '45000000-0000-0000-0000-000000000301';
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 14
  OR (SELECT reserved_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 0 THEN
    RAISE EXCEPTION '09 separado: stock/reservado = %/% (esperaba 14/0)',
      (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1'),
      (SELECT reserved_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1');
  END IF;
END;
$$;

-- 09 traslado A → B de 2 (despacho desde A)
DO $$
DECLARE
  v_t uuid;
BEGIN
  PERFORM public.save_transfer_draft(
    '45000000-0000-0000-0000-0000000000b2',
    '[{"from_variant_id":"45000000-0000-0000-0000-0000000002a1","qty":2,"dest_action":"map_variant","to_variant_id":"45000000-0000-0000-0000-0000000002b1"}]'::jsonb);
  SELECT id INTO v_t FROM public.transfers WHERE from_store_id = '45000000-0000-0000-0000-0000000000b1';
  PERFORM public.dispatch_transfer(v_t);
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a1') <> 12
  OR NOT EXISTS (SELECT 1 FROM public.stock_movements
       WHERE variant_id = '45000000-0000-0000-0000-0000000002a1' AND type = 'transfer_out' AND qty = -2) THEN
    RAISE EXCEPTION '09 traslado: el despacho no descontó 2 del origen o falta el movimiento';
  END IF;
END;
$$;

-- …y recepción en B (el admin cambia de tienda activa)
RESET ROLE;
UPDATE public.profiles SET current_store_id = '45000000-0000-0000-0000-0000000000b2'
 WHERE id = '45000000-0000-0000-0000-0000000000d1';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_t uuid;
BEGIN
  SELECT id INTO v_t FROM public.transfers WHERE to_store_id = '45000000-0000-0000-0000-0000000000b2';
  PERFORM public.receive_transfer(v_t, NULL);
  IF (SELECT stock_qty FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002b1') <> 5
  OR NOT EXISTS (SELECT 1 FROM public.stock_movements
       WHERE variant_id = '45000000-0000-0000-0000-0000000002b1' AND type = 'transfer_in' AND qty = 2) THEN
    RAISE EXCEPTION '09 traslado: la recepción no sumó 2 al destino o falta el movimiento';
  END IF;

  -- 10 ajuste de una variante de OTRA tienda (la activa ahora es B; a1 es de A)
  BEGIN
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a1', 1, 'De otra tienda');
    RAISE EXCEPTION '10 ajustó una variante que no es de la tienda activa';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'La variante no existe o no es de tu tienda%' THEN RAISE; END IF;
  END;
END;
$$;


-- ── 06 Como el usuario de CATÁLOGO (productos.gestionar, sin inventario.gestionar) ──
SELECT set_config('request.jwt.claims', '{"sub":"45000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);

DO $$
BEGIN
  -- precio, talla, color: sí
  UPDATE public.variants SET price = 99000, color = 'AZUL OSCURO' WHERE id = '45000000-0000-0000-0000-0000000002a3';
  IF (SELECT price FROM public.variants WHERE id = '45000000-0000-0000-0000-0000000002a3') <> 99000 THEN
    RAISE EXCEPTION '06 el usuario de catálogo no pudo editar el precio';
  END IF;

  -- stock directo: no
  BEGIN
    UPDATE public.variants SET stock_qty = 3 WHERE id = '45000000-0000-0000-0000-0000000002a3';
    RAISE EXCEPTION '06 el usuario de catálogo escribió stock_qty';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El stock no se edita directamente%' THEN RAISE; END IF;
  END;

  -- por la RPC: no
  BEGIN
    PERFORM public.adjust_variant_stock('45000000-0000-0000-0000-0000000002a3', 3, 'Sin permiso');
    RAISE EXCEPTION '06 el usuario de catálogo ajustó por la RPC';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'No tenés permiso para ajustar el stock%' THEN RAISE; END IF;
  END;

  -- stock inicial: no; variante en 0: sí
  BEGIN
    INSERT INTO public.variants (product_id, store_id, size, price, stock_qty)
    VALUES ('45000000-0000-0000-0000-0000000001a1', '45000000-0000-0000-0000-0000000000b1', '16', 89000, 5);
    RAISE EXCEPTION '06 el usuario de catálogo cargó stock inicial';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Para cargar stock inicial necesitás%' THEN RAISE; END IF;
  END;
  INSERT INTO public.variants (product_id, store_id, size, price, stock_qty)
  VALUES ('45000000-0000-0000-0000-0000000001a1', '45000000-0000-0000-0000-0000000000b1', '16', 89000, 0);

  RAISE NOTICE '045 tests OK: 10 grupos de casos.';
END;
$$;

ROLLBACK;
