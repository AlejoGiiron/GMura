-- ============================================================
-- 045 — El stock solo cambia con registro
--
-- Rama fix/stock-edit-movement. Requiere la 041 (generate_free_barcode y el
-- molde de RPC) aplicada.
--
-- ------------------------------------------------------------
-- EL PROBLEMA (diagnóstico 2026-10-05)
-- ------------------------------------------------------------
-- Cuatro caminos del cliente escribían variants.stock_qty sin dejar
-- stock_movement:
--   1. VariantsPanel, editar: mandaba stock_qty en TODA edición, aunque solo
--      cambiara el precio. Si alguien vendía con el formulario abierto, al
--      guardar volvía el stock viejo: la prenda quedaba "des-vendida".
--   2. ProductsPage, matriz de stock: clic en la celda + clic afuera (o Esc)
--      reescribía el stock con el valor que tenía al abrir, se tocara o no.
--   3. InventoryPage, ajuste: leer → escribir → registrar, en 3 llamadas sueltas.
--      Se pisaba con ventas simultáneas, y con permisos desalineados (el UPDATE
--      pide productos.gestionar, el movimiento inventario.gestionar) podía
--      quedar un movimiento sin que el stock cambiara, o al revés.
--   4. El stock inicial de una variante nueva no dejaba movimiento.
-- Y por la API REST cualquiera con productos.gestionar podía escribir stock_qty.
--
-- ------------------------------------------------------------
-- LA SOLUCIÓN, EN TRES PIEZAS
-- ------------------------------------------------------------
-- A. guard_variant_stock (BEFORE INSERT OR UPDATE ON variants): un cliente no
--    puede cambiar stock_qty ni reserved_qty. Solo pueden los caminos
--    autorizados, que son TODOS funciones SECURITY DEFINER del dueño de la
--    tabla: los triggers de venta, devolución, compra y separados, las RPC de
--    traslados y adjust_variant_stock (abajo).
-- B. adjust_variant_stock (RPC): la ÚNICA forma de ajustar stock a mano.
--    Atómica: lockea la variante, cambia el stock y registra el movimiento
--    'adjustment' con quién y por qué, en la misma transacción.
-- C. log_initial_stock (AFTER INSERT ON variants): el stock con el que nace
--    una variante queda como movimiento 'adjustment' con nota "Stock inicial".
--
-- ------------------------------------------------------------
-- POR QUÉ UN TRIGGER (opción b) Y NO PRIVILEGIOS POR COLUMNA (opción a)
-- ------------------------------------------------------------
-- (a) sería REVOKE UPDATE ON variants + GRANT UPDATE (lista de columnas). Se
-- descartó por tres razones:
--   · Falla ABIERTO ante un re-GRANT. lab-restore.sh re-otorga los GRANT
--     estándar de Supabase sobre todo public (ver CLAUDE.md), y cualquier
--     migración futura con un "GRANT ... ON ALL TABLES" haría lo mismo en
--     prod: la protección desaparecería sin que nada avise. El trigger no
--     depende de los GRANT.
--   · Cada columna nueva de variants habría que acordarse de agregarla a la
--     lista, o su edición fallaría con un "permission denied" en inglés.
--   · Con privilegios de columna, una pestaña vieja (antes de recargar tras el
--     deploy) que manda stock_qty SIN cambiar el valor fallaría en cualquier
--     edición. El trigger compara valores: solo rechaza si el stock CAMBIA, con
--     un mensaje en español que dice qué hacer.
--
-- Cómo distingue el trigger un camino autorizado: guard_variant_stock es
-- SECURITY INVOKER a propósito, así que current_user es el rol del que hizo el
-- UPDATE. Desde el cliente (PostgREST) es authenticated/anon/service_role.
-- Dentro de una función SECURITY DEFINER es el dueño de esa función. Se
-- permite el cambio solo si current_user es el DUEÑO DE LA TABLA (o
-- supabase_admin): exactamente los caminos autorizados, y además las
-- migraciones y el SQL editor del dashboard (correcciones administrativas,
-- que no dejan movimiento: usarlas solo con un script versionado).
--
-- La autoverificación de abajo comprueba que las 9 funciones que escriben
-- stock/reservado sigan siendo SECURITY DEFINER del dueño de la tabla: si
-- alguien las vuelve INVOKER, la venta empezaría a fallar con el mensaje del
-- guardián, y la migración lo detecta antes.
--
-- ------------------------------------------------------------
-- POR QUÉ p_delta Y NO p_new_qty
-- ------------------------------------------------------------
-- Un valor absoluto ("dejá 12") es exactamente lo que des-vendía prendas: si
-- entre que el usuario miró (10) y confirmó (12, queriendo decir +2) se vendió
-- una, el absoluto deja 12 en vez de 11. Un delta ("+2") se aplica sobre el
-- stock REAL del momento, bajo FOR UPDATE: conmuta con las ventas
-- concurrentes. Es además lo que ya pedía la pantalla de Inventario.
-- Para el conteo físico ("conté 12, dejalo en 12") existe p_expected_qty: el
-- cliente manda el delta calculado sobre el stock que mostró, y si el stock
-- real ya no es ese (se vendió algo mientras contaban) la RPC rechaza y pide
-- volver a mirar, en vez de pisar la venta.
--
-- Sin tocar el enum movement_type: todo ajuste manual es 'adjustment' y el
-- motivo va en notes. (Un ALTER TYPE ... ADD VALUE no se puede usar en la misma
-- transacción: obligaría a otra migración suelta, como la 040.)
--
-- Esta SÍ va en una transacción.
-- ============================================================

