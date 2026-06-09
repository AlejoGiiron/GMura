-- ============================================================
-- 016 — profiles: el usuario SIEMPRE puede leer su propio perfil
--
-- Bug (logout al cambiar de tienda):
--   La política profiles_select_same_store (001) filtraba el SELECT solo por
--   store_id = get_my_store_id() (la tienda ACTIVA). profiles.store_id es la
--   tienda BASE y nunca cambia, pero get_my_store_id() devuelve current_store_id.
--   Un admin multi-tienda que cambia a una tienda distinta a su base dejaba de
--   poder leer su PROPIA fila → refreshProfile y fetchProfile fallaban → se
--   cerraba la sesión en bucle hasta resetear current_store_id por SQL.
--
-- Fix:
--   El usuario siempre puede leerse a sí mismo (id = auth.uid()), además de ver
--   los perfiles de su tienda activa (para gestionar el equipo). La segunda
--   condición sigue acotando: no expone perfiles de otras tiendas.
-- ============================================================

DROP POLICY IF EXISTS "profiles_select_same_store" ON public.profiles;

CREATE POLICY "profiles_select_same_store"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR store_id = get_my_store_id()
  );


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (como admin multi-tienda)
-- ============================================================
-- 1. Cambiar a una tienda que NO sea la base:
--      SELECT switch_active_store('<otra_store_uuid>');
-- 2. El usuario debe seguir viendo su propio perfil (antes daba 0 filas):
--      SELECT id, store_id, current_store_id FROM profiles WHERE id = auth.uid();
--      -- debe devolver 1 fila
-- 3. Sigue viendo el equipo de la tienda activa y NO el de otras tiendas.
-- ============================================================
