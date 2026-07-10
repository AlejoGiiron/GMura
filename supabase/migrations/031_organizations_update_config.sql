-- ============================================================
-- 031 — Política UPDATE en organizations (editar la config del negocio)
--
-- Objetivo:
--   Permitir que la APP escriba en organizations.config para guardar ajustes
--   a nivel de todo el negocio (el primero: el texto de condiciones del
--   separado). Hoy no puede: la migración 020 solo creó la política SELECT
--   (organizations_select_own) y dejó organizations SIN UPDATE a propósito
--   ("las orgs se crean por seed SQL, no por la app"). Este archivo agrega
--   esa política UPDATE, bien acotada.
--
-- Acotación de seguridad (doble condición, idéntica en USING y WITH CHECK):
--   1. id = get_my_organization_id()  → un usuario SOLO puede tocar SU PROPIA
--      organización. No puede leer ni escribir la fila de otra org (mismo
--      aislamiento multi-tenant que el resto del RLS). USING filtra qué filas
--      existentes puede actualizar; WITH CHECK impide "mover" la fila a otra
--      org (cambiar el id/organization a una ajena).
--   2. has_permission('config.gestionar') → SOLO usuarios con el permiso de
--      configuración. Un vendedor (o cualquier rol sin config.gestionar) no
--      puede actualizar ni siquiera su propia org. El comodín '*' del Dueño
--      ya lo cubre has_permission() (ver 021).
--
-- Sin cambio de esquema: organizations.config ya es jsonb DEFAULT '{}'
--   (creada en 020). Esta migración es SOLO una política RLS.
--
-- Cómo aplicar (manual, recomendado):
--   psql "$GMURA_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/031_organizations_update_config.sql
--   (o pegarlo completo en el SQL Editor de Supabase como un solo script.)
--
-- Depende de:
--   - organizations + get_my_organization_id()  (020_organizations.sql)
--   - has_permission(text)                       (021_rbac_roles.sql)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Política UPDATE acotada: propia org + permiso config.gestionar.
-- Idempotente (DROP IF EXISTS antes del CREATE) para poder re-correr.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "organizations_update_config" ON public.organizations;
CREATE POLICY "organizations_update_config"
  ON public.organizations
  FOR UPDATE
  USING      (id = get_my_organization_id() AND has_permission('config.gestionar'))
  WITH CHECK (id = get_my_organization_id() AND has_permission('config.gestionar'));

COMMENT ON POLICY "organizations_update_config" ON public.organizations IS
  'Permite a la app editar la config del negocio (organizations.config) SOLO sobre la propia organización (id = get_my_organization_id()) y SOLO con el permiso config.gestionar. No abre organizations a cualquiera ni permite tocar otra org.';

-- ------------------------------------------------------------
-- ENDURECIMIENTO OPCIONAL (a nivel de columna) — DESACTIVADO por defecto.
--
-- La política de arriba es a nivel de FILA: un admin con config.gestionar
-- podría, técnicamente, cambiar TAMBIÉN otras columnas de SU org (hoy solo
-- 'name'; id/created_at/updated_at no son de negocio). El riesgo es bajo
-- (ver análisis abajo) y esto es consistente con el resto del repo (stores,
-- products, etc. también usan políticas de fila y confían en que la app solo
-- toca los campos correctos).
--
-- Si se quisiera blindar a que SOLO se pueda actualizar la columna 'config',
-- se haría con privilegios de columna (RLS no puede acotar por columna). El
-- trigger de updated_at (BEFORE UPDATE, 020) sigue funcionando porque modifica
-- NEW dentro del trigger y no requiere que el invocador tenga UPDATE sobre esa
-- columna. Descomentar solo tras probarlo en el lab:
--
--   REVOKE UPDATE ON public.organizations FROM authenticated;
--   GRANT  UPDATE (config) ON public.organizations TO authenticated;
--
-- (No lo aplico ahora para no arriesgar los flujos de seed/admin; queda como
--  decisión explícita para el lab.)
-- ------------------------------------------------------------

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. La política existe y es de UPDATE sobre organizations:
--      SELECT policyname, cmd, qual, with_check
--        FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'organizations';
--    -> debe listar organizations_select_own (SELECT) y
--       organizations_update_config (UPDATE) con ambas condiciones.
--
-- 2. Como usuario CON config.gestionar, puede actualizar SU config:
--      UPDATE public.organizations
--         SET config = config || '{"__probe__": true}'::jsonb
--       WHERE id = get_my_organization_id();
--    -> UPDATE 1. (Luego limpiar: SET config = config - '__probe__'.)
--
-- 3. NO puede tocar OTRA org (aislamiento multi-tenant):
--      UPDATE public.organizations
--         SET config = '{}'::jsonb
--       WHERE id <> get_my_organization_id();
--    -> UPDATE 0 (la política de fila no deja ninguna otra).
--
-- 4. Un usuario SIN config.gestionar (p.ej. un vendedor), autenticado como él:
--      UPDATE public.organizations
--         SET config = '{}'::jsonb
--       WHERE id = get_my_organization_id();
--    -> UPDATE 0 (has_permission('config.gestionar') = false).
-- ============================================================


-- ============================================================
-- PLAN DE REVERSIÓN
-- ============================================================
--   BEGIN;
--   DROP POLICY IF EXISTS "organizations_update_config" ON public.organizations;
--   COMMIT;
--
--   Deja organizations exactamente como tras la 020: solo SELECT de la propia
--   org, sin UPDATE desde la app. (Si se hubiera activado el endurecimiento de
--   columna de arriba, revertir también con:
--     GRANT UPDATE ON public.organizations TO authenticated;)
-- ============================================================
