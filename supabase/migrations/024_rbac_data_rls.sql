-- ============================================================
-- 024 — Multi-tenancy FASE 4 (paso 2 de 2): barrido de has_permission en el RLS
--
-- Objetivo:
--   Añadir control por PERMISO a las políticas de ESCRITURA de las tablas de
--   datos de negocio, según la matriz aprobada. El AISLAMIENTO por store_id
--   (store_id = get_my_store_id()) se MANTIENE intacto en cada política: se
--   conserva y se le SUMA (AND) el has_permission(...). En las tablas que antes
--   gateaban por get_my_role()='admin', ese chequeo de rol se REEMPLAZA por el
--   permiso específico (RBAC); para los admins actuales el comportamiento no
--   cambia (el rol Administrador ya trae esos permisos vía 021/023), y además
--   habilita al Dueño ('*') y a futuros roles personalizados.
--
-- Lectura (SELECT):
--   - Se MANTIENE libre dentro de la tienda en TODO lo operativo (no se toca).
--   - Se RESTRINGE con compras.gestionar SOLO en back-office: suppliers,
--     purchase_invoices, purchase_invoice_items, supplier_payments.
--
-- Notas de diseño verificadas en el diagnóstico:
--   - Los triggers de stock/compra/devolución son SECURITY DEFINER → bypassean
--     el RLS, así que el gating de stock_movements solo afecta AJUSTES MANUALES.
--   - update_layaway_paid_amount NO es SECURITY DEFINER y hace UPDATE layaways
--     al registrar un abono → por eso layaways UPDATE y layaway_payments INSERT
--     llevan el MISMO permiso (separados.gestionar): registrar un abono no falla.
--   - Las tablas hijas (order_items, return_items, layaway_items,
--     purchase_invoice_items) SOLO tienen política de INSERT y SELECT; UPDATE y
--     DELETE están DENEGADOS por defecto (sin política) y se dejan así.
--   - cash_shifts UPDATE (cerrar turno) NO se toca: sigue opener-or-admin.
--
-- Atómica (BEGIN/COMMIT), idempotente (DROP POLICY IF EXISTS + CREATE).
-- NO toca: SELECT de tablas operativas, cash_shifts UPDATE, ni TypeScript.
-- Requiere: Fases 020-023 aplicadas.
-- ============================================================

BEGIN;

-- ============================================================
-- CATÁLOGO → productos.gestionar (antes: get_my_role()='admin')
-- ============================================================
-- products
DROP POLICY IF EXISTS products_insert_admin ON public.products;
CREATE POLICY products_insert_admin ON public.products FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS products_update_admin ON public.products;
CREATE POLICY products_update_admin ON public.products FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS products_delete_admin ON public.products;
CREATE POLICY products_delete_admin ON public.products FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));

-- variants
DROP POLICY IF EXISTS variants_insert_admin ON public.variants;
CREATE POLICY variants_insert_admin ON public.variants FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS variants_update_admin ON public.variants;
CREATE POLICY variants_update_admin ON public.variants FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS variants_delete_admin ON public.variants;
CREATE POLICY variants_delete_admin ON public.variants FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));

-- categories
DROP POLICY IF EXISTS categories_insert_admin ON public.categories;
CREATE POLICY categories_insert_admin ON public.categories FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS categories_update_admin ON public.categories;
CREATE POLICY categories_update_admin ON public.categories FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));
DROP POLICY IF EXISTS categories_delete_admin ON public.categories;
CREATE POLICY categories_delete_admin ON public.categories FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('productos.gestionar'));


-- ============================================================
-- CLIENTES → clientes.gestionar (crear/editar) · clientes.eliminar (borrar)
-- ============================================================
DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('clientes.gestionar'));
DROP POLICY IF EXISTS customers_update ON public.customers;
CREATE POLICY customers_update ON public.customers FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('clientes.gestionar'));
DROP POLICY IF EXISTS customers_delete_admin ON public.customers;
CREATE POLICY customers_delete_admin ON public.customers FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('clientes.eliminar'));


-- ============================================================
-- VENTAS → orders INSERT: pos.usar · orders UPDATE (anular): ventas.anular
-- ============================================================
DROP POLICY IF EXISTS orders_insert ON public.orders;
CREATE POLICY orders_insert ON public.orders FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('pos.usar'));
DROP POLICY IF EXISTS orders_update_admin ON public.orders;
CREATE POLICY orders_update_admin ON public.orders FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('ventas.anular'));

