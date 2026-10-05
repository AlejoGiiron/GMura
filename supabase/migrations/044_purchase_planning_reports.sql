-- ============================================================
-- 044 — Informes de planificación de compras (fase 0)
--
-- Diagnóstico y plan completos: memoria "informes temporada alta" (2026-10-05).
-- Requiere la 041 (normalize_catalog_text, transfers/transfer_items) aplicada.
--
-- Qué agrega:
--   0. schema reporting                      — para las funciones INTERNAS
--   1. reporting.net_sales_lines()           — LA definición de "venta neta"
--   2. reporting.authorized_store_ids()      — los chequeos [1]..[4] compartidos
--   3. reporting.category_key()              — equivalencias de categoría
--   4. public.report_sales_by_category()     — RPC: ventas por categoría × talla
--   5. public.report_variant_performance()   — RPC: desempeño por variante CON
--                                              período (reemplaza a la vista
--                                              product_performance en ReportsPage,
--                                              que ignoraba las fechas)
--
-- ------------------------------------------------------------
-- POR QUÉ UN SCHEMA APARTE PARA LAS INTERNAS
-- ------------------------------------------------------------
-- net_sales_lines no valida tiendas: confía en su llamador. En "reporting"
-- (sin USAGE para anon/authenticated y fuera de los schemas que expone
-- PostgREST) ni siquiera es direccionable desde el cliente; el intento falla al
-- resolver el nombre ("permission denied for schema"). Las RPC públicas siguen
-- el molde de la 041: EXECUTE solo para authenticated, revocado a anon.
--
-- Nota del lab: con la imagen supabase/postgres 17.6.1.111 (supautils 3.2.0)
-- llamar como anon/authenticated a una función sin EXECUTE hacía segfault. Era
-- un bug de esa supautils, corregido en la 3.4.0; producción ya corre la 3.4.0
-- (verificado 2026-10-05). El lab se actualizó a 17.6.1.166.
--
-- ------------------------------------------------------------
-- POR QUÉ RPC SECURITY DEFINER Y NO VISTAS security_invoker (molde 003/033)
-- ------------------------------------------------------------
-- El RLS de lectura de orders/variants/products/... es
-- store_id = get_my_store_id(): UNA tienda, la activa. Una vista security_invoker
-- nunca puede devolver el consolidado Tebaida + Armenia. Abrir el SELECT de esas
-- tablas a get_my_stores() cambiaría mucho más que estos informes. Así que el
-- molde es el de la 041: SECURITY DEFINER + reimplementar los chequeos adentro.
--
-- Los chequeos (comentados [1]..[5] en el código, igual que en la 041):
--   [1] Identidad          → auth.uid() no nulo
--   [2] Permiso            → has_permission('reportes.ver')
--   [3] Vínculo de tienda  → CADA tienda pedida está en get_my_stores()
--   [4] Organización       → CADA tienda pedida pasa is_store_in_my_org()
--   [5] Pertenencia        → toda lectura filtra store_id = ANY(tiendas validadas).
--       SECURITY DEFINER apaga el RLS: sin [5], una subconsulta sin filtro
--       leería ventas de cualquier organización de la base.
--
-- ------------------------------------------------------------
-- QUÉ ES "VENTA NETA" (una sola definición: reporting.net_sales_lines)
-- ------------------------------------------------------------
--   + order_items de órdenes NO canceladas. Incluye, sin tratamiento especial
--     porque ya son órdenes normales: conversión de separado (la orden que crea
--     useCompleteLayaway), fiado (is_credit) e ítems nuevos de un cambio
--     (orders.return_id). Fecha = día civil de Bogotá de la orden.
--   − return_items de devoluciones completadas (reembolso Y cambio), por
--     variante, con la fecha de la DEVOLUCIÓN (no la de la venta original).
--   · Regalo (is_gift): cuenta en UNIDADES (salió mercancía) y $0 en plata
--     (unit_price = 0 por el CHECK order_items_gift_coherent).
--   · Descuento de orden: se prorratea entre los ítems con
--       factor = (subtotal − discount) / Σ(qty × unit_price)
--     SALVO en órdenes de cambio: ahí el discount es el crédito por lo devuelto
--     (returnCalc), que ya se descuenta al restar la devolución; prorratearlo lo
--     restaría dos veces.
--     MEDIDO EN PROD (2026-10-05): en las 895 órdenes no-cambio se cumple
--     subtotal − discount = Σ(qty × unit_price) exacto — el POS ya baja el
--     descuento de la orden al unit_price de cada línea y orders.subtotal va a
--     precio de lista. O sea: hoy el factor es 1 en el 100% de las órdenes. El
--     prorrateo queda como defensa por si algún flujo futuro deja un descuento
--     de orden sin repartir. El recargo (surcharge, Addi) NO es venta de
--     producto: no entra.
--   · La devolución se resta al precio NETO al que se vendió: unit_price de la
--     línea devuelta × factor de la orden original.
--   · Canceladas: fuera (y sus devoluciones también).
--
-- Esta SÍ va en una transacción: no agrega valores de enum.
-- ============================================================

