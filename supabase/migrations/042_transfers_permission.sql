-- ============================================================
-- 042 — Permiso traslados.gestionar (mover mercancía entre tiendas)
--
-- Objetivo:
--   Introducir el permiso que gatea el módulo de traslados (migraciones 040 y
--   041). Las 6 RPC de la 041 ya lo exigen con has_permission('traslados.
--   gestionar'); hasta que esta migración corra, el ÚNICO que puede usarlas es
--   el Dueño, porque su comodín '*' hace que has_permission devuelva true para
--   cualquier permiso. Esta migración lo reparte al Administrador.
--
-- Decisión de reparto (por defecto):
--   · Dueño         → SÍ (ya lo cubre el comodín '*'; NO se toca, es inmutable).
--   · Administrador → SÍ (lo agrega esta migración).
--   · Vendedor      → NO. Mover mercancía entre sucursales es una decisión de
--                     dueño/administrador. Si un negocio quiere que su vendedora
--                     del destino pueda confirmar recepciones, se lo concede
--                     desde la UI de roles: para eso existe el RBAC.
--
-- Por qué UN permiso y no dos (despachar / recibir):
--   El volumen es bajo y quien despacha y quien recibe son la misma clase de
--   usuario (el encargado de una sucursal). Dos permisos duplicarían la UI de
--   roles sin comprar nada. Si mañana hace falta partirlo, es aditivo y sin
--   migración de datos.
--
-- Interacción con productos.gestionar (verificado antes de escribir esto):
--   save_transfer_draft exige ADEMÁS productos.gestionar cuando alguna línea
--   lleva create_product o map_product — o sea, cuando el traslado va a crear
--   catálogo en el destino. El rol Administrador YA tiene productos.gestionar
--   en el canónico y en las dos organizaciones de producción, así que nace
--   pudiendo armar cualquier traslado. Un rol personalizado con solo
--   traslados.gestionar podrá mover mercancía entre fichas que ya existen
--   (map_variant) pero no inventar catálogo, que es una restricción útil.
--
-- MULTI-ORG:
--   SIN filtro de organización, molde de la 034. Se identifica al rol SOLO por
--   name = 'Administrador' y se excluye cualquier Dueño ('*'), así cada org con
--   un Administrador estándar lo recibe — incluidas las futuras.
--   (Las migraciones 023/027/029 hardcodearon 'La Bodega del Jeans' y por eso
--   una org nueva nacía sin esos permisos. Ese patrón está PROHIBIDO.)
--
-- Método:
--   permissions || '["traslados.gestionar"]'::jsonb con guards:
--     · NOT permissions ? '*'                    → nunca toca al Dueño (es
--                                                   inmutable por
--                                                   trg_roles_protect_owner; un
--                                                   UPDATE sobre él abortaría).
--     · NOT permissions ? 'traslados.gestionar'  → idempotente en re-runs.
--   Se AÑADE al array existente, NO se re-setea: en producción el Vendedor de
--   La Bodega tiene 8 permisos y no los 6 canónicos (le agregaron historial.ver
--   y reportes.ver desde la UI). Un DO UPDATE al set canónico se los borraría.
--
-- Atomicidad: BEGIN/COMMIT con autoverificación que ABORTA y revierte todo si
--   algún Administrador queda sin el permiso.
--
-- Requiere: 021 (roles + has_permission + inmutabilidad del Dueño), 035
--   (canonical_role_permissions, ya actualizada con este permiso) y 041 (las
--   RPC que lo exigen) aplicadas.
--
-- Cómo aplicar (lab):
--   ./scripts/lab-apply-migration.sh 042_transfers_permission.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. REDEFINIR canonical_role_permissions() — el paso que falta en el
--    procedimiento de CLAUDE.md, y que esta migración descubrió
-- ------------------------------------------------------------
-- Editar el array en el ARCHIVO de la 035 sirve solo para una base NUEVA que lo
-- ejecute de cero. En una base que YA corrió la 035 (prod y el lab), la función
-- quedó creada con el array viejo y el archivo no la toca: verificado en el lab,
-- canonical_role_permissions('Administrador') seguía devolviendo 19 permisos sin
-- traslados.gestionar.
--
-- Eso importa porque seed_org_roles() lee esta función: sin redefinirla, una
-- ORGANIZACIÓN NUEVA nacería con un Administrador SIN el permiso — exactamente el
-- bug que las 023/027/029 causaron con el hardcode de organización y que el
-- proyecto prohibió.
--
-- Por eso el paso 1 del procedimiento son en realidad DOS: editar el archivo de
-- la 035 (para instalaciones nuevas) Y redefinir la función acá (para las que ya
-- existen). La autoverificación del bloque 2 lo comprueba.
--
-- El cuerpo es idéntico al de la 035 ya actualizada: Administrador pasa de 19 a
-- 20 permisos; Dueño y Vendedor no cambian.
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
        "traslados.gestionar",
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
  'Fuente única de verdad de los permisos de los roles base (Dueño/Administrador/Vendedor). Para agregar un permiso: editar el array en la 035 Y redefinir la función en la migración de reconciliación (una base que ya corrió la 035 no se entera del cambio del archivo). Debe coincidir con ALL_PERMISSIONS de permissionsCatalog.ts.';


-- ------------------------------------------------------------
-- 1. Append traslados.gestionar a TODOS los roles 'Administrador'
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = permissions || '["traslados.gestionar"]'::jsonb
 WHERE name = 'Administrador'
   AND NOT permissions ? '*'
   AND NOT permissions ? 'traslados.gestionar';

-- ------------------------------------------------------------
-- 2. Autoverificación (aborta y revierte TODO si algo no quedó bien)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_admin_total     integer;
  v_admin_sin_perm  integer;
  v_admin_sin_prod  integer;
BEGIN
  SELECT count(*) INTO v_admin_total
    FROM public.roles
   WHERE name = 'Administrador' AND NOT permissions ? '*';

  IF v_admin_total = 0 THEN
    RAISE EXCEPTION 'No existe ningún rol ''Administrador'' (¿se aplicaron 021/035? ¿hay organizaciones seedeadas?).';
  END IF;

  SELECT count(*) INTO v_admin_sin_perm
    FROM public.roles
   WHERE name = 'Administrador'
     AND NOT permissions ? '*'
     AND NOT permissions ? 'traslados.gestionar';

  IF v_admin_sin_perm > 0 THEN
    RAISE EXCEPTION '% rol(es) Administrador quedaron SIN traslados.gestionar (el append no cubrió todas las orgs).', v_admin_sin_perm;
  END IF;

  -- El Dueño no debió tocarse.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Dueño' AND permissions ? '*') THEN
    RAISE EXCEPTION 'Algún rol Dueño no quedó con el comodín ''*'' (no debió tocarse).';
  END IF;

  -- Coherencia con el canónico de la 035: el permiso tiene que estar ahí, o el
  -- seed de una org NUEVA nacería sin él y volveríamos al problema de la 027/029.
  IF NOT (canonical_role_permissions('Administrador') ? 'traslados.gestionar') THEN
    RAISE EXCEPTION 'canonical_role_permissions(''Administrador'') NO incluye traslados.gestionar: actualizá la 035 antes de aplicar esta migración.';
  END IF;

  -- Aviso, no error: un Administrador sin productos.gestionar podría armar
  -- traslados solo con map_variant (save_transfer_draft rechaza las líneas que
  -- crean catálogo). Hoy no pasa en ninguna org, pero si alguien personalizó el
  -- rol conviene saberlo.
  SELECT count(*) INTO v_admin_sin_prod
    FROM public.roles
   WHERE name = 'Administrador'
     AND NOT permissions ? '*'
     AND NOT permissions ? 'productos.gestionar';

  IF v_admin_sin_prod > 0 THEN
    RAISE NOTICE 'Aviso: % rol(es) Administrador NO tienen productos.gestionar; solo podrán armar traslados hacia fichas que ya existan en el destino (map_variant).', v_admin_sin_prod;
  END IF;

  IF EXISTS (SELECT 1 FROM public.roles WHERE name = 'Vendedor' AND permissions ? 'traslados.gestionar') THEN
    RAISE NOTICE 'Aviso: algún rol Vendedor ya tiene traslados.gestionar (concedido desde la UI). La migración no lo toca.';
  END IF;

  RAISE NOTICE '042 OK: traslados.gestionar → % rol(es) Administrador (todas las orgs). Vendedor y Dueño intactos.', v_admin_total;
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Reparto por rol y organización:
--      SELECT o.name AS org, r.name AS rol,
--             r.permissions ? 'traslados.gestionar' AS tiene_traslados,
--             r.permissions ? 'productos.gestionar' AS tiene_productos,
--             jsonb_array_length(r.permissions)     AS n
--        FROM public.roles r
--        JOIN public.organizations o ON o.id = r.organization_id
--       ORDER BY o.name, r.name;
--      -- Administrador (cada org): true/true, n = 20
--      -- Vendedor: false · Dueño: false (lo cubre '*', n = 1)
--
-- 2. Ningún Administrador estándar quedó sin el permiso (debe dar 0):
--      SELECT count(*) FROM public.roles
--       WHERE name = 'Administrador' AND NOT permissions ? '*'
--         AND NOT permissions ? 'traslados.gestionar';
--
-- 3. Los permisos preexistentes se preservaron (el Vendedor de La Bodega tenía
--    8, no los 6 canónicos — el append NO debe haberlo tocado):
--      SELECT o.name, r.name, jsonb_array_length(r.permissions)
--        FROM public.roles r JOIN public.organizations o ON o.id = r.organization_id
--       WHERE r.name = 'Vendedor';
--
-- 4. has_permission() por rol (autenticado como cada uno):
--      SELECT has_permission('traslados.gestionar');
--      -- Administrador → true · Vendedor → false · Dueño → true (comodín)
--
-- 5. De punta a punta: un Administrador puede armar un traslado y un Vendedor no
--    (las RPC de la 041 ya exigen el permiso).


-- ============================================================
-- REVERSIÓN
-- ============================================================
-- BEGIN;
--   UPDATE public.roles
--      SET permissions = permissions - 'traslados.gestionar'
--    WHERE name = 'Administrador' AND NOT permissions ? '*';
--   -- Si algún negocio se lo concedió a su Vendedor y también querés revertirlo:
--   -- UPDATE public.roles
--   --    SET permissions = permissions - 'traslados.gestionar'
--   --  WHERE name = 'Vendedor';
-- COMMIT;
--
-- Revertir el permiso deja el módulo accesible SOLO para el Dueño (comodín).
-- No rompe nada: las tablas y las RPC siguen ahí, simplemente nadie más las
-- puede llamar. Acordate de revertir también el array de la 035 si la reversión
-- pretende ser definitiva, o una org nueva volvería a nacer con el permiso.
-- ============================================================