BEGIN;


-- ============================================================
-- A. guard_variant_stock — el cliente no cambia stock_qty / reserved_qty
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (el default) A PROPÓSITO: current_user tiene que ser quien
-- hizo el INSERT/UPDATE, no el dueño de esta función. No agregar SECURITY
-- DEFINER: dejaría pasar a todos.
SET search_path = public
AS $$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c
   WHERE c.oid = TG_RELID;

  -- Caminos autorizados: funciones SECURITY DEFINER del dueño de la tabla,
  -- migraciones y SQL editor.
  IF current_user = v_owner OR current_user = 'supabase_admin' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.reserved_qty, 0) <> 0 THEN
      RAISE EXCEPTION 'Una variante nueva no puede nacer con unidades reservadas';
    END IF;
    IF COALESCE(NEW.stock_qty, 0) <> 0 AND NOT has_permission('inventario.gestionar') THEN
      RAISE EXCEPTION 'Para cargar stock inicial necesitás el permiso de gestionar inventario';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: solo se rechaza si el valor CAMBIA. Una pestaña vieja que manda el
  -- mismo stock_qty que ya hay no rompe una edición de precio.
  IF NEW.stock_qty IS DISTINCT FROM OLD.stock_qty THEN
    RAISE EXCEPTION 'El stock no se edita directamente: usá "Ajustar stock" (queda registrado quién y por qué)';
  END IF;
  IF NEW.reserved_qty IS DISTINCT FROM OLD.reserved_qty THEN
    RAISE EXCEPTION 'Las unidades reservadas las manejan los separados; no se editan a mano';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_variant_stock() IS
  'Trigger BEFORE INSERT/UPDATE en variants: el cliente no puede cambiar stock_qty ni reserved_qty. Solo pasan las funciones SECURITY DEFINER del dueño de la tabla (venta, devolución, compra, separados, traslados, adjust_variant_stock). SECURITY INVOKER a propósito. Ver 045.';

REVOKE EXECUTE ON FUNCTION public.guard_variant_stock() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_variant_stock ON public.variants;
CREATE TRIGGER trg_guard_variant_stock
  BEFORE INSERT OR UPDATE ON public.variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_variant_stock();


-- ============================================================
-- C. log_initial_stock — el stock con el que nace una variante queda registrado
-- ============================================================
-- Trigger y no código del cliente: cubre TODOS los caminos (VariantsPanel, la
-- API, un import futuro). Las variantes que nacen por compra o por traslado
-- nacen en 0 (su entrada la registra su propio trigger/RPC), así que acá no
-- hacen nada y no hay doble conteo.
--
-- SECURITY DEFINER: el INSERT en stock_movements no debe depender de la
-- política de esa tabla (el permiso ya lo validó guard_variant_stock).
-- stock_movements.created_by es NOT NULL: si no hay usuario (SQL editor,
-- scripts) no se puede atribuir y se avisa con NOTICE en vez de abortar.
CREATE OR REPLACE FUNCTION public.log_initial_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.stock_qty, 0) = 0 THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE NOTICE 'Variante % creada con stock % sin usuario: no se registra el movimiento de stock inicial', NEW.id, NEW.stock_qty;
    RETURN NULL;
  END IF;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, notes, created_by)
  VALUES (NEW.id, NEW.store_id, 'adjustment', NEW.stock_qty, 'Stock inicial', auth.uid());

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.log_initial_stock() IS
  'Trigger AFTER INSERT en variants: registra el stock inicial como movimiento adjustment "Stock inicial". Ver 045.';

