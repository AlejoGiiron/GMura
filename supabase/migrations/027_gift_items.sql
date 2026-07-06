-- ============================================================
-- 027 — Ítems de REGALO ($0) en el POS + permiso ventas.regalo
--
-- Objetivo:
--   Permitir marcar una línea de venta (order_items) como REGALO: precio final
--   $0 con un MOTIVO de una lista cerrada. El regalo debe quedar SEPARABLE de un
--   descuento comercial en reportes (un regalo es una entrega gratuita
--   intencional; un descuento comercial es una rebaja sobre el precio).
--
-- Modelo (por qué así):
--   El sistema ya tiene, por línea, list_price (catálogo) y unit_price (final
--   vendido) — migración 019. El descuento por línea es DERIVADO:
--     descuento_linea = (list_price - unit_price) * qty
--   Un REGALO se modela como el caso extremo unit_price = 0 CONSERVANDO
--   list_price (el valor de catálogo de lo regalado), MÁS la marca is_gift=true
--   y un motivo. Así:
--     · valor regalado        = Σ (list_price * qty)      WHERE is_gift
--     · descuento comercial   = Σ ((list_price-unit_price)*qty) WHERE NOT is_gift
--     · ventas netas (ingreso)= Σ (unit_price * qty)       (los regalos aportan 0)
--   is_gift ALCANZA para separar regalo de descuento comercial (ver nota de
--   reportes al pie); gift_reason agrega el desglose por motivo.
--
--   NO se agrega una columna de "monto regalado": sería redundante y
--   desincronizable — list_price*qty ya lo expresa y el CHECK garantiza
--   unit_price=0 en los regalos.
--
-- Permiso:
--   Marcar un regalo requiere el permiso nuevo ventas.regalo, que se añade al
--   rol Administrador (el Dueño ya lo cubre por el comodín '*'). El Vendedor NO
--   lo lleva. Mismo mecanismo que 023 (idempotente, excluye al Dueño con
--   NOT permissions ? '*'). Aquí se AÑADE el permiso al array existente (jsonb
--   ||) en vez de re-setear el array completo, para no pisar otros permisos ni
--   depender de restar la lista de 023 (menos drift); el guard
--   NOT permissions ? 'ventas.regalo' lo hace idempotente.
--
-- Atomicidad: todo en una transacción (BEGIN/COMMIT). Si algo falla, revierte
--   TODO. Idempotente: reaplicar deja el mismo estado (columnas IF NOT EXISTS,
--   constraint DROP+ADD, permiso con guard).
--
-- Requiere: 019 (list_price en order_items), 021 (tabla roles + trigger de
--   inmutabilidad del Dueño) y 023 (arrays de permisos base) aplicadas.
--
-- NO toca: TypeScript (es el paso siguiente), RLS de order_items, ni las vistas
--   de reportes (ajuste documentado al pie; se hará en un paso aparte).
--
-- Cómo aplicar (manual / lab):
--   ./scripts/lab-apply-migration.sh 027_gift_items.sql
--   (o psql -v ON_ERROR_STOP=1 -f supabase/migrations/027_gift_items.sql)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Columnas en order_items
--    is_gift     : marca de línea de regalo (default false → filas existentes
--                  quedan como "no regalo" sin backfill).
--    gift_reason : motivo de una lista cerrada; SOLO se llena si is_gift=true.
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_gift     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_reason text;

COMMENT ON COLUMN public.order_items.is_gift IS
  'Línea entregada como REGALO ($0). Si true: unit_price=0 y gift_reason ∈ lista cerrada. El valor regalado es list_price*qty (se conserva el catálogo).';
COMMENT ON COLUMN public.order_items.gift_reason IS
  'Motivo del regalo (regalo|muestra|promocion|compensacion). NULL cuando is_gift=false. Garantizado por order_items_gift_coherent.';

-- ------------------------------------------------------------
-- 2. CHECK de coherencia is_gift / gift_reason / unit_price
--    Exactamente uno de los dos casos debe cumplirse:
--      (a) REGALO      → is_gift=true  AND motivo válido AND unit_price=0
--      (b) NO REGALO   → is_gift=false AND gift_reason IS NULL
--    Esto rechaza los 3 estados inválidos:
--      · regalo sin motivo         (is_gift=true, gift_reason NULL/inválido)
--      · motivo sin regalo         (is_gift=false, gift_reason NOT NULL)
--      · regalo con precio > 0      (is_gift=true, unit_price<>0)
--
--    Filas existentes: is_gift=false + gift_reason=NULL → satisfacen (b), así
--    que el ADD valida sin error. En una tabla enorme en prod se puede hacer en
--    dos pasos (ADD ... NOT VALID; luego VALIDATE CONSTRAINT) para reducir el
--    lock; aquí, con todas las filas ya conformes, se agrega validado directo.
--    DROP IF EXISTS + ADD lo hace idempotente.
--
--    NULL-safety (lógica de 3 valores): un CHECK solo RECHAZA cuando evalúa a
--    FALSE; si evalúa a NULL (desconocido) PERMITE la fila. Con gift_reason
--    NULL, `gift_reason IN (...)` da NULL → sin el guard, un regalo sin motivo
--    (is_gift=true, gift_reason=NULL) se colaría. Por eso la rama (a) exige
--    explícitamente gift_reason IS NOT NULL, para que ese caso evalúe a FALSE.
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_gift_coherent;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_gift_coherent CHECK (
    (is_gift = true
       AND gift_reason IS NOT NULL
       AND gift_reason IN ('regalo', 'muestra', 'promocion', 'compensacion')
       AND unit_price = 0)
    OR
    (is_gift = false
       AND gift_reason IS NULL)
  );

