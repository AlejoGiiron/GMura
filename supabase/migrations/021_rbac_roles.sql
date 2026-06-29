-- ============================================================
-- 021 — Multi-tenancy FASE 2 de 6: RBAC (roles + permisos por organización)
--
-- Objetivo:
--   Añadir control de acceso basado en roles (RBAC) copiando el patrón ya
--   probado en G-vento: una tabla `roles` POR ORGANIZACIÓN, cada rol con un
--   array `permissions` (jsonb) de strings de permiso, y una función
--   has_permission(perm) que el RLS y la UI consultarán. El rol "Dueño" usa
--   el comodín '*' = todos los permisos.
--
-- Relación con el enum actual:
--   profiles.role (enum user_role 'admin'/'seller') se MANTIENE intacto por
--   compatibilidad: la app lo sigue leyendo hasta la Fase 5. Aquí solo se
--   AÑADE profiles.role_id (el nuevo RBAC), poblado por backfill desde el enum.
--
-- Atomicidad:
--   Todo el archivo va en una única transacción (BEGIN/COMMIT). Si cualquier
--   paso falla, se revierte TODO y la BD queda como estaba.
--
-- Cómo aplicar (manual / lab):
--   ./scripts/lab-apply-migration.sh 021_rbac_roles.sql
--   (o psql -v ON_ERROR_STOP=1 -f supabase/migrations/021_rbac_roles.sql)
--
-- Esta migración NO toca:
--   - El RLS de las tablas de datos (sigue 100% por store_id; meter
--     has_permission en esas políticas es la Fase 4).
--   - El enum user_role ni la columna profiles.role.
--   - Código TypeScript (la UI de permisos es la Fase 5).
--
-- Requiere: Fase 1 (020) aplicada — organizations + get_my_organization_id().
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Tabla roles
--    Un conjunto de permisos con nombre, POR organización.
--    permissions: array jsonb de strings (ej. ["pos.usar","reportes.ver"]).
--    El rol dueño usa ["*"] como comodín de "todos los permisos".
--    UNIQUE (organization_id, name): no dos roles homónimos en una misma org.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  permissions     jsonb       NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

COMMENT ON TABLE  public.roles             IS 'Roles RBAC por organización. Cada rol agrupa permisos en el array jsonb permissions.';
COMMENT ON COLUMN public.roles.permissions IS 'Array jsonb de strings de permiso. ["*"] = comodín (todos los permisos).';

-- Trigger updated_at (reutiliza set_updated_at() de 001_initial_schema.sql).
DROP TRIGGER IF EXISTS trg_roles_updated_at ON public.roles;
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Índice para los lookups de roles por organización.
CREATE INDEX IF NOT EXISTS idx_roles_organization_id ON public.roles(organization_id);

-- Protección de inmutabilidad del rol Dueño.
--   Cualquier rol cuyo permissions contenga el comodín '*' (= el Dueño) NO
--   puede editarse ni borrarse, ni siquiera por quien tenga roles.gestionar,
--   ni por el propio Dueño, ni desde la app. Se identifica por '*' (no por el
--   name) para que renombrar no sea una vía de escape.
--   IMPORTANTE: el trigger es solo UPDATE/DELETE (NO INSERT), así que el seed
--   inicial que crea el rol Dueño funciona sin problema.
CREATE OR REPLACE FUNCTION public.protect_owner_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.permissions ? '*' THEN
      RAISE EXCEPTION 'El rol Dueño no puede borrarse (es inmutable).';
    END IF;
    RETURN OLD;
  ELSE  -- UPDATE
    IF OLD.permissions ? '*' THEN
      RAISE EXCEPTION 'El rol Dueño es inmutable y no puede editarse.';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_roles_protect_owner ON public.roles;
CREATE TRIGGER trg_roles_protect_owner
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION protect_owner_role();

-- Consideración futura (no bloqueada ahora): alguien con roles.gestionar
-- podría intentar AÑADIR '*' a otro rol para escalar privilegios. Hoy solo el
-- Dueño tiene roles.gestionar (vía '*') y es de confianza, así que no se
-- bloquea. Si se abriera roles.gestionar a más roles, conviene endurecer el
-- trigger para prohibir setear '*' en un rol que no lo tenía (NEW vs OLD).


-- ------------------------------------------------------------
-- 2. Columna profiles.role_id (nullable por ahora; el backfill la llena)
--    ON DELETE SET NULL: si se borra un rol, sus usuarios quedan sin rol
--    (no se borran). El enum profiles.role NO se toca (compatibilidad app).
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_id uuid
  REFERENCES public.roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.role_id IS 'Rol RBAC del usuario (Fase 2). Convive con el enum role hasta la Fase 5.';

