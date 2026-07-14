-- ============================================================
-- 035 — Fuente única de verdad para los roles/permisos por organización
--
-- PROBLEMA QUE RESUELVE (auditoría de hardcodes):
--   Las migraciones 023/027/029 asignaron permisos filtrando por
--   `name = 'La Bodega del Jeans'`. Cuando eran la única org daba igual, pero
--   hoy prod tiene 2 orgs (La Bodega + Laboratorio) y a futuro más. Una org
--   creada SOLO con migraciones nacería SIN esos permisos, y varios de ellos
--   (gastos.gestionar, ventas.anular, inventario.gestionar, clientes.eliminar,
--   separados.eliminar, ventas.fiar) alimentan el RLS de datos (024/030) → su
--   Administrador no podría ni anular ventas ni ajustar stock ni fiar.
--   Además, scripts/create-lab-org.sql tenía los arrays inline y ya había
--   drifteado (le faltaba historial.ver, agregado por la 034).
--
-- SOLUCIÓN — una sola definición canónica de permisos por rol, y dos usos:
--   1. canonical_role_permissions(name) → la ÚNICA fuente de verdad de qué
--      permisos lleva cada rol base (Dueño / Administrador / Vendedor).
--   2. seed_org_roles(org_id) → crea los 3 roles base de una org NUEVA a partir
--      de esa fuente. La llama create-lab-org.sql y la llamará el futuro flujo
--      de "crear org desde la app" (hueco 6B). Sin arrays inline nunca más.
--   3. Reconciliación defensiva (este archivo, más abajo): garantiza que TODO
--      Administrador/Vendedor estándar YA EXISTENTE (todas las orgs, SIN filtro
--      de org — patrón correcto de la 034) tenga AL MENOS el set canónico.
--      Solo AGREGA lo que falte; nunca quita. Blinda La Bodega + Laboratorio.
--
-- ─────────────────────────────────────────────────────────────
-- PATRÓN CORRECTO PARA AGREGAR UN PERMISO NUEVO EN EL FUTURO
--   (leer antes de copiar 023/027/029 — esas están hardcodeadas a una org):
--     a) Agregá el permiso al array del rol en canonical_role_permissions()
--        (acá abajo). Esa es la fuente de verdad.
--     b) Escribí una migración que corra la MISMA reconciliación aditiva de
--        este archivo, SIN filtro de organización (patrón 034):
--          WHERE name IN ('Administrador','Vendedor')
--            AND NOT permissions ? '*'
--            AND NOT (permissions @> canonical_role_permissions(name))
--     c) Actualizá también permissionsCatalog.ts (catálogo de la UI) si el
--        permiso es nuevo en el sistema.
--   NUNCA filtres por `organizations.name = '...'`. Eso deja fuera a las demás.
-- ─────────────────────────────────────────────────────────────
--
-- Atomicidad: todo en una transacción (BEGIN/COMMIT). Idempotente: reaplicar
--   deja el mismo estado (funciones CREATE OR REPLACE; reconciliación con guard
--   de contención; verificación final).
--
-- NO toca: RLS de ninguna tabla, el rol Dueño (inmutable por
--   trg_roles_protect_owner), ni ningún dato de negocio. Solo permisos de roles.
--
-- Requiere: 021 (tabla roles, has_permission, trigger de inmutabilidad del
--   Dueño) y 023 (arrays base) aplicadas.
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 035_org_role_seeding.sql
--   (o psql -v ON_ERROR_STOP=1 -f supabase/migrations/035_org_role_seeding.sql)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. canonical_role_permissions(name) — FUENTE ÚNICA DE VERDAD
--    Devuelve el array jsonb de permisos canónicos de un rol base. Cualquier
--    cambio de permisos de rol se hace ACÁ y en ningún otro lado.
--
--    · Dueño         → ["*"] (comodín: todos los permisos).
--    · Administrador → todos los permisos del catálogo MENOS roles.gestionar
--      (gestionar roles es atribución exclusiva del Dueño; ver 021). Son 19,
--      en el mismo orden que ALL_PERMISSIONS de src/lib/permissionsCatalog.ts.
--    · Vendedor      → solo operación de tienda (6).
--    · Otro nombre   → NULL (no es un rol base; seed/reconciliación no lo usan).
--
--    IMMUTABLE: devuelve constantes; el planner puede cachearla.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_role_permissions(p_role_name text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role_name
    WHEN 'Dueño' THEN
      '["*"]'::jsonb
    WHEN 'Administrador' THEN
      '[
        "pos.usar",
        "ventas.anular",
        "ventas.regalo",
        "ventas.fiar",
        "historial.ver",
        "separados.gestionar",
        "separados.eliminar",
        "devoluciones.gestionar",
        "clientes.gestionar",
        "clientes.eliminar",
        "inventario.ver",
        "inventario.gestionar",
        "productos.gestionar",
        "compras.gestionar",
        "reportes.ver",
        "gastos.ver",
        "gastos.gestionar",
        "config.gestionar",
        "usuarios.gestionar"
      ]'::jsonb
    WHEN 'Vendedor' THEN
      '[
        "pos.usar",
        "separados.gestionar",
        "devoluciones.gestionar",
        "clientes.gestionar",
        "inventario.ver",
        "gastos.gestionar"
      ]'::jsonb
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.canonical_role_permissions(text) IS
  'Fuente única de verdad de los permisos de los roles base (Dueño/Administrador/Vendedor). Para agregar un permiso: editar acá + migración de reconciliación aditiva SIN filtro de org (patrón 034). Debe coincidir con ALL_PERMISSIONS de permissionsCatalog.ts.';