-- order_items (hija): pos.usar + la orden debe ser de mi tienda
DROP POLICY IF EXISTS order_items_insert ON public.order_items;
CREATE POLICY order_items_insert ON public.order_items FOR INSERT
  WITH CHECK (
    has_permission('pos.usar')
    AND EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = order_items.order_id AND o.store_id = get_my_store_id()
    )
  );


-- ============================================================
-- DEVOLUCIONES → devoluciones.gestionar
-- ============================================================
DROP POLICY IF EXISTS returns_insert ON public.returns;
CREATE POLICY returns_insert ON public.returns FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('devoluciones.gestionar'));
DROP POLICY IF EXISTS returns_update ON public.returns;
CREATE POLICY returns_update ON public.returns FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('devoluciones.gestionar'));

-- return_items (hija): devoluciones.gestionar + la devolución de mi tienda
DROP POLICY IF EXISTS return_items_insert ON public.return_items;
CREATE POLICY return_items_insert ON public.return_items FOR INSERT
  WITH CHECK (
    has_permission('devoluciones.gestionar')
    AND EXISTS (
      SELECT 1 FROM public.returns r
       WHERE r.id = return_items.return_id AND r.store_id = get_my_store_id()
    )
  );


-- ============================================================
-- SEPARADOS → separados.gestionar (crear/editar/abono) · separados.eliminar (borrar)
-- ============================================================
DROP POLICY IF EXISTS layaways_insert ON public.layaways;
CREATE POLICY layaways_insert ON public.layaways FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('separados.gestionar'));
DROP POLICY IF EXISTS layaways_update ON public.layaways;
CREATE POLICY layaways_update ON public.layaways FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('separados.gestionar'));
DROP POLICY IF EXISTS layaways_delete_admin ON public.layaways;
CREATE POLICY layaways_delete_admin ON public.layaways FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('separados.eliminar'));

-- layaway_items (hija): separados.gestionar + el separado de mi tienda
DROP POLICY IF EXISTS layaway_items_insert ON public.layaway_items;
CREATE POLICY layaway_items_insert ON public.layaway_items FOR INSERT
  WITH CHECK (
    has_permission('separados.gestionar')
    AND EXISTS (
      SELECT 1 FROM public.layaways l
       WHERE l.id = layaway_items.layaway_id AND l.store_id = get_my_store_id()
    )
  );

-- layaway_payments: separados.gestionar
--   (MISMO permiso que layaways UPDATE, porque el trigger no-SDEF
--    update_layaway_paid_amount hace UPDATE layaways al registrar el abono.)
DROP POLICY IF EXISTS layaway_payments_insert ON public.layaway_payments;
CREATE POLICY layaway_payments_insert ON public.layaway_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('separados.gestionar'));


-- ============================================================
-- CAJA → cash_shifts INSERT (abrir): pos.usar · cash_expenses: gastos.gestionar
--   cash_shifts UPDATE (cerrar) NO se toca (sigue opener-or-admin).
-- ============================================================
DROP POLICY IF EXISTS cash_shifts_insert ON public.cash_shifts;
CREATE POLICY cash_shifts_insert ON public.cash_shifts FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('pos.usar'));

DROP POLICY IF EXISTS cash_expenses_insert ON public.cash_expenses;
CREATE POLICY cash_expenses_insert ON public.cash_expenses FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('gastos.gestionar'));
DROP POLICY IF EXISTS cash_expenses_delete_admin ON public.cash_expenses;
CREATE POLICY cash_expenses_delete_admin ON public.cash_expenses FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('gastos.gestionar'));


-- ============================================================
-- INVENTARIO → stock_movements INSERT (ajuste manual): inventario.gestionar
--   (Los triggers de venta/compra/devolución son SECURITY DEFINER y bypassean
--    el RLS, así que esto solo afecta inserciones manuales desde la app.)
-- ============================================================
DROP POLICY IF EXISTS stock_movements_insert_admin ON public.stock_movements;
CREATE POLICY stock_movements_insert_admin ON public.stock_movements FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('inventario.gestionar'));