CREATE INDEX IF NOT EXISTS idx_profiles_role_id ON public.profiles(role_id);


-- ------------------------------------------------------------
-- 3. Seed de los 3 roles base + backfill de profiles.role_id (atómico)
--    - Busca la organización 'La Bodega del Jeans' (de la Fase 1).
--    - Crea (o re-sincroniza) los roles Dueño / Administrador / Vendedor.
--      Administrador/Vendedor: ON CONFLICT DO UPDATE permissions (idempotente,
--      determinista). Dueño: ON CONFLICT DO NOTHING, porque es inmutable por
--      trigger y un DO UPDATE en un re-run lo abortaría.
--      NO toca las asignaciones de usuarios (eso es el backfill de abajo, que
--      solo rellena role_id NULL → conserva reasignaciones manuales como el
--      Dueño real).
--    - Backfill: admin → 'Administrador', seller → 'Vendedor'.
--      (El Dueño real se reasigna A MANO; ver pregunta al final.)
--    - Verifica que ningún profile de la org quedó sin role_id. Si alguno
--      quedó NULL: RAISE NOTICE (no aborta — un profile sin rol no es fatal).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_org_id      uuid;
  v_role_admin  uuid;
  v_role_seller uuid;
  v_null_roles  integer;
BEGIN
  SELECT id INTO v_org_id
    FROM public.organizations
   WHERE name = 'La Bodega del Jeans'
   LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No existe la organización ''La Bodega del Jeans''. ¿Se aplicó la Fase 1 (020_organizations.sql)?';
  END IF;

  -- ── Rol Dueño: comodín total ──
  -- DO NOTHING (no DO UPDATE) a propósito: el trigger trg_roles_protect_owner
  -- bloquea cualquier UPDATE sobre un rol con '*'. Un DO UPDATE en un re-run
  -- dispararía ese UPDATE y abortaría la migración. El Dueño es inmutable y
  -- siempre ["*"], así que no necesita re-sincronizarse.
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (v_org_id, 'Dueño', '["*"]'::jsonb)
  ON CONFLICT (organization_id, name) DO NOTHING;

  -- ── Rol Administrador: operación + gestión ──
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (
    v_org_id, 'Administrador',
    '["pos.usar","separados.gestionar","devoluciones.gestionar","clientes.gestionar","inventario.ver","productos.gestionar","compras.gestionar","reportes.ver","gastos.ver","config.gestionar","usuarios.gestionar"]'::jsonb
  )
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions
  RETURNING id INTO v_role_admin;

  -- ── Rol Vendedor: solo operación ──
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (
    v_org_id, 'Vendedor',
    '["pos.usar","separados.gestionar","devoluciones.gestionar","clientes.gestionar","inventario.ver"]'::jsonb
  )
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions
  RETURNING id INTO v_role_seller;

  -- Si el rol ya existía, el DO UPDATE no siempre rellena RETURNING en todas
  -- las versiones; aseguramos los ids con un SELECT de respaldo.
  IF v_role_admin IS NULL THEN
    SELECT id INTO v_role_admin  FROM public.roles WHERE organization_id = v_org_id AND name = 'Administrador';
  END IF;
  IF v_role_seller IS NULL THEN
    SELECT id INTO v_role_seller FROM public.roles WHERE organization_id = v_org_id AND name = 'Vendedor';
  END IF;

  -- ── Backfill: mapea el enum actual al nuevo role_id (solo donde esté NULL) ──
  UPDATE public.profiles
     SET role_id = v_role_admin
   WHERE organization_id = v_org_id AND role = 'admin'  AND role_id IS NULL;

  UPDATE public.profiles
     SET role_id = v_role_seller
   WHERE organization_id = v_org_id AND role = 'seller' AND role_id IS NULL;

  -- ── Verificación NO fatal ──
  SELECT count(*) INTO v_null_roles
    FROM public.profiles
   WHERE organization_id = v_org_id AND role_id IS NULL;

  IF v_null_roles > 0 THEN
    RAISE NOTICE 'ATENCIÓN: % profile(s) de la org quedaron SIN role_id. Revisar manualmente.', v_null_roles;
  ELSE
    RAISE NOTICE 'Backfill RBAC OK: todos los profiles de la org tienen role_id.';
  END IF;
END;
$$;