BEGIN;


-- ============================================================
-- 0. schema reporting — solo para el owner (las RPC SECURITY DEFINER)
-- ============================================================
CREATE SCHEMA IF NOT EXISTS reporting;
REVOKE ALL ON SCHEMA reporting FROM public, anon, authenticated;

COMMENT ON SCHEMA reporting IS
  'Funciones INTERNAS de los informes. Sin USAGE para anon/authenticated y fuera de los schemas expuestos por PostgREST: solo las llaman las RPC public.report_* (SECURITY DEFINER).';


-- ============================================================
-- 1. reporting.net_sales_lines — la definición única de venta neta
-- ============================================================
-- INTERNA. Solo la llaman las RPC de este archivo (que corren como owner)
-- DESPUÉS de validar p_store_ids. No valida nada por sí misma: confía en su
-- llamador.
--
-- Una fila por línea de venta (kind 'sale' | 'exchange_sale') o de devolución
-- (kind 'return', con units y amount NEGATIVOS). Agregar = sumar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reporting.net_sales_lines(
  p_store_ids uuid[],
  p_from      date,
  p_to        date
)
RETURNS TABLE (
  store_id   uuid,
  variant_id uuid,
  product_id uuid,
  sold_on    date,
  kind       text,
  units      integer,
  amount     numeric,
  is_gift    boolean,
  source_id  uuid
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH sale_orders AS (
    SELECT o.id, o.store_id, o.return_id,
           (o.created_at AT TIME ZONE 'America/Bogota')::date AS d
      FROM public.orders o
     WHERE o.store_id = ANY (p_store_ids)                      -- [5]
       AND o.status <> 'cancelled'
       AND (o.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN p_from AND p_to
  ),
  rets AS (
    SELECT r.id, r.store_id, r.original_order_id,
           (r.created_at AT TIME ZONE 'America/Bogota')::date AS d
      FROM public.returns r
      JOIN public.orders oo ON oo.id = r.original_order_id
     WHERE r.store_id = ANY (p_store_ids)                      -- [5]
       AND r.status = 'completed'
       AND oo.status <> 'cancelled'
       AND (r.created_at AT TIME ZONE 'America/Bogota')::date BETWEEN p_from AND p_to
  ),
  -- Factor de prorrateo del descuento de orden: de las órdenes del período Y de
  -- las órdenes originales de las devoluciones del período (que pueden ser de
  -- antes del período).
  factors AS (
    SELECT o.id AS order_id,
           CASE
             WHEN o.return_id IS NOT NULL THEN 1::numeric
             ELSE COALESCE(
                    LEAST(1::numeric, GREATEST(0::numeric,
                      (o.subtotal - o.discount)
                        / NULLIF(SUM(oi.qty::numeric * oi.unit_price), 0))),
                    1::numeric)
           END AS f
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.id IN (SELECT so.id FROM sale_orders so
                    UNION
                    SELECT rt.original_order_id FROM rets rt)
     GROUP BY o.id
  )
  SELECT so.store_id,
         oi.variant_id,
         oi.product_id,
         so.d,
         CASE WHEN so.return_id IS NULL THEN 'sale' ELSE 'exchange_sale' END,
         oi.qty,
         round(oi.qty::numeric * oi.unit_price * fa.f, 2),
         oi.is_gift,
         so.id
    FROM sale_orders so
    JOIN public.order_items oi ON oi.order_id = so.id
    JOIN factors fa            ON fa.order_id = so.id
  UNION ALL
  SELECT rt.store_id,
         ri.variant_id,
         v.product_id,
         rt.d,
         'return',
         -ri.qty,
         -round(ri.qty::numeric * ri.unit_price * COALESCE(fa.f, 1::numeric), 2),
         false,
         rt.id
    FROM rets rt
    JOIN public.return_items ri ON ri.return_id = rt.id
    JOIN public.variants v      ON v.id = ri.variant_id
    LEFT JOIN factors fa        ON fa.order_id = rt.original_order_id;
$$;

COMMENT ON FUNCTION reporting.net_sales_lines(uuid[], date, date) IS
  'INTERNA (schema reporting, sin USAGE para clientes). Definición única de venta neta para los informes: líneas de venta (+) y de devolución (−, con fecha de la devolución) de las tiendas dadas en el rango civil de Bogotá. Regalo = unidades con $0; descuento de orden prorrateado salvo en órdenes de cambio; canceladas fuera.';

REVOKE EXECUTE ON FUNCTION reporting.net_sales_lines(uuid[], date, date) FROM public, anon, authenticated;


-- ============================================================
-- 2. reporting.authorized_store_ids — chequeos [1]..[4] compartidos
-- ============================================================
-- INTERNA. Devuelve las tiendas pedidas deduplicadas, o aborta con un mensaje
-- en español (llega tal cual al toast). Corre dentro de la RPC SECURITY
-- DEFINER, pero auth.uid() sigue siendo el usuario que llamó (sale del JWT).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reporting.authorized_store_ids(p_store_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_id  uuid;
BEGIN
  -- [1] Identidad
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- [2] Permiso
  IF NOT has_permission('reportes.ver') THEN
    RAISE EXCEPTION 'No tenés permiso para ver reportes';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(p_store_ids) AS x
   WHERE x IS NOT NULL;

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'Elegí al menos una tienda';
  END IF;

  IF cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'Demasiadas tiendas en un solo informe';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    -- [3] Vínculo de tienda: una tienda a la que el usuario tiene acceso
    IF NOT EXISTS (SELECT 1 FROM get_my_stores() s WHERE s.store_id = v_id) THEN
      RAISE EXCEPTION 'No tenés acceso a una de las tiendas del informe';
    END IF;

    -- [4] Organización (redundante con [3] hoy; es el límite duro si alguna vez
    -- user_stores admite una tienda de otra org)
    IF NOT is_store_in_my_org(v_id) THEN
      RAISE EXCEPTION 'Una de las tiendas del informe no es de tu organización';
    END IF;
  END LOOP;

  RETURN v_ids;
END;
$$;

COMMENT ON FUNCTION reporting.authorized_store_ids(uuid[]) IS
  'INTERNA. Chequeos [1]..[4] de los informes (identidad, reportes.ver, tienda en get_my_stores(), misma organización). Devuelve las tiendas deduplicadas o aborta.';

REVOKE EXECUTE ON FUNCTION reporting.authorized_store_ids(uuid[]) FROM public, anon, authenticated;


-- ============================================================
-- 3. reporting.category_key — equivalencias de categoría entre tiendas
-- ============================================================
-- Las categorías son por tienda y se tipearon distinto en cada una. La llave
-- de una categoría es su nombre normalizado (normalize_catalog_text:
-- mayúsculas, sin acentos, espacios colapsados) y, SOLO si figura en este MAPA
-- EXPLÍCITO, el nombre canónico al que se une.
--
-- A propósito NO hay heurísticas (plurales, abreviaturas, género por talla):
-- una regla que dependa de los datos cambia sola cuando alguien carga un
-- producto o una categoría nueva, y el número de un mes deja de ser comparable
-- con el del siguiente. Para unir dos categorías nuevas se agrega una línea
-- acá, con su migración.
--
--   'BERMUDA H.' → 'BERMUDA'   (Tebaida "BERMUDA H." = Armenia "BERMUDA": en
--                               prod las 4 de Armenia son de hombre, 28-32)
--   'BLUSAS'     → 'BLUSA'     (Armenia "BLUSAS" = Tebaida "BLUSA")
--   'BUSOS'      → 'BUSO'      (Tebaida "BUSOS"  = Armenia "BUSO")
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reporting.category_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(m.canonical, n.name)
    FROM (SELECT normalize_catalog_text(p_name) AS name) n
    LEFT JOIN (VALUES
      ('BERMUDA H.', 'BERMUDA'),
      ('BLUSAS',     'BLUSA'),
      ('BUSOS',      'BUSO')
    ) AS m(alias, canonical) ON m.alias = n.name;
$$;

COMMENT ON FUNCTION reporting.category_key(text) IS
  'INTERNA. Llave de categoría entre tiendas: normalize_catalog_text + mapa explícito de equivalencias (BERMUDA H.=BERMUDA, BLUSAS=BLUSA, BUSOS=BUSO). Sin heurísticas.';

REVOKE EXECUTE ON FUNCTION reporting.category_key(text) FROM public, anon, authenticated;


-- ============================================================
-- 4. RPC report_sales_by_category — ventas por categoría × talla
-- ============================================================
-- Grano: (tienda, categoría consolidada, talla). Una tienda en p_store_ids =
-- informe de esa tienda; varias = consolidado (el cliente suma las filas de
-- cada tienda por category_key + size, y muestra una columna por tienda).
--
-- Trae ventas del período Y el stock actual: una categoría-talla con stock y
-- sin ventas también aparece (es la mercancía que no se mueve).
--
-- Cubetas de categoría (category_source):
--   'category'  → la categoría del producto, por reporting.category_key (mapa
--                 explícito; sin reglas que dependan de los productos).
--   'inferred'  → producto SIN categoría con size_type pants_women / pants_men:
--                 "DAMA (INFERIDO)" / "HOMBRE (INFERIDO)". Fila propia, NO se
--                 suma a PANTALON DAMA: el dueño ve qué se infirió.
--   'none'      → sin categoría y sin talla que delate el género.
-- from_transfer marca los productos sin categoría que nacieron al recibir un
-- traslado (dest_action = 'create_product', 041): es una fila aparte.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_sales_by_category(
  p_store_ids uuid[],
  p_from      date,
  p_to        date
)
RETURNS TABLE (
  store_id        uuid,
  store_name      text,
  category_key    text,
  category_label  text,
  category_source text,
  from_transfer   boolean,
  category_names  text[],
  size            text,
  units_sold      integer,
  units_returned  integer,
  units_net       integer,
  gift_units      integer,
  amount_net      numeric,
  stock_qty       integer,
  reserved_qty    integer,
  available_qty   integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
BEGIN
  -- [1]..[4]
  v_ids := reporting.authorized_store_ids(p_store_ids);

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'El rango de fechas no es válido';
  END IF;
  IF p_to - p_from > 730 THEN
    RAISE EXCEPTION 'El rango no puede superar los 2 años';
  END IF;

  RETURN QUERY
  WITH
  -- Productos creados al recibir un traslado en alguna de estas tiendas.
  transfer_created AS (
    SELECT DISTINCT ti.to_product_id AS product_id
      FROM public.transfer_items ti
      JOIN public.transfers t ON t.id = ti.transfer_id
     WHERE t.to_store_id = ANY (v_ids)                         -- [5]
       AND ti.dest_action = 'create_product'
       AND ti.to_product_id IS NOT NULL
  ),
  cat_key AS (
    SELECT c.id,
           c.name,
           COALESCE(reporting.category_key(c.name), 'SIN NOMBRE') AS key
      FROM public.categories c
     WHERE c.store_id = ANY (v_ids)                            -- [5]
  ),
  prod_bucket AS (
    SELECT p.id AS product_id,
           CASE
             WHEN ck.id IS NOT NULL               THEN ck.key
             WHEN p.size_type = 'pants_women'     THEN '~INFERIDO DAMA'
             WHEN p.size_type = 'pants_men'       THEN '~INFERIDO HOMBRE'
             ELSE '~SIN CATEGORIA'
           END AS bucket,
           CASE
             WHEN ck.id IS NOT NULL                                     THEN 'category'
             WHEN p.size_type IN ('pants_women', 'pants_men')           THEN 'inferred'
             ELSE 'none'
           END AS source,
           (ck.id IS NULL AND tc.product_id IS NOT NULL) AS from_transfer,
           ck.name AS cat_name
      FROM public.products p
      LEFT JOIN cat_key ck          ON ck.id = p.category_id
      LEFT JOIN transfer_created tc ON tc.product_id = p.id
     WHERE p.store_id = ANY (v_ids)                            -- [5]
  ),
  sales AS (
    SELECT l.store_id,
           l.product_id,
           normalize_catalog_text(v.size) AS sz,
           COALESCE(SUM(l.units)  FILTER (WHERE l.kind <> 'return'), 0) AS sold,
           COALESCE(-SUM(l.units) FILTER (WHERE l.kind =  'return'), 0) AS returned,
           COALESCE(SUM(l.units)  FILTER (WHERE l.is_gift), 0)          AS gift,
           SUM(l.amount) AS amount,
           0::bigint AS stk, 0::bigint AS rsv, 0::bigint AS avail
      FROM reporting.net_sales_lines(v_ids, p_from, p_to) l
      JOIN public.variants v ON v.id = l.variant_id
     GROUP BY l.store_id, l.product_id, normalize_catalog_text(v.size)
  ),
  stock AS (
    SELECT v.store_id,
           v.product_id,
           normalize_catalog_text(v.size) AS sz,
           0::bigint, 0::bigint, 0::bigint, 0::numeric,
           SUM(v.stock_qty)::bigint,
           SUM(v.reserved_qty)::bigint,
           SUM(GREATEST(v.stock_qty - v.reserved_qty, 0))::bigint
      FROM public.variants v
     WHERE v.store_id = ANY (v_ids)                            -- [5]
       AND v.is_active
     GROUP BY v.store_id, v.product_id, normalize_catalog_text(v.size)
  ),
  merged AS (
    SELECT * FROM sales
    UNION ALL
    SELECT * FROM stock
  )
  SELECT m.store_id,
         s.name,
         pb.bucket,
         CASE pb.bucket
           WHEN '~INFERIDO DAMA'   THEN 'DAMA (INFERIDO)'
           WHEN '~INFERIDO HOMBRE' THEN 'HOMBRE (INFERIDO)'
           WHEN '~SIN CATEGORIA'   THEN 'SIN CATEGORÍA'
           ELSE pb.bucket
         END,
         pb.source,
         pb.from_transfer,
         array_remove(array_agg(DISTINCT pb.cat_name), NULL),
         m.sz,
         SUM(m.sold)::integer,
         SUM(m.returned)::integer,
         (SUM(m.sold) - SUM(m.returned))::integer,
         SUM(m.gift)::integer,
         COALESCE(SUM(m.amount), 0),
         SUM(m.stk)::integer,
         SUM(m.rsv)::integer,
         SUM(m.avail)::integer
    FROM merged m
    JOIN prod_bucket pb    ON pb.product_id = m.product_id
    JOIN public.stores s   ON s.id = m.store_id
   GROUP BY m.store_id, s.name, pb.bucket, pb.source, pb.from_transfer, m.sz
   ORDER BY s.name, pb.bucket, m.sz;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_sales_by_category(uuid[], date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.report_sales_by_category(uuid[], date, date) TO authenticated;


-- ============================================================
-- 5. RPC report_variant_performance — desempeño por variante CON período
-- ============================================================
-- Mismas columnas que la vista product_performance (003), pero respetando el
-- rango de fechas y con la definición de venta neta de arriba. ReportsPage la
-- usa para el "Top 10" y la tabla "Variantes por desempeño": con la vista, ambos
-- mostraban el histórico completo aunque el filtro dijera "este mes".
--
-- Solo variantes con movimiento en el período (venta o devolución). La vista
-- product_performance se deja como está (no se borra) para no romper nada que
-- la lea por fuera; ReportsPage deja de usarla.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_variant_performance(
  p_store_ids uuid[],
  p_from      date,
  p_to        date
)
RETURNS TABLE (
  variant_id    uuid,
  product_id    uuid,
  product_name  text,
  brand         text,
  category_name text,
  size          text,
  color         text,
  sku           text,
  barcode       text,
  store_id      uuid,
  units_sold    integer,
  revenue       numeric,
  return_units  integer,
  net_units     integer,
  net_revenue   numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
BEGIN
  -- [1]..[4]
  v_ids := reporting.authorized_store_ids(p_store_ids);

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'El rango de fechas no es válido';
  END IF;
  IF p_to - p_from > 730 THEN
    RAISE EXCEPTION 'El rango no puede superar los 2 años';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT l.variant_id,
           COALESCE(SUM(l.units)   FILTER (WHERE l.kind <> 'return'), 0) AS sold,
           COALESCE(SUM(l.amount)  FILTER (WHERE l.kind <> 'return'), 0) AS rev,
           COALESCE(-SUM(l.units)  FILTER (WHERE l.kind =  'return'), 0) AS ret,
           SUM(l.units)  AS net_u,
           SUM(l.amount) AS net_r
      FROM reporting.net_sales_lines(v_ids, p_from, p_to) l   -- [5] filtra adentro
     GROUP BY l.variant_id
  )
  SELECT v.id,
         v.product_id,
         p.name,
         p.brand,
         c.name,
         v.size,
         v.color,
         v.sku,
         v.barcode,
         v.store_id,
         a.sold::integer,
         a.rev,
         a.ret::integer,
         a.net_u::integer,
         a.net_r
    FROM agg a
    JOIN public.variants v      ON v.id = a.variant_id
    JOIN public.products p      ON p.id = v.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
   ORDER BY a.net_u DESC, a.net_r DESC, p.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_variant_performance(uuid[], date, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.report_variant_performance(uuid[], date, date) TO authenticated;


-- ============================================================
-- AUTOVERIFICACIÓN — aborta (y revierte todo) si algo quedó mal
-- ============================================================
DO $$
BEGIN
  -- Las internas: el schema no se puede ni usar desde el cliente.
  IF has_schema_privilege('authenticated', 'reporting', 'USAGE')
  OR has_schema_privilege('anon',          'reporting', 'USAGE') THEN
    RAISE EXCEPTION 'El schema reporting quedó con USAGE para clientes: sus funciones no validan tiendas.';
  END IF;

  -- Las RPC: molde de la 041 — authenticated sí, anon no.
  IF NOT has_function_privilege('authenticated', 'public.report_sales_by_category(uuid[], date, date)', 'EXECUTE')
  OR NOT has_function_privilege('authenticated', 'public.report_variant_performance(uuid[], date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Las RPC de informes no quedaron ejecutables por authenticated.';
  END IF;
  IF has_function_privilege('anon', 'public.report_sales_by_category(uuid[], date, date)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.report_variant_performance(uuid[], date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Las RPC de informes quedaron ejecutables por anon.';
  END IF;

  -- El mapa explícito, y nada más que el mapa (sin plurales ni abreviaturas).
  IF reporting.category_key('Blusas')     IS DISTINCT FROM 'BLUSA'
  OR reporting.category_key('BLUSA')      IS DISTINCT FROM 'BLUSA'
  OR reporting.category_key('busos')      IS DISTINCT FROM 'BUSO'
  OR reporting.category_key('BERMUDA H.') IS DISTINCT FROM 'BERMUDA'
  OR reporting.category_key('BERMUDA')    IS DISTINCT FROM 'BERMUDA'
  OR reporting.category_key('Pantalón hombre') IS DISTINCT FROM 'PANTALON HOMBRE'
  OR reporting.category_key('GORRAS')     IS DISTINCT FROM 'GORRAS'   -- fuera del mapa: no se singulariza
  OR reporting.category_key('  ') IS NOT NULL THEN
    RAISE EXCEPTION 'reporting.category_key no produce las equivalencias esperadas.';
  END IF;

  RAISE NOTICE '044 OK: venta neta + report_sales_by_category + report_variant_performance.';
END;
$$;


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Tests de la definición de venta neta (fixtures propios, terminan en
--    ROLLBACK — no dejan nada):
--      ./scripts/lab-apply-migration.sh supabase/tests/044_purchase_planning_reports.test.sql
--
-- 2. Paridad con lo que ya muestra la app (lab, como postgres): unidades netas
--    del período = unidades vendidas − devueltas que ve ReportsPage.
--      SELECT kind, SUM(units), SUM(amount)
--        FROM reporting.net_sales_lines(ARRAY(SELECT id FROM stores), '2026-09-01', '2026-09-30')
--       GROUP BY kind;
--
-- 3. Matriz de acceso (desde la app):
--    · Dueño/Administrador con las dos tiendas → "Consolidado" disponible
--    · Vendedor (una tienda)                   → solo su tienda
--    · tienda de otra organización en el array → 'No tenés acceso…'
--    · sin sesión (anon, por REST)             → 42501 permission denied (la base sigue arriba)
--    · usuario sin reportes.ver                → 'No tenés permiso…'
--
--
-- ============================================================
-- REVERSIÓN
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.report_variant_performance(uuid[], date, date);
--   DROP FUNCTION IF EXISTS public.report_sales_by_category(uuid[], date, date);
--   DROP FUNCTION IF EXISTS reporting.category_key(text);
--   DROP FUNCTION IF EXISTS reporting.authorized_store_ids(uuid[]);
--   DROP FUNCTION IF EXISTS reporting.net_sales_lines(uuid[], date, date);
--   DROP SCHEMA  IF EXISTS reporting;
-- COMMIT;
--
-- No toca tablas ni datos. Revertir deja a ReportsPage sin su Top 10 (la RPC
-- falla con toast): hay que revertir también el frontend o volver a
-- product_performance en useReports.
-- ============================================================
