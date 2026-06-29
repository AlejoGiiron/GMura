-- ============================================================
-- 020 — Multi-tenancy FASE 1 de 6: esquema base (organizations + backfill)
--
-- Objetivo:
--   Añadir una capa "organización" POR ENCIMA de las tiendas, copiando el
--   patrón ya probado en G-vento. El aislamiento de DATOS sigue siendo por
--   tienda (store_id = get_my_store_id() en todo el RLS, intacto). La
--   organización es solo la capa de agrupación de tiendas.
--
-- Contexto de producción:
--   - La Bodega del Jeans está EN PRODUCCIÓN con 2 sedes (stores).
--   - Esta migración hace BACKFILL de sus datos hacia UNA sola organización.
--   - NO se crea ninguna org de prueba ni "El Lab" (eso es una fase posterior).
--
-- Atomicidad:
--   Todo el archivo va envuelto en una única transacción (BEGIN/COMMIT). Si
--   CUALQUIER paso falla —incluido el SET NOT NULL final o la verificación
--   del backfill— se revierte TODO y la BD queda exactamente como estaba.
--
-- Cómo aplicar (manual, recomendado):
--   psql "$GMURA_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/020_organizations.sql
--   (ON_ERROR_STOP asegura que un error aborte de inmediato.)
--   Si lo corres en el SQL Editor de Supabase, ejecútalo como un solo script.
--
-- Esta migración NO toca:
--   - El RLS de las tablas de datos (sigue 100% por store_id).
--   - Ningún código TypeScript de la app (eso es la Fase 5).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Tabla organizations
--    Mínima: solo identidad + config libre. Sin capa comercial todavía.
--    PK con gen_random_uuid() (nativo en PG13+; Supabase corre PG17).
--    Reutiliza set_updated_at() (definida en 001_initial_schema.sql).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  config      jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.organizations        IS 'Capa de agrupación por encima de las tiendas. Una org agrupa varias stores. El aislamiento de datos sigue siendo por store_id.';
COMMENT ON COLUMN public.organizations.config IS 'Configuración libre a nivel de organización (jsonb).';

-- Trigger updated_at (mismo patrón que el resto de tablas mutables).
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------
-- 2. Columna organization_id en stores y profiles (PRIMERO nullable)
--    Se agrega nullable para poder hacer el backfill sin violar NOT NULL.
--    ON DELETE CASCADE: borrar una org arrastra sus stores y profiles.
-- ------------------------------------------------------------
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES public.organizations(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.stores.organization_id   IS 'Organización a la que pertenece la tienda. NOT NULL tras el backfill de la Fase 1.';
COMMENT ON COLUMN public.profiles.organization_id IS 'Organización del usuario. NOT NULL tras el backfill de la Fase 1.';

-- Índices para los lookups por organización.
CREATE INDEX IF NOT EXISTS idx_stores_organization_id   ON public.stores(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON public.profiles(organization_id);


-- ------------------------------------------------------------
-- 3. Backfill atómico
--    - Crea la organización 'La Bodega del Jeans' (idempotente: si ya
--      existe por un re-run, reutiliza su id en vez de duplicarla).
--    - Asigna esa org a TODAS las stores y profiles que aún no tengan una.
--    - Verifica que no quede ningún NULL; si queda, RAISE EXCEPTION aborta
--      y revierte toda la transacción.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_org_id        uuid;
  v_null_stores   integer;
  v_null_profiles integer;
BEGIN
  -- Reutiliza la org si ya existe (idempotencia ante un segundo run);
  -- de lo contrario la crea. NO se crea ninguna otra organización.
  SELECT id INTO v_org_id
    FROM public.organizations
   WHERE name = 'La Bodega del Jeans'
   LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name)
    VALUES ('La Bodega del Jeans')
    RETURNING id INTO v_org_id;
    RAISE NOTICE 'Organización creada: La Bodega del Jeans (%)', v_org_id;
  ELSE
    RAISE NOTICE 'Organización ya existía, reutilizando: %', v_org_id;
  END IF;

  -- Asignar la org a las tiendas y usuarios sin organización.
  UPDATE public.stores
     SET organization_id = v_org_id
   WHERE organization_id IS NULL;

  UPDATE public.profiles
     SET organization_id = v_org_id
   WHERE organization_id IS NULL;

  -- Verificación: NO debe quedar ningún NULL. Si queda alguno, abortar todo.
  SELECT count(*) INTO v_null_stores   FROM public.stores   WHERE organization_id IS NULL;
  SELECT count(*) INTO v_null_profiles FROM public.profiles WHERE organization_id IS NULL;

  IF v_null_stores > 0 OR v_null_profiles > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: % stores y % profiles quedaron sin organization_id. Abortando (rollback total).',
      v_null_stores, v_null_profiles;
  END IF;

  RAISE NOTICE 'Backfill OK: todas las stores y profiles asignadas a la organización %', v_org_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. Volver NOT NULL (después del backfill)
--    Red de seguridad: si por cualquier razón quedara un NULL, este
--    SET NOT NULL falla y revierte toda la transacción.
-- ------------------------------------------------------------
ALTER TABLE public.stores   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN organization_id SET NOT NULL;


-- ------------------------------------------------------------
-- 5. Función get_my_organization_id()
--    Gemela de get_my_store_id(): devuelve la organización del usuario
--    autenticado. SECURITY DEFINER para leer profiles sin disparar su RLS
--    (sin recursión). Permisos restringidos a 'authenticated'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_organization_id() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_organization_id() TO authenticated;


-- ------------------------------------------------------------
-- 6. RLS de organizations (org-wide)
--    SELECT: el usuario solo ve SU organización.
--    Sin INSERT/UPDATE/DELETE: las orgs se crean por seed SQL, no por la app.
-- ------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_select_own" ON public.organizations;
CREATE POLICY "organizations_select_own"
  ON public.organizations FOR SELECT
  USING (id = get_my_organization_id());


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Existe exactamente UNA organización (La Bodega del Jeans):
--      SELECT id, name FROM public.organizations;
--
-- 2. NINGUNA store ni profile quedó sin organización (deben dar 0):
--      SELECT count(*) FROM public.stores   WHERE organization_id IS NULL;
--      SELECT count(*) FROM public.profiles WHERE organization_id IS NULL;
--
-- 3. Las 2 sedes apuntan a la misma org:
--      SELECT organization_id, count(*) FROM public.stores GROUP BY 1;
--
-- 4. Como un usuario autenticado, su org resuelve (no NULL) y ve solo la suya:
--      SELECT get_my_organization_id();
--      SELECT * FROM public.organizations;   -- debe devolver solo SU org
--
-- 5. El RLS de datos sigue intacto (sin cambios): get_my_store_id() sin tocar.
-- ============================================================