-- ------------------------------------------------------------
-- 2. seed_org_roles(org_id) — crear los 3 roles base de una org NUEVA
--    La usan create-lab-org.sql y el futuro flujo de crear org desde la app.
--    · Dueño: ON CONFLICT DO NOTHING (es inmutable por trg_roles_protect_owner;
--      un DO UPDATE sobre '*' abortaría). Igual criterio que la 021.
--    · Administrador/Vendedor: ON CONFLICT DO UPDATE al set canónico
--      (determinista y auto-reparador para una org recién creada). NOTA: es una
--      primitiva de CREACIÓN, no de reconciliación — un DO UPDATE reemplaza el
--      array completo. Para orgs YA existentes que pudieron personalizar sus
--      roles, usar la reconciliación ADITIVA (bloque 3), que preserva extras.
--
--    SECURITY DEFINER: para que el futuro flujo de "crear org" pueda insertar
--    roles sin depender del RLS de la tabla roles. EXECUTE restringido: hoy solo
--    la puede llamar el owner de la función (postgres/service_role vía el script
--    o una Edge Function con service_role). NO se concede a authenticated: si
--    se expusiera por RPC a usuarios, habría que añadir un chequeo de que el
--    caller es dueño de esa org (evitar sembrar roles en org ajena).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_org_roles(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_roles: p_organization_id no puede ser NULL.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'seed_org_roles: no existe la organización % (¿se creó primero?).', p_organization_id;
  END IF;

  -- Dueño: comodín, inmutable → DO NOTHING (nunca DO UPDATE sobre un rol '*').
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Dueño', canonical_role_permissions('Dueño'))
  ON CONFLICT (organization_id, name) DO NOTHING;

  -- Administrador: set canónico completo (self-healing en un re-run).
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Administrador', canonical_role_permissions('Administrador'))
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- Vendedor: set canónico completo.
  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Vendedor', canonical_role_permissions('Vendedor'))
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions;
END;
$$;

COMMENT ON FUNCTION public.seed_org_roles(uuid) IS
  'Crea los 3 roles base (Dueño/Administrador/Vendedor) de una organización a partir de canonical_role_permissions(). Primitiva de CREACIÓN de org (create-lab-org.sql / futuro hueco 6B). Para orgs existentes usar la reconciliación aditiva de la migración 035.';

-- EXECUTE: bloqueado para anon/authenticated; permitido para service_role (el
-- futuro flujo de crear org desde la app corre con service_role vía Edge
-- Function) y el owner postgres (el script create-lab-org.sql por conexión
-- directa). Si algún día se expone a authenticated por RPC, añadir antes un
-- chequeo de que el caller es dueño de esa org.
REVOKE EXECUTE ON FUNCTION public.seed_org_roles(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_roles(uuid) TO service_role;


-- ------------------------------------------------------------
-- 3. Reconciliación ADITIVA de las orgs YA EXISTENTES (patrón 034)
--    Garantiza que todo Administrador/Vendedor ESTÁNDAR (name coincide y NO es
--    Dueño) de CUALQUIER org tenga AL MENOS el set canónico.
--    · SIN filtro de organización → cubre La Bodega, el Laboratorio y cualquier
--      org futura ya sembrada.
--    · ADITIVA: parte de las permissions actuales y les hace la UNIÓN con las
--      canónicas (DISTINCT). PRESERVA cualquier permiso extra que un negocio
--      haya agregado por la UI de roles. NUNCA quita nada.
--    · Guard de contención `NOT (permissions @> canonical...)`: solo actualiza
--      las filas a las que les FALTA algún permiso canónico → idempotente y
--      no dispara updated_at si ya están completas.
--    · Dueño excluido por `NOT permissions ? '*'` (además es inmutable).
-- ------------------------------------------------------------
UPDATE public.roles r
   SET permissions = (
     SELECT jsonb_agg(perm ORDER BY perm)
       FROM (
         SELECT DISTINCT jsonb_array_elements_text(
                  r.permissions || canonical_role_permissions(r.name)
                ) AS perm
       ) u
   )
 WHERE r.name IN ('Administrador', 'Vendedor')
   AND NOT r.permissions ? '*'
   AND canonical_role_permissions(r.name) IS NOT NULL
   AND NOT (r.permissions @> canonical_role_permissions(r.name));


-- ------------------------------------------------------------
-- 4. Autoverificación (aborta y revierte TODO si algo quedó mal)
--    Tras la reconciliación, NINGÚN Administrador/Vendedor estándar puede
--    quedar sin el set canónico completo.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_admin_total integer;
  v_incompletos integer;
BEGIN
  -- Debe existir al menos un Administrador estándar (sanity de que hay orgs).
  SELECT count(*) INTO v_admin_total
    FROM public.roles
   WHERE name = 'Administrador' AND NOT permissions ? '*';

  IF v_admin_total = 0 THEN
    RAISE EXCEPTION 'No existe ningún rol ''Administrador'' estándar (¿se aplicaron 020/021/023? ¿hay orgs sembradas?).';
  END IF;

  -- Ningún Administrador/Vendedor estándar puede quedar sin su set canónico.
  SELECT count(*) INTO v_incompletos
    FROM public.roles
   WHERE name IN ('Administrador', 'Vendedor')
     AND NOT permissions ? '*'
     AND NOT (permissions @> canonical_role_permissions(name));

  IF v_incompletos > 0 THEN
    RAISE EXCEPTION 'Reconciliación incompleta: % rol(es) estándar quedaron sin el set canónico.', v_incompletos;
  END IF;

  -- El/los Dueño(s) siguen intactos con el comodín.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Dueño' AND permissions ? '*') THEN
    RAISE EXCEPTION 'Algún rol Dueño no quedó con el comodín ''*'' (no debió tocarse).';
  END IF;

  RAISE NOTICE '035 OK: canonical_role_permissions + seed_org_roles creadas; % Administrador estándar reconciliado(s). Vendedor y Dueño intactos.', v_admin_total;
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. La fuente de verdad devuelve lo esperado:
--      SELECT jsonb_array_length(canonical_role_permissions('Administrador'));  -- 19
--      SELECT jsonb_array_length(canonical_role_permissions('Vendedor'));       -- 6
--      SELECT canonical_role_permissions('Dueño');                              -- ["*"]
--
-- 2. Cada org tiene su Administrador con el set canónico completo:
--      SELECT o.name AS org, r.name AS rol,
--             r.permissions @> canonical_role_permissions(r.name) AS completo
--        FROM public.roles r
--        JOIN public.organizations o ON o.id = r.organization_id
--       WHERE r.name IN ('Administrador','Vendedor')
--       ORDER BY o.name, r.name;   -- completo = true en todas
--
-- 3. La reconciliación NO quitó nada (los permisos previos siguen presentes):
--      -- (comparar contra un dump previo si se guardó; por diseño es unión).
--
-- 4. seed_org_roles crea una org nueva completa (prueba en TRANSACCIÓN + ROLLBACK):
--      BEGIN;
--        INSERT INTO public.organizations (name) VALUES ('Prueba 035') RETURNING id \gset
--        SELECT public.seed_org_roles(:'id');
--        SELECT name, permissions @> canonical_role_permissions(name) AS completo
--          FROM public.roles WHERE organization_id = :'id' ORDER BY name;
--        -- Dueño ["*"], Administrador completo=true, Vendedor completo=true
--      ROLLBACK;   -- no deja nada
--
-- 5. Idempotencia: reaplicar 035 no cambia filas (0 updates en la reconciliación).


-- ============================================================
-- REVERSIÓN (si hiciera falta deshacer)
-- ============================================================
-- La reconciliación (bloque 3) es ADITIVA e idempotente: no hay "permisos
-- previos" que restaurar de forma segura (no se sabe cuáles eran extras). Si se
-- necesita revertir, lo correcto es re-sembrar al canónico o restaurar de backup.
-- Las funciones sí se pueden eliminar:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.seed_org_roles(uuid);
--     DROP FUNCTION IF EXISTS public.canonical_role_permissions(text);
--   COMMIT;
-- (No dropear si create-lab-org.sql u otro flujo ya dependen de seed_org_roles.)
-- ============================================================
