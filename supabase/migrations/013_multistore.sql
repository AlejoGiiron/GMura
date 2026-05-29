-- ============================================================
-- 013 — Acceso multi-tienda para administradores
--
-- Modelo:
--   - Cada tienda sigue 100% independiente (todo por store_id).
--   - Solo los ADMIN pueden pertenecer a varias tiendas (user_stores).
--   - Los vendedores siguen atados a una sola tienda (profiles.store_id).
--   - La "tienda activa" vive en profiles.current_store_id y es lo que
--     get_my_store_id() devuelve → TODO el RLS opera sobre la tienda activa.
--
-- ⚠️ CRÍTICO: este archivo redefine get_my_store_id(), función que usa
--    TODO el sistema de RLS. Verificar con cuidado tras aplicar (ver
--    sección de verificación al final).
-- ============================================================


-- ── 1. Tabla user_stores (relación admin ↔ tiendas) ──────────────────────────
CREATE TABLE public.user_stores (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id    uuid        NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, store_id)
);

COMMENT ON TABLE public.user_stores IS
  'Tiendas a las que un admin tiene acceso. Los vendedores no usan
   esta tabla (su única tienda es profiles.store_id).';

CREATE INDEX idx_user_stores_user_id  ON user_stores(user_id);
CREATE INDEX idx_user_stores_store_id ON user_stores(store_id);


-- ── 2. Columna current_store_id en profiles ──────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN current_store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.current_store_id IS
  'Tienda activa seleccionada. Para vendedores = store_id.
   Para admins multi-tienda = la que eligieron en el switcher.';

-- Backfill: current_store_id = store_id para todos los usuarios actuales
UPDATE public.profiles SET current_store_id = store_id
WHERE current_store_id IS NULL;

-- Backfill: poblar user_stores con la tienda actual de cada admin
INSERT INTO public.user_stores (user_id, store_id)
SELECT id, store_id FROM public.profiles WHERE role = 'admin'
ON CONFLICT (user_id, store_id) DO NOTHING;


-- ── 3. Redefinir get_my_store_id() → devuelve la tienda ACTIVA ────────────────
-- El COALESCE garantiza que si current_store_id es null (estado raro), cae de
-- vuelta a store_id. Defensa contra estados inconsistentes.
CREATE OR REPLACE FUNCTION get_my_store_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(current_store_id, store_id)
  FROM public.profiles WHERE id = auth.uid();
$$;


-- ── 4. switch_active_store(target) — usado por el switcher ────────────────────
CREATE OR REPLACE FUNCTION switch_active_store(target_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role user_role;
  v_has_access boolean;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  -- Verificar que el usuario tiene acceso a esa tienda
  IF v_role = 'admin' THEN
    SELECT EXISTS(
      SELECT 1 FROM user_stores
      WHERE user_id = auth.uid() AND store_id = target_store_id
    ) INTO v_has_access;
  ELSE
    -- Vendedores solo pueden "cambiar" a su propia tienda
    SELECT (store_id = target_store_id) INTO v_has_access
    FROM profiles WHERE id = auth.uid();
  END IF;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'No tienes acceso a esta tienda';
  END IF;

  UPDATE profiles SET current_store_id = target_store_id
  WHERE id = auth.uid();
END;
$$;


-- ── 5. get_my_stores() — lista de tiendas del usuario ─────────────────────────
CREATE OR REPLACE FUNCTION get_my_stores()
RETURNS TABLE (
  store_id uuid,
  store_name text,
  is_current boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    (s.id = (SELECT current_store_id FROM profiles WHERE id = auth.uid()))
  FROM stores s
  WHERE s.id IN (
    -- Admins: todas sus tiendas en user_stores
    SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    UNION
    -- Todos: su tienda base
    SELECT store_id FROM profiles WHERE id = auth.uid()
  )
  ORDER BY s.name;
$$;


-- ── 6. RLS para user_stores ───────────────────────────────────────────────────
ALTER TABLE user_stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_stores_select_own"
  ON user_stores FOR SELECT
  USING (user_id = auth.uid());

-- Solo admins pueden gestionar accesos (asignar tiendas a usuarios)
CREATE POLICY "user_stores_insert_admin"
  ON user_stores FOR INSERT
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "user_stores_delete_admin"
  ON user_stores FOR DELETE
  USING (get_my_role() = 'admin');


-- ── 7. Política de UPDATE en profiles ─────────────────────────────────────────
-- No requiere cambios: la política existente profiles_update_own_or_admin
-- (migración 001) ya permite UPDATE cuando id = auth.uid(), por lo que el
-- usuario puede actualizar su propio current_store_id (vía switch_active_store,
-- que además es SECURITY DEFINER).


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar como un usuario autenticado)
-- ============================================================
-- 1. La tienda activa resuelve correctamente (no debe ser NULL):
--      SELECT get_my_store_id();
--
-- 2. Lista de tiendas del usuario (is_current = true en la activa):
--      SELECT * FROM get_my_stores();
--
-- 3. Cambiar de tienda (solo a una a la que se tenga acceso):
--      SELECT switch_active_store('<store_uuid>');
--      SELECT get_my_store_id();  -- debe reflejar la nueva tienda
--
-- 4. Sanity check del RLS general: un usuario sigue viendo SUS datos
--      SELECT count(*) FROM products;   -- > 0 si la tienda activa tiene catálogo
--
-- ⚠️ Si get_my_store_id() devolviera NULL para algún usuario, el RLS lo
--    dejaría sin datos. El backfill del paso 2 + el COALESCE del paso 3 lo
--    evitan, pero conviene confirmar:
--      SELECT id, store_id, current_store_id FROM profiles
--      WHERE current_store_id IS NULL;   -- debe devolver 0 filas
-- ============================================================
