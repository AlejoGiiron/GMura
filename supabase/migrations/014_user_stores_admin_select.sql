-- ============================================================
-- 014 — Admins pueden leer accesos de otros usuarios (gestión)
--
-- La migración 013 solo dejó leer las filas propias de user_stores
-- (user_stores_select_own: user_id = auth.uid()). Para que un admin
-- pueda GESTIONAR los accesos de otros admins desde Configuración
-- (mostrar qué tiendas tienen marcadas), necesita poder leerlas.
--
-- Las políticas de INSERT/DELETE para admin ya existen (013); esto
-- solo agrega el SELECT. Se mantiene la política _own para vendedores.
-- ============================================================

CREATE POLICY "user_stores_select_admin"
  ON public.user_stores FOR SELECT
  USING (get_my_role() = 'admin');

-- ============================================================
-- VERIFICACIÓN (como admin autenticado):
--   SELECT user_id, store_id FROM user_stores;  -- debe listar varias filas
-- ============================================================
