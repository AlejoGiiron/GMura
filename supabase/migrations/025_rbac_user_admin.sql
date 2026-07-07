-- ============================================================
-- 025 — Multi-tenancy FASE 6A (parte SQL): coherencia RBAC en profiles
--
-- Dos cambios, ambos sobre profiles, sin tocar el enum legacy ni TypeScript:
--
--   1. Política UPDATE de profiles: la rama de GESTIÓN deja de gatear por el
--      enum (get_my_role()='admin') y pasa a permiso (has_permission(
--      'usuarios.gestionar')). Así, quien tenga ese permiso —no quien sea
--      "admin" por enum— puede administrar perfiles. La rama de AUTO-EDICIÓN
--      (id = auth.uid()) y TODO el blindaje de 022 (WITH CHECK de
--      current_store_id) se conservan idénticos: NO se reabre el agujero que
--      022 cerró.
--
--   2. Coherencia role_id ↔ organización: un profile no puede tener un role_id
--      de OTRA organización. Se extiende el trigger enforce_profile_store_org
--      (022) para validarlo en INSERT/UPDATE. Se extiende el MISMO trigger (en
--      vez de crear uno nuevo) porque es la misma invariante —"el profile debe
--      ser consistente con su org"— y así el orden de ejecución queda
--      garantizado (una sola función BEFORE INSERT/UPDATE).
--
-- Atómica (BEGIN/COMMIT), idempotente, comentada.
-- NO toca: el enum role, el aislamiento por store_id, ni código.
-- Requiere: Fases 020-024 aplicadas.
--
-- NOTA: el alta de usuarios sigue caída hasta arreglar la Edge Function
-- create-user (debe setear organization_id + role_id). Eso es la parte de
-- CÓDIGO de 6A; esta migración solo prepara la coherencia en la BD.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Política UPDATE de profiles: gestión por permiso, no por enum
--    Idéntica a la de 022 salvo que get_my_role()='admin' →
--    has_permission('usuarios.gestionar') en USING y WITH CHECK.
--    La rama id = auth.uid() y su WITH CHECK de current_store_id NO cambian.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR (store_id = get_my_store_id() AND has_permission('usuarios.gestionar'))
  )
  WITH CHECK (
    (
      -- Auto-edición: la tienda activa debe ser accesible para el usuario
      -- (blindaje de 022, intacto).
      id = auth.uid()
      AND (
        current_store_id IS NULL
        OR current_store_id = store_id
        OR current_store_id IN (
             SELECT store_id FROM public.user_stores WHERE user_id = auth.uid()
           )
      )
    )
    OR (
      -- Gestión: quien tenga usuarios.gestionar administra perfiles de su
      -- tienda activa (misma org garantizada por el trigger).
      has_permission('usuarios.gestionar')
      AND store_id = get_my_store_id()
    )
  );


-- ------------------------------------------------------------
-- 2a. Pre-check: los datos EXISTENTES ya deben ser coherentes en role_id ↔ org.
--     Con el backfill de 021 (cada usuario de La Bodega tiene un role_id de su
--     org) esto pasa trivialmente; es una red de seguridad para producción.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role_id
   WHERE p.role_id IS NOT NULL
     AND r.organization_id IS DISTINCT FROM p.organization_id;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Hay % profile(s) con role_id de otra organización. Corrige antes de activar el check (rollback total).', v_bad;
  END IF;
  RAISE NOTICE 'Coherencia role_id<->org OK en profiles existentes.';
END;
$$;

-- ------------------------------------------------------------
-- 2b. Extender enforce_profile_store_org: además de store_id/current_store_id,
--     valida que role_id (si no es NULL) sea de la MISMA organización que el
--     profile. SECURITY DEFINER para leer roles sin que el RLS lo limite.
--     El trigger trg_profiles_store_org (022) sigue apuntando a esta función;
--     basta CREATE OR REPLACE de la función (no hay que recrear el trigger).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_store_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_org   uuid;
  v_current_org uuid;
  v_role_org    uuid;
BEGIN
  -- store_id base debe ser de la org del profile (022, sin cambios)
  IF NEW.store_id IS NOT NULL THEN
    SELECT organization_id INTO v_store_org FROM public.stores WHERE id = NEW.store_id;
    IF v_store_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'profiles.store_id apunta a una tienda de otra organización (aislamiento multi-tenant).';
    END IF;
  END IF;

  -- current_store_id (tienda activa) debe ser de la org del profile (022, sin cambios)
  IF NEW.current_store_id IS NOT NULL THEN
    SELECT organization_id INTO v_current_org FROM public.stores WHERE id = NEW.current_store_id;
    IF v_current_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'profiles.current_store_id apunta a una tienda de otra organización (aislamiento multi-tenant).';
    END IF;
  END IF;

  -- NUEVO (025): role_id debe ser un rol de la org del profile
  IF NEW.role_id IS NOT NULL THEN
    SELECT organization_id INTO v_role_org FROM public.roles WHERE id = NEW.role_id;
    IF v_role_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'profiles.role_id pertenece a un rol de otra organización (aislamiento multi-tenant).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Rebind idempotente del trigger (existe desde 022; se reasegura por si la
-- migración se aplica en un entorno donde no estuviera).
DROP TRIGGER IF EXISTS trg_profiles_store_org ON public.profiles;
CREATE TRIGGER trg_profiles_store_org
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_profile_store_org();


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (manual, simulando usuarios autenticados)
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<uid>","role":"authenticated"}';
-- ============================================================
-- 1. Un usuario con usuarios.gestionar (Administrador/Dueño) asigna un rol de
--    SU org a un usuario de su tienda activa → OK:
--      UPDATE public.profiles SET role_id = '<role_id_de_mi_org>'
--       WHERE id = '<usuario_de_mi_tienda>';     -- UPDATE 1
--
-- 2. Asignar un role_id de OTRA org → FALLA por el trigger:
--      -- (como postgres o como gestor) en una tx de prueba:
--      BEGIN;
--        INSERT INTO public.organizations (id, name)
--          VALUES ('00000000-0000-0000-0000-0000000000b2','Org B (test)');
--        INSERT INTO public.roles (id, organization_id, name, permissions)
--          VALUES ('00000000-0000-0000-0000-0000000000r2',
--                  '00000000-0000-0000-0000-0000000000b2','Rol B','["pos.usar"]');
--        UPDATE public.profiles SET role_id = '00000000-0000-0000-0000-0000000000r2'
--         WHERE id = '<un_usuario_de_La_Bodega>';
--        -- ESPERADO: ERROR 'profiles.role_id pertenece a un rol de otra organización'
--      ROLLBACK;
--
-- 3. Un usuario SIN usuarios.gestionar (Vendedor) intenta cambiar el rol de
--    otro → bloqueado (USING falla → UPDATE 0, sin error):
--      UPDATE public.profiles SET role_id = '<otro_role_de_mi_org>'
--       WHERE id = '<otro_usuario>';             -- UPDATE 0
--
-- 4. El aislamiento de 022 sigue intacto: activar una tienda de otra org
--    sigue fallando por el mismo trigger:
--      UPDATE public.profiles SET current_store_id = '<tienda_de_otra_org>'
--       WHERE id = auth.uid();                   -- ERROR (current_store_id ... otra org)
--
-- 5. Auto-edición del propio perfil sigue funcionando (tienda activa válida):
--      UPDATE public.profiles SET current_store_id = '<tienda_en_mis_user_stores>'
--       WHERE id = auth.uid();                   -- UPDATE 1
-- ============================================================
