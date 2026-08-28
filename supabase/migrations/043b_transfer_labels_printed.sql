-- ============================================================
-- 043b — Persistir el estado de impresión de etiquetas
--
-- Va JUNTO con la 043 en el mismo despliegue.
--
-- ------------------------------------------------------------
-- POR QUÉ NO ALCANZA localStorage
-- ------------------------------------------------------------
-- El caso real: la encargada imprime en la máquina del mostrador y el
-- administrador abre el traslado en otra. Con el estado en localStorage, el
-- aviso rojo vuelve a salir como si nadie hubiera impreso.
--
-- Eso no es una molestia menor: ENTRENA A IGNORAR EL AVISO. Y el bloque de
-- etiquetas existe justamente porque el problema que anuncia (el barcode es
-- único por tienda, la lectora del destino no reconoce la etiqueta del origen)
-- aparece días después en la caja, cuando ya nadie lo conecta. Un aviso que
-- "miente" la mitad de las veces deja de leerse, y entonces no sirve para nada.
--
-- El dato es de la ORGANIZACIÓN, no del navegador. Va en la tabla.
--
-- ------------------------------------------------------------
-- POR QUÉ TAMBIÉN labels_printed_by
-- ------------------------------------------------------------
-- Sale gratis (una columna nullable más en el mismo ALTER) y responde la
-- pregunta que se hace cuando algo sale mal: "¿quién imprimió estas etiquetas?"
-- — porque si están mal impresas, o nadie las encuentra, saber a quién
-- preguntarle es la mitad del problema. Mismo criterio que received_by_store_id.
--
-- NO se guarda labels_printed_by_store_id: en received_by_store_id la tienda es
-- informativa porque la recepción admite tres orígenes distintos (destino,
-- origen, administración) y la EXCEPCIÓN es el dato valioso. Acá la RPC solo
-- acepta al destino, así que la tienda sería siempre to_store_id: una columna
-- que no puede sorprender a nadie no vale la pena.
--
-- ------------------------------------------------------------
-- IDEMPOTENTE POR DISEÑO
-- ------------------------------------------------------------
-- "Volver a imprimir" es una acción legítima y frecuente (se acabó el papel, la
-- impresora comió una etiqueta). La RPC NO falla si ya estaba impreso:
-- simplemente actualiza el timestamp y el autor. El último que imprimió es la
-- información útil, no el primero.
--
-- Requiere: 041 (tablas) y 042 (permiso) aplicadas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Las columnas
-- ------------------------------------------------------------
ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS labels_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS labels_printed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.transfers.labels_printed_at IS
  'Cuándo se imprimieron por última vez las etiquetas con los códigos del DESTINO. NULL = nunca. El aviso rojo de la pantalla de recepción depende de esto; vive en la tabla y no en el navegador porque la persona que imprime y la que revisa suelen estar en máquinas distintas.';
COMMENT ON COLUMN public.transfers.labels_printed_by IS
  'Quién imprimió las etiquetas por última vez. Para saber a quién preguntarle si están mal impresas o no aparecen.';

-- El histórico queda en NULL: ningún traslado anterior imprimió etiquetas por
-- esta vía, y decir lo contrario sería inventar un hecho (mismo criterio que
-- qty_received NULL en la recepción simple).


-- ------------------------------------------------------------
-- 2. mark_transfer_labels_printed
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_transfer_labels_printed(p_transfer_id uuid)
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

  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo de tienda.
  -- SOLO EL DESTINO: es quien tiene la mercancía en la mano y quien pega las
  -- etiquetas. Que el origen (o un admin desde otra tienda) pudiera apagar el
  -- aviso sería justamente lo que rompe su propósito: el aviso es PARA el
  -- destino y tiene que seguir rojo hasta que el destino imprima de verdad.
  -- Por eso acá NO se usa la regla ampliada de receive_transfer.
  IF v_t.to_store_id <> get_my_store_id() THEN
    RAISE EXCEPTION 'Solo la tienda de destino puede marcar las etiquetas como impresas';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  -- Las etiquetas del destino solo existen una vez resuelto el destino, o sea al
  -- recibir; 'in_transit' se admite igual para no atarse a ese detalle si mañana
  -- el mapeo se resuelve antes.
  IF v_t.status NOT IN ('in_transit', 'received') THEN
    RAISE EXCEPTION 'Solo se pueden imprimir etiquetas de un traslado en tránsito o recibido';
  END IF;

  -- Idempotente A PROPÓSITO: sin guard de "ya impreso". Volver a imprimir pisa
  -- el timestamp y el autor, que es lo correcto — interesa el ÚLTIMO que
  -- imprimió, no el primero.
  UPDATE public.transfers
     SET labels_printed_at = now(),
         labels_printed_by = v_uid,
         updated_at        = now()
   WHERE id = p_transfer_id
     AND status IN ('in_transit', 'received');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

