-- ============================================================
-- 034 — Permiso historial.ver (ver el historial de ventas)
--
-- Objetivo:
--   Introducir un permiso NUEVO y dedicado, historial.ver, que gatea el acceso
--   a la pantalla "Historial de ventas" (/ventas/historial). Hasta ahora esa
--   pantalla la veía cualquier usuario autenticado (la ruta no exigía permiso y
--   el ítem del menú usaba pos.usar). Con este permiso, el historial deja de ser
--   visible por defecto para el Vendedor; cada negocio puede dárselo desde la UI
--   de roles si lo desea.
--
-- Decisión de reparto (por defecto):
--   · Dueño         → SÍ (ya lo cubre el comodín '*'; NO se toca, es inmutable).
--   · Administrador → SÍ (lo agrega esta migración).
--   · Vendedor      → NO (queda sin el permiso por defecto).
--
-- Por qué es un permiso propio y no reutiliza reportes.ver:
--   El historial de ventas es OPERATIVO (buscar una venta pasada, reimprimir un
--   ticket) y algunos negocios querrán dárselo al Vendedor sin abrirle todos los
--   reportes/analítica (reportes.ver). Un permiso separado permite ese matiz.
--
-- MULTI-ORG (importante — difiere de 027/029):
--   Las migraciones 027 y 029 hardcodean la organización 'La Bodega del Jeans'
--   porque en su momento era la única. Hoy prod tiene DOS organizaciones (La
--   Bodega + el Laboratorio) y a futuro puede tener más. Esta migración NO
--   scopea por organización: aplica el permiso al rol 'Administrador' de TODAS
--   las organizaciones, identificándolo SOLO por name = 'Administrador' y
--   excluyendo cualquier rol Dueño ('*'). Así, cada org con un rol Administrador
--   estándar lo recibe sin tener que enumerar organizaciones.
--
-- Método (calco del append idempotente de 027/029):
--   permissions || '["historial.ver"]'::jsonb con guards:
--     · NOT permissions ? '*'            → nunca toca al Dueño (inmutable por
--                                           trg_roles_protect_owner; un UPDATE
--                                           sobre él abortaría la migración).
--     · NOT permissions ? 'historial.ver' → idempotente (no duplica en re-runs).
--   Se AÑADE al array existente (no re-setea), para no pisar otros permisos.
--
-- Atomicidad: todo en una transacción (BEGIN/COMMIT). Idempotente: reaplicar
--   deja el mismo estado. NO toca RLS de ninguna tabla (ver análisis al pie:
--   el gating es de UI; el Vendedor SIGUE leyendo orders para operar el POS y
--   las devoluciones, así que restringir el SELECT de orders rompería su
--   operación — este permiso NO va al RLS de orders).
--
-- Requiere: 021 (tabla roles + has_permission + trigger de inmutabilidad del
--   Dueño) y 023 (arrays de permisos base) aplicadas.
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 034_historial_permission.sql
--   (o psql -v ON_ERROR_STOP=1 -f supabase/migrations/034_historial_permission.sql)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Append historial.ver a TODOS los roles 'Administrador' (todas las orgs)
--    · Dueño excluido por NOT permissions ? '*'.
--    · Vendedor NO se toca (no se actualiza su fila).
--    · Idempotente por NOT permissions ? 'historial.ver'.
--    · SIN filtro de organización → cubre La Bodega, el Laboratorio y cualquier
--      org futura con un rol Administrador estándar.
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = permissions || '["historial.ver"]'::jsonb
 WHERE name = 'Administrador'
   AND NOT permissions ? '*'
   AND NOT permissions ? 'historial.ver';

-- ------------------------------------------------------------
-- 2. Autoverificación (aborta y revierte TODO si algo no quedó bien)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_admin_total    integer;
  v_admin_sin_perm integer;
BEGIN
  -- Roles Administrador estándar (no Dueño) que existen.
  SELECT count(*) INTO v_admin_total
    FROM public.roles
   WHERE name = 'Administrador' AND NOT permissions ? '*';

  IF v_admin_total = 0 THEN
    RAISE EXCEPTION 'No existe ningún rol ''Administrador'' (¿se aplicaron 021/023? ¿hay organizaciones seedeadas?).';
  END IF;

  -- Todos los Administrador estándar DEBEN tener historial.ver tras el append.
  SELECT count(*) INTO v_admin_sin_perm
    FROM public.roles
   WHERE name = 'Administrador'
     AND NOT permissions ? '*'
     AND NOT permissions ? 'historial.ver';

  IF v_admin_sin_perm > 0 THEN
    RAISE EXCEPTION '% rol(es) Administrador quedaron SIN historial.ver (el append no cubrió todas las orgs).', v_admin_sin_perm;
  END IF;

  -- El/los Dueño(s) deben seguir con el comodín intacto (no debieron tocarse).
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Dueño' AND permissions ? '*') THEN
    RAISE EXCEPTION 'Algún rol Dueño no quedó con el comodín ''*'' (no debió tocarse).';
  END IF;

  -- Nota informativa sobre el Vendedor: por defecto NO lleva historial.ver, pero
  -- un negocio PUEDE habilitárselo desde la UI de roles. Por eso esto es un
  -- NOTICE (no una excepción): así la migración sigue siendo idempotente aunque
  -- alguien ya se lo haya concedido manualmente a un Vendedor.
  IF EXISTS (SELECT 1 FROM public.roles WHERE name = 'Vendedor' AND permissions ? 'historial.ver') THEN
    RAISE NOTICE 'Aviso: algún rol Vendedor ya tiene historial.ver (concedido desde la UI). La migración no lo toca.';
  END IF;

  RAISE NOTICE '034 OK: historial.ver → % rol(es) Administrador (todas las orgs). Vendedor y Dueño intactos.', v_admin_total;
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Reparto por rol y organización (Administrador de CADA org debe tener true):
--      SELECT o.name AS org, r.name AS rol,
--             r.permissions ? 'historial.ver' AS tiene_historial
--        FROM public.roles r
--        JOIN public.organizations o ON o.id = r.organization_id
--       ORDER BY o.name, r.name;
--      -- Administrador (cada org): true · Vendedor: false · Dueño: false (lo cubre '*')
--
-- 2. Ningún Administrador estándar quedó sin el permiso (debe dar 0):
--      SELECT count(*) FROM public.roles
--       WHERE name = 'Administrador' AND NOT permissions ? '*'
--         AND NOT permissions ? 'historial.ver';
--
-- 3. has_permission() por rol (autenticado como cada uno):
--      SELECT has_permission('historial.ver');
--      -- Administrador → true · Vendedor → false · Dueño → true (comodín)
--
-- 4. El Dueño sigue intacto:
--      SELECT permissions FROM public.roles WHERE name = 'Dueño';  -- ["*"]


-- ============================================================
-- REVERSIÓN (quita el permiso de los Administrador, deja al Dueño intacto)
-- ============================================================
-- BEGIN;
--   UPDATE public.roles
--      SET permissions = permissions - 'historial.ver'
--    WHERE name = 'Administrador' AND NOT permissions ? '*';
--   -- Si algún negocio se lo concedió a su Vendedor y también querés revertirlo:
--   -- UPDATE public.roles
--   --    SET permissions = permissions - 'historial.ver'
--   --  WHERE name = 'Vendedor';
-- COMMIT;
-- ============================================================
