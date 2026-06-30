-- ============================================================
-- 022 — Multi-tenancy FASE 3 de 6: blindaje del encadenamiento org → tienda
--
-- Objetivo (fase CRÍTICA de aislamiento entre organizaciones):
--   Cerrar la cadena por la que un usuario solo puede acceder a tiendas de SU
--   organización:
--       ver datos ⇒ tienda activa ⇒ user_stores ⇒ tienda de tu org
--   Hoy el RLS de datos filtra por store_id = get_my_store_id() (= la tienda
--   ACTIVA, current_store_id). Si un usuario pudiera ACTIVARSE una tienda de
--   otra organización, vería los datos de esa org. Esta migración impide eso.
--
-- Agujeros que cierra (detectados en 001/013/014):
--   A) profiles_update_own_or_admin (001) NO tenía WITH CHECK → un usuario
--      podía UPDATE su current_store_id a CUALQUIER tienda (incl. de otra org)
--      por la API, saltándose switch_active_store().
--   B) user_stores (013/014) solo checaba get_my_role()='admin', SIN scope de
--      organización → un admin podía asignar/ver accesos a tiendas de otra org.
--
-- Defensa en profundidad:
--   - RLS (control de acceso): solo activas/asignas tiendas que te pertenecen.
--   - TRIGGER (aislamiento): un profile NUNCA puede apuntar (base o activa) a
--     una tienda de otra organización, por cualquier vía (API, función, admin).
--
-- Atomicidad: todo en BEGIN/COMMIT. Idempotente (CREATE OR REPLACE / DROP IF
--   EXISTS). NO toca el RLS de las tablas de datos de negocio (eso es la Fase 4,
--   el barrido de has_permission). NO toca TypeScript.
--
-- Requiere: Fases 1 (020) y 2 (021) aplicadas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Helper SECURITY DEFINER: ¿la tienda es de MI organización?
--    Necesario porque las subconsultas dentro de políticas RLS respetan el RLS
--    de la tabla referenciada; el RLS de stores solo deja ver la tienda activa,
--    así que un SELECT directo sobre stores no serviría para "todas las de mi
--    org". SECURITY DEFINER lo evita (mismo patrón que get_my_store_id()).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_store_in_my_org(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.stores
     WHERE id = target_store_id
       AND organization_id = get_my_organization_id()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_store_in_my_org(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.is_store_in_my_org(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 1. Blindar el cambio de tienda activa (profiles UPDATE + WITH CHECK)
--    La política de 001 solo tenía USING (sin WITH CHECK), por lo que el valor
--    NUEVO de current_store_id no se validaba. Se recrea agregando WITH CHECK:
--    en una auto-edición, la nueva tienda activa debe ser la base o una de las
--    user_stores del propio usuario. (El trigger del bloque 3 garantiza además
--    que sea de su organización, cerrando cualquier resquicio.)
--    Se conserva la rama admin (gestiona perfiles de su tienda activa).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR (store_id = get_my_store_id() AND get_my_role() = 'admin')
  )
  WITH CHECK (
    (
      -- Auto-edición: la tienda activa debe ser accesible para el usuario.
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
      -- Admin gestiona perfiles de su tienda activa (misma org por el trigger).
      get_my_role() = 'admin'
      AND store_id = get_my_store_id()
    )
  );


-- ------------------------------------------------------------
-- 2. Blindar la asignación de accesos (user_stores)
--    Se reemplazan las políticas de 013/014 (solo get_my_role()='admin', sin
--    scope de org) por políticas org-scoped:
--      - SELECT : ves tus propios accesos; o, si gestionas usuarios, los de las
--                 tiendas de TU organización.
--      - INSERT/UPDATE/DELETE: solo sobre tiendas de TU organización y con el
--                 permiso 'usuarios.gestionar'.
--    is_store_in_my_org() asegura que la tienda objetivo sea de la org del que
--    asigna; has_permission('usuarios.gestionar') que tenga la atribución.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "user_stores_select_own"   ON public.user_stores;
DROP POLICY IF EXISTS "user_stores_select_admin" ON public.user_stores;
DROP POLICY IF EXISTS "user_stores_insert_admin" ON public.user_stores;
DROP POLICY IF EXISTS "user_stores_delete_admin" ON public.user_stores;

CREATE POLICY "user_stores_select_own_or_manage"
  ON public.user_stores FOR SELECT
  USING (
    user_id = auth.uid()
    OR (has_permission('usuarios.gestionar') AND is_store_in_my_org(store_id))
  );

CREATE POLICY "user_stores_insert_manage"
  ON public.user_stores FOR INSERT
  WITH CHECK (
    has_permission('usuarios.gestionar') AND is_store_in_my_org(store_id)
  );

CREATE POLICY "user_stores_update_manage"
  ON public.user_stores FOR UPDATE
  USING (
    has_permission('usuarios.gestionar') AND is_store_in_my_org(store_id)
  )
  WITH CHECK (
    has_permission('usuarios.gestionar') AND is_store_in_my_org(store_id)
  );

CREATE POLICY "user_stores_delete_manage"
  ON public.user_stores FOR DELETE
  USING (
    has_permission('usuarios.gestionar') AND is_store_in_my_org(store_id)
  );


-- ------------------------------------------------------------
-- 3. Coherencia org ↔ tienda en profiles (TRIGGER) — defensa en profundidad
--    (Recomendado: ver nota al final.) Garantiza que store_id (base) y
--    current_store_id (activa) de un profile SIEMPRE sean de la misma
--    organización que profiles.organization_id. Cierra TODA vía: API directa,
--    switch_active_store(), asignación por admin, INSERT de usuario nuevo.
--    Esto es lo que blinda get_my_store_id() (COALESCE(current_store_id,
--    store_id)) contra devolver una tienda de otra org (bloque 4): si ninguno
--    de los dos puede ser de otra org, get_my_store_id() tampoco.
--
--    SECURITY DEFINER: el trigger lee stores; sin esto, el RLS de stores
--    (solo la tienda activa visible) haría que la lectura devolviera NULL para
--    otras tiendas y disparara falsos positivos.
-- ------------------------------------------------------------

-- 3a. Pre-check: los datos EXISTENTES ya deben ser coherentes. Si no, abortar
--     (no se activa el aislamiento sobre datos inconsistentes). Con una sola
--     org (La Bodega) esto es trivialmente cierto; es una red para producción.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.profiles p
    LEFT JOIN public.stores sb ON sb.id = p.store_id
    LEFT JOIN public.stores sc ON sc.id = p.current_store_id
   WHERE (p.store_id        IS NOT NULL AND sb.organization_id IS DISTINCT FROM p.organization_id)
      OR (p.current_store_id IS NOT NULL AND sc.organization_id IS DISTINCT FROM p.organization_id);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Hay % profile(s) con store_id/current_store_id de otra organización. Corrige antes de activar el blindaje (rollback total).', v_bad;
  END IF;
  RAISE NOTICE 'Coherencia org<->tienda OK en profiles existentes.';
END;
$$;

-- 3b. La función + el trigger.
CREATE OR REPLACE FUNCTION public.enforce_profile_store_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_org   uuid;
  v_current_org uuid;
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    SELECT organization_id INTO v_store_org FROM public.stores WHERE id = NEW.store_id;
    IF v_store_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'profiles.store_id apunta a una tienda de otra organización (aislamiento multi-tenant).';
    END IF;
  END IF;

  IF NEW.current_store_id IS NOT NULL THEN
    SELECT organization_id INTO v_current_org FROM public.stores WHERE id = NEW.current_store_id;
    IF v_current_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'profiles.current_store_id apunta a una tienda de otra organización (aislamiento multi-tenant).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_store_org ON public.profiles;
CREATE TRIGGER trg_profiles_store_org
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_profile_store_org();


-- ------------------------------------------------------------
-- 4. get_my_store_id() — SIN cambios (confirmación)
--    Hoy hace COALESCE(current_store_id, store_id). Con el trigger del bloque 3,
--    ni current_store_id ni store_id pueden ser de otra organización, por lo que
--    get_my_store_id() no puede devolver una tienda ajena. No se redefine para
--    no alterar la función que usa TODO el RLS; el blindaje vive en (1) y (3).
-- ------------------------------------------------------------


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (manual)
-- ============================================================
-- NOTA: las pruebas de AISLAMIENTO requieren una 2ª organización. Para no
-- ensuciar el lab, se hacen dentro de una transacción con ROLLBACK (NO crean
-- nada permanente). NO es una org de prueba "real": vive solo durante el test.
--
-- ── Caso 1: un usuario NO puede activarse una tienda de OTRA org ────────────
--   BEGIN;
--     INSERT INTO public.organizations (id, name)
--       VALUES ('00000000-0000-0000-0000-0000000000b2', 'Org B (test)');
--     INSERT INTO public.stores (id, name, organization_id)
--       VALUES ('00000000-0000-0000-0000-0000000000s2', 'Tienda B', '00000000-0000-0000-0000-0000000000b2');
--     -- intento directo (lo bloquea el TRIGGER, incluso como postgres):
--     UPDATE public.profiles
--        SET current_store_id = '00000000-0000-0000-0000-0000000000s2'
--      WHERE id = (SELECT id FROM auth.users LIMIT 1);
--     -- ESPERADO: ERROR 'current_store_id apunta a una tienda de otra organización'
--   ROLLBACK;
--
-- ── Caso 2: un usuario NO puede asignar(se) user_stores de una tienda ajena ─
--   (como un ADMINISTRADOR autenticado de La Bodega)
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claims" = '{"sub":"<admin_uuid>","role":"authenticated"}';
--   -- store de otra org (usar el id real de una tienda que NO sea de tu org):
--   INSERT INTO public.user_stores (user_id, store_id)
--     VALUES ('<admin_uuid>', '<store_de_otra_org>');
--   -- ESPERADO: ERROR de RLS (new row violates row-level security policy),
--   --           porque is_store_in_my_org('<store_de_otra_org>') = false.
--
-- ── Caso 3: activar una tienda de TU org a la que NO tienes user_stores ─────
--   (como VENDEDOR autenticado, intentando saltar a una 2ª sede de su org)
--   UPDATE public.profiles SET current_store_id = '<otra_sede_de_mi_org>'
--    WHERE id = auth.uid();
--   -- ESPERADO: violación de RLS (WITH CHECK): la tienda no está en user_stores
--   --           ni es su base. (La cadena exige user_stores.)
--
-- ── Caso 4: el camino LEGÍTIMO sigue funcionando ───────────────────────────
--   SELECT switch_active_store('<una_tienda_en_mis_user_stores>');  -- OK
--   SELECT get_my_store_id();                                        -- la nueva
--   SELECT count(*) FROM public.products;  -- ve SOLO los datos de esa tienda
--
-- ── Caso 5: el aislamiento de datos "cae solo" ─────────────────────────────
--   Como no puedes activar una tienda de otra org (casos 1-3), get_my_store_id()
--   nunca apunta fuera de tu org, y el RLS de las tablas de datos (store_id =
--   get_my_store_id(), intacto) jamás devuelve datos de otra organización.
-- ============================================================