-- ------------------------------------------------------------
-- 4. Función has_permission(perm)
--    Devuelve true si el rol del usuario autenticado incluye `perm`, o si
--    incluye el comodín '*' (Dueño). Usa el operador jsonb `?` (¿existe este
--    string como elemento del array?). SECURITY DEFINER para leer profiles+roles
--    sin disparar su RLS (sin recursión). Permisos solo para 'authenticated'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(perm text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.roles    r ON r.id = p.role_id
     WHERE p.id = auth.uid()
       AND (r.permissions ? perm OR r.permissions ? '*')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;


-- ------------------------------------------------------------
-- 5. RLS de roles
--    SELECT : todos los miembros de la org ven sus roles.
--    ESCRITURA: gated por has_permission('roles.gestionar') Y misma org.
--    Como 'roles.gestionar' lo tiene SOLO el Dueño (vía el comodín '*'), en la
--    práctica únicamente el Dueño puede crear/editar/borrar roles desde la app.
--    Además, el rol Dueño en sí es inmutable por el trigger del bloque 1.
--    (Las políticas de escritura son forward-compatibles para la UI de Fase 5
--     y NO afectan a nadie ahora: el seed/service_role bypassa RLS. Si
--     prefieres "seed only", basta borrar las 3 políticas de escritura.)
-- ------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select_org" ON public.roles;
CREATE POLICY "roles_select_org"
  ON public.roles FOR SELECT
  USING (organization_id = get_my_organization_id());

DROP POLICY IF EXISTS "roles_insert_manage" ON public.roles;
CREATE POLICY "roles_insert_manage"
  ON public.roles FOR INSERT
  WITH CHECK (
    organization_id = get_my_organization_id()
    AND has_permission('roles.gestionar')
  );

DROP POLICY IF EXISTS "roles_update_manage" ON public.roles;
CREATE POLICY "roles_update_manage"
  ON public.roles FOR UPDATE
  USING (
    organization_id = get_my_organization_id()
    AND has_permission('roles.gestionar')
  )
  WITH CHECK (
    organization_id = get_my_organization_id()
    AND has_permission('roles.gestionar')
  );

DROP POLICY IF EXISTS "roles_delete_manage" ON public.roles;
CREATE POLICY "roles_delete_manage"
  ON public.roles FOR DELETE
  USING (
    organization_id = get_my_organization_id()
    AND has_permission('roles.gestionar')
  );


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Los 3 roles base existen en la org (Dueño/Administrador/Vendedor):
--      SELECT name, permissions FROM public.roles ORDER BY name;
--
-- 2. Ningún profile de la org quedó sin role_id (debe dar 0):
--      SELECT count(*) FROM public.profiles WHERE role_id IS NULL;
--
-- 3. Mapeo enum → rol correcto:
--      SELECT p.role AS enum_role, r.name AS rbac_role, count(*)
--        FROM public.profiles p JOIN public.roles r ON r.id = p.role_id
--       GROUP BY 1, 2 ORDER BY 1;
--      -- esperado: admin→Administrador, seller→Vendedor
--
-- 4. has_permission() funciona como un usuario autenticado:
--      SET LOCAL ROLE authenticated;
--      SET LOCAL "request.jwt.claims" = '{"sub":"<user_uuid>","role":"authenticated"}';
--      SELECT has_permission('pos.usar');          -- true para Vendedor/Admin
--      SELECT has_permission('config.gestionar');  -- true Admin, false Vendedor
--      SELECT has_permission('lo.que.sea')         -- true SOLO si el rol es Dueño ('*')
--
-- 5. Distinción usuarios.gestionar vs roles.gestionar (como un ADMINISTRADOR):
--      SELECT has_permission('usuarios.gestionar');  -- true  (Admin SÍ gestiona usuarios)
--      SELECT has_permission('roles.gestionar');     -- false (Admin NO gestiona roles)
--    Y como DUEÑO ambos deben dar true (los cubre el comodín '*').
--
-- 6. El rol Dueño es INMUTABLE (ambos deben FALLAR con EXCEPTION):
--      UPDATE public.roles SET name = 'X'
--        WHERE permissions ? '*';                 -- ERROR: el rol Dueño es inmutable
--      DELETE FROM public.roles WHERE permissions ? '*';  -- ERROR: no puede borrarse
--
-- 7. Un rol normal SÍ se puede editar (debe funcionar, sin error):
--      UPDATE public.roles SET permissions = permissions
--        WHERE name = 'Vendedor';                 -- OK (0 cambios reales, pero no falla)
--
-- 8. RLS de roles: el usuario solo ve los roles de SU organización:
--      (con el rol authenticated seteado) SELECT name FROM public.roles;
--
-- 9. El enum sigue intacto (la app aún lo usa):
--      SELECT id, role, role_id FROM public.profiles;  -- ambas columnas pobladas
-- ============================================================