COMMENT ON CONSTRAINT order_items_gift_coherent ON public.order_items IS
  'Coherencia del regalo: regalo ⇒ motivo válido + precio 0; no-regalo ⇒ sin motivo. Impide regalo sin motivo, motivo sin regalo y regalo con precio > 0.';

-- ------------------------------------------------------------
-- 3. Permiso ventas.regalo → rol Administrador de La Bodega del Jeans
--    · Dueño: NO se toca (comodín '*' ya lo cubre y es inmutable por
--      trg_roles_protect_owner; un UPDATE sobre él abortaría). Excluido por
--      NOT permissions ? '*'.
--    · Vendedor: NO lleva ventas.regalo (no se actualiza su fila).
--    · Idempotente: el guard NOT permissions ? 'ventas.regalo' evita duplicar
--      y hace no-op en re-runs.
--    (Multi-org futuro: el seed de roles de cada nueva organización debería
--     incluir ventas.regalo en su Administrador; acá se scopea a la única org
--     existente, igual que 021/023.)
-- ------------------------------------------------------------
UPDATE public.roles
   SET permissions = permissions || '["ventas.regalo"]'::jsonb
 WHERE organization_id = (
         SELECT id FROM public.organizations WHERE name = 'La Bodega del Jeans'
       )
   AND name = 'Administrador'
   AND NOT permissions ? '*'
   AND NOT permissions ? 'ventas.regalo';

-- ------------------------------------------------------------
-- 4. Autoverificación (aborta y revierte TODO si algo no quedó como se espera)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_org uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name = 'La Bodega del Jeans';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No existe la organización ''La Bodega del Jeans'' (¿se aplicó la 020?).';
  END IF;

  -- Administrador DEBE tener ventas.regalo
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Administrador'
       AND permissions ? 'ventas.regalo'
  ) THEN
    RAISE EXCEPTION 'Administrador no quedó con ventas.regalo (¿existe el rol? ¿se aplicaron 021/023?).';
  END IF;

  -- Vendedor NO debe tener ventas.regalo
  IF EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Vendedor'
       AND permissions ? 'ventas.regalo'
  ) THEN
    RAISE EXCEPTION 'El Vendedor NO debe tener ventas.regalo, pero lo tiene.';
  END IF;

  -- Dueño intacto (sigue siendo comodín)
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
     WHERE organization_id = v_org AND name = 'Dueño'
       AND permissions ? '*'
  ) THEN
    RAISE EXCEPTION 'El rol Dueño no quedó con el comodín ''*'' (no debió tocarse).';
  END IF;

  RAISE NOTICE '027 OK: columnas is_gift/gift_reason + CHECK creados; ventas.regalo → Administrador. Vendedor y Dueño intactos.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar)
-- ============================================================
-- 1. Columnas y default:
--      SELECT column_name, data_type, column_default, is_nullable
--        FROM information_schema.columns
--       WHERE table_name = 'order_items' AND column_name IN ('is_gift','gift_reason');
--      -- is_gift: boolean, default false, NOT NULL; gift_reason: text, nullable
--
-- 2. El CHECK rechaza los 3 estados inválidos (los 3 deben FALLAR).
--    Usa una orden real de la tienda; estos INSERT son ilustrativos:
--      -- (a) regalo sin motivo:
--      -- INSERT ... (is_gift, gift_reason, unit_price, list_price) VALUES (true,  NULL,     0,    50000);  -- ERROR
--      -- (b) motivo sin regalo:
--      -- INSERT ... VALUES (false, 'regalo', 50000, 50000);                                              -- ERROR
--      -- (c) regalo con precio > 0:
--      -- INSERT ... VALUES (true,  'regalo', 50000, 50000);                                              -- ERROR
--      -- (d) regalo válido (debe FUNCIONAR):
--      -- INSERT ... VALUES (true,  'regalo', 0,     50000);                                              -- OK
--      -- (e) venta normal (debe FUNCIONAR):
--      -- INSERT ... VALUES (false, NULL,     50000, 50000);                                              -- OK
--
-- 3. Permisos por rol:
--      SELECT name, permissions ? 'ventas.regalo' AS tiene_regalo
--        FROM public.roles ORDER BY name;
--      -- Administrador: true · Vendedor: false · Dueño: false (lo cubre '*')
--
-- 4. has_permission() por rol (autenticado como cada uno):
--      SELECT has_permission('ventas.regalo');
--      -- Administrador → true · Vendedor → false · Dueño → true (comodín)
--
-- 5. "Valor regalado" separado del descuento comercial (query de reporte base):
--      SELECT
--        SUM(CASE WHEN is_gift THEN list_price * qty ELSE 0 END)                        AS valor_regalado,
--        SUM(CASE WHEN NOT is_gift THEN (list_price - unit_price) * qty ELSE 0 END)     AS descuento_comercial,
--        SUM(unit_price * qty)                                                          AS ingreso_neto
--      FROM public.order_items;
--
-- ============================================================
-- REVERSIÓN (si hiciera falta deshacer, en una transacción)
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_gift_coherent;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS gift_reason;
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS is_gift;
--   -- Quitar el permiso del Administrador (excluyendo al Dueño por seguridad):
--   UPDATE public.roles
--      SET permissions = permissions - 'ventas.regalo'
--    WHERE name = 'Administrador' AND NOT permissions ? '*';
-- COMMIT;
-- Nota: si ya hubiera órdenes con is_gift=true, el DROP COLUMN borra ese dato
--   histórico. Revisar antes:
--   SELECT count(*) FROM public.order_items WHERE is_gift;  -- debe ser 0 para revertir sin pérdida
-- ============================================================
