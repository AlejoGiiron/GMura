-- ============================================================
-- 043 — update_transfer_shipping: editar los datos logísticos
--
-- Motivo (handoff §4.4): el número de guía casi siempre se consigue DESPUÉS de
-- despachar. Con las 6 RPC de la 041, un traslado en tránsito era inmutable, así
-- que la guía real no se podía registrar nunca. Esta RPC abre esa puerta —
-- SOLO esa.
--
-- Requiere: 041 (tablas y RPC) y 042 (permiso traslados.gestionar) aplicadas.
--
-- ------------------------------------------------------------
-- ALCANCE: TRES COLUMNAS, NADA MÁS
-- ------------------------------------------------------------
-- Toca carrier, tracking_ref, notes y updated_at. NO toca estado, ni líneas, ni
-- tiendas, ni cantidades, ni nada que mueva stock. Es deliberadamente la RPC más
-- chica del módulo: si mañana hace falta editar algo más, va otra función, no un
-- parámetro más acá. Una función que "edita el traslado" en general sería la
-- puerta por la que se cuela un cambio de estado sin guard.
--
-- ------------------------------------------------------------
-- QUIÉN PUEDE: SOLO EL ORIGEN
-- ------------------------------------------------------------
-- carrier y tracking_ref son datos de quien despacha: el origen contrata la
-- encomienda y recibe la guía. Eso es evidente.
--
-- `notes` merece el argumento explícito, porque parece un canal de ida y vuelta
-- y NO lo es: la UI lo presenta como "Notas para el destino" al escribirlo
-- (handoff §5.2) y como "NOTAS DE {ORIGEN}" al leerlo (§5.7). El campo está
-- ETIQUETADO POR SU AUTOR. Si el destino pudiera escribir ahí, lo que diga
-- aparecería en la pantalla del traslado como si lo hubiera dicho el origen —
-- y en un módulo cuyo punto es la trazabilidad (received_by_store_id existe
-- justamente para saber quién hizo qué), atribuir mal un texto es peor que no
-- tener el canal.
--
-- Si el destino necesita responder ("llegó una caja abierta"), eso pide un campo
-- APARTE (destination_notes) con su propia etiqueta, no compartir este. No se
-- agrega ahora: no hay caso de uso pedido, y el lugar natural donde va a
-- aparecer es la fase de conteo, donde las discrepancias ya se reportan.
--
-- ------------------------------------------------------------
-- ESTADOS PERMITIDOS: draft e in_transit
-- ------------------------------------------------------------
-- En 'received' y 'cancelled' se rechaza: un traslado cerrado es un documento
-- histórico. Cambiarle la guía después de recibido reescribiría el registro de
-- algo que ya pasó, que es justo lo que el módulo evita en todos lados
-- (cash_expenses inmutable, los traslados se anulan y no se borran).
--
-- Los 5 chequeos de siempre, marcados [1]..[5]. Mensajes en español.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.update_transfer_shipping(
  p_transfer_id  uuid,
  p_carrier      text DEFAULT NULL,
  p_tracking_ref text DEFAULT NULL,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_t   record;
BEGIN
  -- [1] Identidad
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- [2] Permiso
  IF NOT has_permission('traslados.gestionar') THEN
    RAISE EXCEPTION 'No tenés permiso para gestionar traslados';
  END IF;

  -- El header se lockea primero, igual que en las demás: si alguien despacha,
  -- recibe o revierte al mismo tiempo, esto se serializa y el chequeo de estado
  -- de abajo ve el valor real, no uno viejo.
  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo de tienda.
  -- Dentro de SECURITY DEFINER el SELECT de arriba encuentra CUALQUIER traslado
  -- de la base, incluido el de otra organización: sin este chequeo bastaría un
  -- UUID ajeno para editarlo.
  -- Solo el ORIGEN: es quien despacha, contrata la encomienda y consigue la
  -- guía; y `notes` se lee en el destino como "notas de {origen}", así que
  -- dejar escribir a la otra punta atribuiría mal el texto.
  IF v_t.from_store_id <> get_my_store_id() THEN
    RAISE EXCEPTION 'Solo la tienda de origen puede editar los datos del envío';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  IF v_t.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Solo se pueden editar los datos de un traslado en borrador o en tránsito';
  END IF;

  -- Guard de transición al revés que en las otras: acá el estado NO cambia, así
  -- que el WHERE lo REPITE para que un cambio de estado concurrente entre el
  -- SELECT y el UPDATE no deje pasar la edición.
  UPDATE public.transfers
     SET carrier      = NULLIF(btrim(coalesce(p_carrier, '')), ''),
         tracking_ref = NULLIF(btrim(coalesce(p_tracking_ref, '')), ''),
         notes        = NULLIF(btrim(coalesce(p_notes, '')), ''),
         updated_at   = now()
   WHERE id = p_transfer_id
     AND status IN ('draft', 'in_transit');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

COMMENT ON FUNCTION public.update_transfer_shipping(uuid, text, text, text) IS
  'Edita SOLO carrier, tracking_ref y notes de un traslado en borrador o en tránsito. Solo la tienda de ORIGEN (el número de guía se consigue después de despachar). No toca estado, líneas ni stock.';

REVOKE EXECUTE ON FUNCTION public.update_transfer_shipping(uuid, text, text, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.update_transfer_shipping(uuid, text, text, text) TO authenticated;


-- ------------------------------------------------------------
-- Autoverificación (aborta y revierte si algo no quedó bien)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'update_transfer_shipping'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'update_transfer_shipping no quedó creada como SECURITY DEFINER.';
  END IF;

  IF NOT has_function_privilege('authenticated',
        'public.update_transfer_shipping(uuid, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede ejecutar update_transfer_shipping.';
  END IF;

  IF has_function_privilege('anon',
        'public.update_transfer_shipping(uuid, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon PUEDE ejecutar update_transfer_shipping: el REVOKE no aplicó.';
  END IF;

  RAISE NOTICE '043 OK: update_transfer_shipping creada (SECURITY DEFINER, solo authenticated).';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. La función existe con los privilegios correctos:
--      SELECT p.proname, p.prosecdef,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
--             has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ok
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'update_transfer_shipping';
--      -- prosecdef = t · auth_ok = t · anon_ok = f
--
-- 2. Matriz funcional (con un traslado propio en tránsito):
--    · el ORIGEN edita guía              → OK, tracking_ref cambia
--    · el DESTINO intenta editar          → 'Solo la tienda de origen…'
--    · un traslado de OTRA organización   → 'Solo la tienda de origen…'  ([5])
--    · sin traslados.gestionar            → 'No tenés permiso…'
--    · sobre un traslado ya RECIBIDO      → 'Solo se pueden editar los datos…'
--    · sobre un traslado CANCELADO        → ídem
--    · mandar '' en los tres campos       → quedan NULL (no cadenas vacías)
--
-- 3. Que NO haya tocado nada más (comparar antes/después):
--      SELECT status, from_store_id, to_store_id,
--             (SELECT count(*) FROM transfer_items WHERE transfer_id = t.id) AS lineas,
--             (SELECT COALESCE(sum(qty_sent),0) FROM transfer_items WHERE transfer_id = t.id) AS unidades
--        FROM transfers t WHERE id = '<uuid>';
--
--
-- ============================================================
-- REVERSIÓN
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.update_transfer_shipping(uuid, text, text, text);
-- COMMIT;
--
-- Sin efectos colaterales: la función no tiene estado y nada depende de ella en
-- la base. Lo único que se pierde es la capacidad de cargar la guía después de
-- despachar (la UI muestra el bloque de datos del envío en modo lectura).
-- ============================================================