-- ============================================================
-- COMPRAS / PROVEEDORES → compras.gestionar (escritura Y lectura: back-office)
-- ============================================================
-- suppliers
DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS suppliers_insert_admin ON public.suppliers;
CREATE POLICY suppliers_insert_admin ON public.suppliers FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS suppliers_update_admin ON public.suppliers;
CREATE POLICY suppliers_update_admin ON public.suppliers FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS suppliers_delete_admin ON public.suppliers;
CREATE POLICY suppliers_delete_admin ON public.suppliers FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));

-- purchase_invoices
DROP POLICY IF EXISTS purchase_invoices_select ON public.purchase_invoices;
CREATE POLICY purchase_invoices_select ON public.purchase_invoices FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS purchase_invoices_insert_admin ON public.purchase_invoices;
CREATE POLICY purchase_invoices_insert_admin ON public.purchase_invoices FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS purchase_invoices_update_admin ON public.purchase_invoices;
CREATE POLICY purchase_invoices_update_admin ON public.purchase_invoices FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));

-- purchase_invoice_items (hija): compras.gestionar + la factura de mi tienda
DROP POLICY IF EXISTS purchase_invoice_items_select ON public.purchase_invoice_items;
CREATE POLICY purchase_invoice_items_select ON public.purchase_invoice_items FOR SELECT
  USING (
    has_permission('compras.gestionar')
    AND EXISTS (
      SELECT 1 FROM public.purchase_invoices i
       WHERE i.id = purchase_invoice_items.invoice_id AND i.store_id = get_my_store_id()
    )
  );
DROP POLICY IF EXISTS purchase_invoice_items_insert_admin ON public.purchase_invoice_items;
CREATE POLICY purchase_invoice_items_insert_admin ON public.purchase_invoice_items FOR INSERT
  WITH CHECK (
    has_permission('compras.gestionar')
    AND EXISTS (
      SELECT 1 FROM public.purchase_invoices i
       WHERE i.id = purchase_invoice_items.invoice_id AND i.store_id = get_my_store_id()
    )
  );

-- supplier_payments
DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('compras.gestionar'));
DROP POLICY IF EXISTS supplier_payments_insert_admin ON public.supplier_payments;
CREATE POLICY supplier_payments_insert_admin ON public.supplier_payments FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('compras.gestionar'));


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (manual, simulando cada rol)
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<user_uuid>","role":"authenticated"}';
-- Para los casos que deben FALLAR: el error esperado es
--   "new row violates row-level security policy" (escritura) o 0 filas (lectura).
-- ============================================================
-- ── VENDEDOR (debe PODER lo operativo) ──
--   - INSERT orders (pos.usar)                         → OK
--   - INSERT layaways / layaway_payments (separados)   → OK
--   - INSERT returns (devoluciones)                    → OK
--   - INSERT customers (clientes.gestionar)            → OK
--   - INSERT cash_expenses (gastos.gestionar)          → OK
--   - INSERT cash_shifts / abrir turno (pos.usar)      → OK
-- ── VENDEDOR (NO debe poder) ──
--   - INSERT products / variants / categories          → FALLA (productos.gestionar)
--   - DELETE customers                                 → FALLA (clientes.eliminar)
--   - DELETE layaways                                  → FALLA (separados.eliminar)
--   - UPDATE orders (anular)                           → FALLA (ventas.anular)
--   - INSERT stock_movements (ajuste manual)           → FALLA (inventario.gestionar)
--   - INSERT/UPDATE suppliers, purchase_invoices       → FALLA (compras.gestionar)
--   - SELECT suppliers / purchase_invoices / _items /
--     supplier_payments                                → 0 filas (compras.gestionar)
-- ── ADMINISTRADOR ──
--   - Todo lo anterior (operativo + gestión + back-office) → OK
--     (tiene productos/clientes.eliminar/ventas.anular/inventario/compras…)
-- ── DUEÑO ('*') ──
--   - has_permission de cualquier cosa = true → pasa TODAS las políticas.
-- ── AISLAMIENTO entre orgs ──
--   - INTACTO: ninguna política tocó store_id = get_my_store_id(); el barrido
--     solo SUMÓ has_permission. Un usuario sigue sin ver/escribir otra org.
-- ============================================================
