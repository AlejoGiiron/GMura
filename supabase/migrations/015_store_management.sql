-- ============================================================
-- 015 — Gestión de sucursales desde la app
--
-- Modelo:
--   - Cualquier ADMIN puede crear sucursales.
--   - Al crear una, el admin creador queda con acceso automático
--     (fila en user_stores) → un admin de una sola tienda puede crear
--     su segunda sin quedar bloqueado por el RLS.
--   - Cada tienda es 100% independiente (no se copian datos).
-- ============================================================


-- ── 1. Columna is_active en stores ───────────────────────────────────────────
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.stores.is_active IS
  'Sucursal activa. Soft-flag para marcar sucursales fuera de operación.';


-- ── 2. create_store_with_access() — crea tienda + acceso al creador ───────────
-- Atómica y SECURITY DEFINER (bypassa RLS para el INSERT en stores/user_stores).
CREATE OR REPLACE FUNCTION create_store_with_access(
  p_name    text,
  p_address text DEFAULT NULL,
  p_phone   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role         user_role;
  v_user_id      uuid;
  v_new_store_id uuid;
BEGIN
  v_user_id := auth.uid();

  -- Solo admins pueden crear sucursales
  SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo los administradores pueden crear sucursales';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'El nombre de la sucursal es requerido';
  END IF;

  -- Crear la tienda (config e is_active toman sus defaults)
  INSERT INTO stores (name, address, phone)
  VALUES (trim(p_name), p_address, p_phone)
  RETURNING id INTO v_new_store_id;

  -- Dar acceso automático al admin creador
  INSERT INTO user_stores (user_id, store_id)
  VALUES (v_user_id, v_new_store_id)
  ON CONFLICT (user_id, store_id) DO NOTHING;

  RETURN v_new_store_id;
END;
$$;


-- ── 3. Ampliar RLS de stores a TODAS las tiendas accesibles ───────────────────
-- Las políticas de 001 (stores_select_own / stores_update_admin) solo cubren la
-- tienda ACTIVA (id = get_my_store_id()). Para gestionar varias sucursales el
-- admin debe poder ver y editar cualquier tienda a la que tenga acceso
-- (user_stores). Se agregan políticas ADITIVAS (permissive → se combinan con OR),
-- sin tocar las existentes.

CREATE POLICY "stores_select_accessible"
  ON public.stores FOR SELECT
  USING (
    id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
  );

CREATE POLICY "stores_update_accessible_admin"
  ON public.stores FOR UPDATE
  USING (
    get_my_role() = 'admin'
    AND id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
  );

-- Nota: el INSERT de stores se hace SOLO vía create_store_with_access()
-- (SECURITY DEFINER), por lo que no se requiere una política de INSERT.


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Crear una sucursal como admin autenticado:
--      SELECT create_store_with_access('Sucursal Centro', 'Cra 1 #2-3', '3001234567');
--
-- 2. Debe aparecer en mis tiendas y en user_stores:
--      SELECT * FROM get_my_stores();
--      SELECT s.name FROM user_stores us JOIN stores s ON s.id = us.store_id
--        WHERE us.user_id = auth.uid();
--
-- 3. Editar una sucursal accesible (no necesariamente la activa):
--      UPDATE stores SET address = 'Nueva dir' WHERE id = '<store_uuid>';
--      -- debe permitirlo si está en mi user_stores
--
-- 4. Un vendedor NO puede crear:
--      SELECT create_store_with_access('X');  -- debe lanzar excepción
-- ============================================================
