-- ============================================================
-- 023 — Multi-tenancy FASE 4 (paso 1 de 2): permisos nuevos en el seed de roles
--
-- Objetivo:
--   Añadir los permisos que faltaban para el barrido del RLS de las tablas de
--   datos (paso 2, migración 024). NO recrea la 021 (ya commiteada): solo
--   ACTUALIZA los arrays permissions de los roles ya existentes de La Bodega.
--
-- Permisos nuevos introducidos:
--   - ventas.anular        → anular/cancelar ventas (orders UPDATE)
--   - gastos.gestionar     → registrar/eliminar gastos de caja (cash_expenses)
--   - inventario.gestionar → ajustes manuales de stock (stock_movements)
--   - clientes.eliminar    → borrar clientes (customers DELETE)
--   - separados.eliminar   → borrar separados (layaways DELETE)
--
-- Reparto:
--   - Vendedor      += gastos.gestionar
--   - Administrador += gastos.gestionar, ventas.anular, inventario.gestionar,
--                      clientes.eliminar, separados.eliminar
--   - Dueño         → ["*"] SIN TOCAR (el comodín ya cubre todo; además es
--                      INMUTABLE por trg_roles_protect_owner: cualquier UPDATE
--                      sobre él abortaría). Se excluye explícitamente.
--
-- Método: se SETEA el array final completo de cada rol (idempotente por
--   naturaleza: reaplicar deja exactamente el mismo array, sin duplicar).
--
-- Atómica (BEGIN/COMMIT) y autoverificada (un assert al final revierte todo si
--   el resultado no quedó como se espera, incl. el caso "falta la org/rol").
--   NO toca RLS de ninguna tabla (eso es la 024).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Vendedor — array final (operación + gastos de su turno)
--    Excluido el Dueño por name y por NOT permissions ? '*' (doble seguro).
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = '[
         "pos.usar",
         "separados.gestionar",
         "devoluciones.gestionar",
         "clientes.gestionar",
         "inventario.ver",
         "gastos.gestionar"
       ]'::jsonb
 WHERE organization_id = (SELECT id FROM public.organizations WHERE name = 'La Bodega del Jeans')
   AND name = 'Vendedor'
   AND NOT permissions ? '*';

-- ------------------------------------------------------------
-- 2. Administrador — array final (Vendedor + gestión + nuevos de admin)
--    gastos.gestionar también lo lleva (ya está en Vendedor); gastos.ver es
--    lectura de reportes (UI). Excluido el Dueño igual que arriba.
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = '[
         "pos.usar",
         "separados.gestionar",
         "devoluciones.gestionar",
         "clientes.gestionar",
         "inventario.ver",
         "gastos.gestionar",
         "productos.gestionar",
         "compras.gestionar",
         "reportes.ver",
         "gastos.ver",
         "config.gestionar",
         "usuarios.gestionar",
         "ventas.anular",
         "inventario.gestionar",
         "clientes.eliminar",
         "separados.eliminar"
       ]'::jsonb
 WHERE organization_id = (SELECT id FROM public.organizations WHERE name = 'La Bodega del Jeans')
   AND name = 'Administrador'
   AND NOT permissions ? '*';

-- ------------------------------------------------------------
-- 3. Autoverificación: si algo no quedó como se espera (incl. org/rol
--    inexistente → 0 filas actualizadas), abortar y revertir TODO.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name = 'La Bodega del Jeans';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No existe la organización ''La Bodega del Jeans'' (¿se aplicó la 020?).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Vendedor'
       AND permissions ? 'gastos.gestionar'
  ) THEN
    RAISE EXCEPTION 'Vendedor no quedó con gastos.gestionar (¿existe el rol? ¿se aplicó la 021?).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Administrador'
       AND permissions ? 'ventas.anular'
       AND permissions ? 'inventario.gestionar'
       AND permissions ? 'clientes.eliminar'
       AND permissions ? 'separados.eliminar'
       AND permissions ? 'gastos.gestionar'
  ) THEN
    RAISE EXCEPTION 'Administrador no quedó con los permisos nuevos esperados.';
  END IF;

  RAISE NOTICE '023 OK: permisos extra aplicados a Vendedor y Administrador. Dueño intacto.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Arrays finales por rol:
--      SELECT name, permissions FROM public.roles ORDER BY name;
--
-- 2. Vendedor: gastos.gestionar=true; el resto de los nuevos = false:
--      (como Vendedor autenticado)
--      SELECT has_permission('gastos.gestionar')   AS debe_true,
--             has_permission('ventas.anular')       AS debe_false,
--             has_permission('inventario.gestionar')AS debe_false,
--             has_permission('clientes.eliminar')   AS debe_false,
--             has_permission('separados.eliminar')  AS debe_false;
--
-- 3. Administrador: los nuevos de admin = true:
--      (como Administrador autenticado)
--      SELECT has_permission('ventas.anular')        AS debe_true,
--             has_permission('inventario.gestionar') AS debe_true,
--             has_permission('clientes.eliminar')    AS debe_true,
--             has_permission('separados.eliminar')   AS debe_true,
--             has_permission('gastos.gestionar')     AS debe_true;
--
-- 4. Dueño intacto (comodín cubre cualquier permiso):
--      SELECT permissions FROM public.roles WHERE name = 'Dueño';  -- ["*"]
--      (como Dueño autenticado) SELECT has_permission('lo.que.sea'); -- true
-- ============================================================