REVOKE EXECUTE ON FUNCTION public.log_initial_stock() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_initial_stock ON public.variants;
CREATE TRIGGER trg_log_initial_stock
  AFTER INSERT ON public.variants
  FOR EACH ROW EXECUTE FUNCTION public.log_initial_stock();


-- ============================================================
-- B. RPC adjust_variant_stock — el único ajuste manual de stock
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_variant_stock(
  p_variant_id   uuid,
  p_delta        integer,
  p_reason       text,
  p_expected_qty integer DEFAULT NULL
)
RETURNS TABLE (
  stock_qty    integer,
  reserved_qty integer,
  movement_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid    uuid;
  v_reason text;
  v_var    record;
  v_new    integer;
  v_mov    uuid;
BEGIN
  -- [1] Identidad
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- [2] Permiso
  IF NOT has_permission('inventario.gestionar') THEN
    RAISE EXCEPTION 'No tenés permiso para ajustar el stock';
  END IF;

  -- Validaciones de entrada (antes de tocar nada)
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste tiene que ser distinta de 0';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'El motivo del ajuste es obligatorio';
  END IF;
  IF length(v_reason) > 300 THEN
    RAISE EXCEPTION 'El motivo no puede superar los 300 caracteres';
  END IF;

  -- [3] Vínculo de tienda + [5] pertenencia de la fila: SECURITY DEFINER ve
  -- variantes de cualquier organización; sin el filtro por la tienda activa,
  -- un UUID ajeno bastaría para ajustarla. FOR UPDATE serializa con las ventas
  -- y traslados de esta variante.
  SELECT v.id, v.store_id, v.stock_qty, v.reserved_qty
    INTO v_var
    FROM public.variants v
   WHERE v.id = p_variant_id
     AND v.store_id = get_my_store_id()
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La variante no existe o no es de tu tienda';
  END IF;

  -- [4] Organización (redundante con [3] hoy; es el límite duro)
  IF NOT is_store_in_my_org(v_var.store_id) THEN
    RAISE EXCEPTION 'La variante no pertenece a tu organización';
  END IF;

  -- Conteo físico: el cliente calculó el delta sobre el stock que mostró. Si
  -- el real cambió (se vendió algo mientras contaban), no se pisa.
  IF p_expected_qty IS NOT NULL AND v_var.stock_qty <> p_expected_qty THEN
    RAISE EXCEPTION 'El stock cambió mientras ajustabas (ahora hay %, no %). Revisá y volvé a intentar', v_var.stock_qty, p_expected_qty;
  END IF;

  v_new := v_var.stock_qty + p_delta;

  IF v_new < 0 THEN
    RAISE EXCEPTION 'El ajuste dejaría el stock en negativo (hay %, se quieren sacar %)', v_var.stock_qty, -p_delta;
  END IF;

  -- Lo apartado para separados es intocable: misma regla que la venta y el
  -- traslado.
  IF v_new < v_var.reserved_qty THEN
    RAISE EXCEPTION 'No se puede dejar menos de lo apartado en separados: hay % reservadas y quedarían %', v_var.reserved_qty, v_new;
  END IF;

  UPDATE public.variants v
     SET stock_qty = v_new
   WHERE v.id = v_var.id;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, notes, created_by)
  VALUES (v_var.id, v_var.store_id, 'adjustment', p_delta, v_reason, v_uid)
  RETURNING id INTO v_mov;

  RETURN QUERY SELECT v_new, v_var.reserved_qty, v_mov;
END;
$$;

COMMENT ON FUNCTION public.adjust_variant_stock(uuid, integer, text, integer) IS
  'Ajuste manual de stock, atómico: lockea la variante, aplica el delta y registra el movimiento adjustment con usuario y motivo. Exige inventario.gestionar. No baja de lo reservado. p_expected_qty = conteo físico con control de cambios concurrentes. Ver 045.';

REVOKE EXECUTE ON FUNCTION public.adjust_variant_stock(uuid, integer, text, integer) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.adjust_variant_stock(uuid, integer, text, integer) TO authenticated;