COMMENT ON FUNCTION public.mark_transfer_labels_printed(uuid) IS
  'Marca las etiquetas de un traslado como impresas (solo la tienda DESTINO). Idempotente: volver a imprimir actualiza el timestamp y el autor.';

REVOKE EXECUTE ON FUNCTION public.mark_transfer_labels_printed(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.mark_transfer_labels_printed(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 3. Autoverificación
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'transfers'
       AND column_name IN ('labels_printed_at', 'labels_printed_by')
     GROUP BY table_name HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Faltan las columnas labels_printed_at / labels_printed_by en transfers.';
  END IF;

  -- Coherencia de las dos columnas: si hay fecha, hay autor.
  -- OJO: NO se verifica "ningún traslado tiene labels_printed_at" — eso es
  -- cierto recién aplicada, pero rompería la idempotencia en cuanto alguien
  -- imprima (re-aplicar abortaría). El ADD COLUMN sin DEFAULT ya garantiza por
  -- construcción que el histórico nace en NULL; el invariante que SÍ vale para
  -- siempre es que las dos columnas se escriben juntas.
  IF EXISTS (
    SELECT 1 FROM public.transfers
     WHERE (labels_printed_at IS NULL) <> (labels_printed_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay traslados con labels_printed_at y labels_printed_by desparejos.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'mark_transfer_labels_printed' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'mark_transfer_labels_printed no quedó creada como SECURITY DEFINER.';
  END IF;

  IF NOT has_function_privilege('authenticated',
        'public.mark_transfer_labels_printed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede ejecutar mark_transfer_labels_printed.';
  END IF;

  IF has_function_privilege('anon',
        'public.mark_transfer_labels_printed(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon PUEDE ejecutar mark_transfer_labels_printed: el REVOKE no aplicó.';
  END IF;

  RAISE NOTICE '043b OK: labels_printed_at/by + mark_transfer_labels_printed (solo destino, idempotente).';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Las columnas y la función:
--      SELECT column_name, data_type, is_nullable FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='transfers'
--         AND column_name LIKE 'labels_printed%';
--
--      SELECT p.proname, p.prosecdef,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
--             has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ok
--        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname='public' AND p.proname='mark_transfer_labels_printed';
--
-- 2. Todo el histórico en NULL (debe dar 0):
--      SELECT count(*) FROM transfers WHERE labels_printed_at IS NOT NULL;
--
-- 3. Matriz funcional (con un traslado recibido):
--    · el DESTINO marca                → OK, labels_printed_at = now(), _by = quien llamó
--    · marca DOS veces                 → OK las dos, el timestamp AVANZA (idempotente)
--    · el ORIGEN intenta marcar        → 'Solo la tienda de destino…'
--    · traslado de OTRA organización   → 'Solo la tienda de destino…'   ([5])
--    · sin traslados.gestionar         → 'No tenés permiso…'
--    · sobre un BORRADOR o CANCELADO   → 'Solo se pueden imprimir etiquetas…'
--
-- 4. Que el aviso deje de depender del navegador: marcar desde una sesión y
--    abrir el traslado desde OTRA — el bloque tiene que verse verde en las dos.
--
--
-- ============================================================
-- REVERSIÓN
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.mark_transfer_labels_printed(uuid);
--   ALTER TABLE public.transfers
--     DROP COLUMN IF EXISTS labels_printed_at,
--     DROP COLUMN IF EXISTS labels_printed_by;
-- COMMIT;
--
-- Se pierde el registro de qué se imprimió: el aviso vuelve a salir rojo en
-- todos los traslados recibidos. No rompe nada más — ninguna otra función lee
-- estas columnas.
-- ============================================================