-- ============================================================
-- AUTOVERIFICACIÓN — aborta (y revierte todo) si algo quedó mal
-- ============================================================
DO $$
DECLARE
  v_owner   name;
  v_bad     text;
  v_missing text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = 'public.variants'::regclass;

  -- Los dos triggers nuevos, activos.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.variants'::regclass AND tgname = 'trg_guard_variant_stock' AND tgenabled <> 'D')
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.variants'::regclass AND tgname = 'trg_log_initial_stock' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Falta alguno de los triggers de la 045 en variants.';
  END IF;

  -- El guardián TIENE que ser INVOKER; si fuera DEFINER dejaría pasar a todos.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_variant_stock()'::regprocedure) THEN
    RAISE EXCEPTION 'guard_variant_stock quedó SECURITY DEFINER: así no bloquea nada.';
  END IF;

  -- Los caminos autorizados: las funciones que escriben stock/reservado tienen
  -- que ser SECURITY DEFINER del dueño de variants, o el guardián las frena y
  -- se rompen la venta, la compra o los traslados.
  SELECT string_agg(p.proname, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'deduct_stock_on_sale', 'restore_stock_on_return', 'increase_stock_on_purchase',
      'reserve_stock_on_layaway', 'release_stock_on_layaway_change', 'fulfill_stock_on_layaway_completion',
      'dispatch_transfer', 'receive_transfer', 'revert_transfer_dispatch', 'adjust_variant_stock'
    ]) AS f(name)
    LEFT JOIN pg_proc p ON p.proname = f.name AND p.pronamespace = 'public'::regnamespace
   WHERE p.oid IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'No encuentro funciones que deberían existir: %', v_missing;
  END IF;

  SELECT string_agg(p.proname || ' (definer=' || p.prosecdef || ', owner=' || pg_get_userbyid(p.proowner) || ')', ', ')
    INTO v_bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN (
       'deduct_stock_on_sale', 'restore_stock_on_return', 'increase_stock_on_purchase',
       'reserve_stock_on_layaway', 'release_stock_on_layaway_change', 'fulfill_stock_on_layaway_completion',
       'dispatch_transfer', 'receive_transfer', 'revert_transfer_dispatch', 'adjust_variant_stock')
     AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner) <> v_owner);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Estas funciones escriben stock pero el guardián las frenaría: %', v_bad;
  END IF;

  -- Cualquier OTRA función del schema que escriba stock_qty/reserved_qty y no
  -- esté en la lista: aviso, para revisarla a mano.
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ~* 'update\s+(public\.)?variants'
     AND p.prosrc ~* '(stock_qty|reserved_qty)\s*='
     AND p.proname NOT IN (
       'deduct_stock_on_sale', 'restore_stock_on_return', 'increase_stock_on_purchase',
       'reserve_stock_on_layaway', 'release_stock_on_layaway_change', 'fulfill_stock_on_layaway_completion',
       'dispatch_transfer', 'receive_transfer', 'revert_transfer_dispatch', 'adjust_variant_stock');
  IF v_bad IS NOT NULL THEN
    RAISE NOTICE 'Aviso: funciones que escriben stock y no están en la lista revisada: %', v_bad;
  END IF;

  -- RPC: molde de la 041.
  IF NOT has_function_privilege('authenticated', 'public.adjust_variant_stock(uuid, integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'adjust_variant_stock no quedó ejecutable por authenticated.';
  END IF;
  IF has_function_privilege('anon', 'public.adjust_variant_stock(uuid, integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'adjust_variant_stock quedó ejecutable por anon.';
  END IF;

  RAISE NOTICE '045 OK: guardián de stock + stock inicial registrado + adjust_variant_stock.';
END;
$$;


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Tests (fixtures propios, terminan en ROLLBACK). En el LAB, primero
--    re-aplicar esta migración tras un lab-restore (los permisos de funciones
--    del lab no son los de prod, ver CLAUDE.md):
--      ./scripts/lab-apply-migration.sh supabase/tests/045_stock_changes_audited.test.sql
--
-- 2. Desde la app:
--    · editar SOLO el precio de una variante → el stock no se toca
--    · "Ajustar stock" con motivo → stock nuevo + movimiento con usuario y motivo
--    · intentar dejar menos de lo reservado → 'No se puede dejar menos de lo apartado…'
--    · PATCH directo de stock_qty por REST → 'El stock no se edita directamente…'
--
--
-- ============================================================
-- REVERSIÓN
-- ============================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_variant_stock ON public.variants;
--   DROP TRIGGER IF EXISTS trg_log_initial_stock   ON public.variants;
--   DROP FUNCTION IF EXISTS public.guard_variant_stock();
--   DROP FUNCTION IF EXISTS public.log_initial_stock();
--   DROP FUNCTION IF EXISTS public.adjust_variant_stock(uuid, integer, text, integer);
-- COMMIT;
--
-- Revertir sin revertir el frontend deja la pantalla de ajuste sin RPC (falla
-- con toast) y vuelve a habilitar la escritura directa de stock_qty desde la
-- API. Los movimientos "Stock inicial" ya registrados quedan (son historia).
-- ============================================================
