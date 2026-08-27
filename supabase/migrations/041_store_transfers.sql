-- ============================================================
-- 041 — Traslados entre tiendas (2/2): tablas, RLS y RPC
--
-- Diseño completo y justificación: plan/gmura-plan-traslados.md (§2 y §8).
-- Requiere la 040 (movement_type con transfer_out / transfer_in) YA APLICADA.
--
-- ------------------------------------------------------------
-- POR QUÉ ESTA SÍ VA EN UNA TRANSACCIÓN
-- ------------------------------------------------------------
-- Las funciones de acá usan los literales 'transfer_out' / 'transfer_in'. La
-- restricción de PostgreSQL es que un valor de enum no se puede USAR en la
-- MISMA transacción que lo agrega — y ese ADD VALUE commiteó en la 040. Por eso
-- se partieron: acá ya se pueden usar libremente, incluso dentro de BEGIN/COMMIT.
--
-- ------------------------------------------------------------
-- EL MODELO, EN TRES FRASES
-- ------------------------------------------------------------
-- 1. Cada tienda tiene su PROPIO catálogo (products.store_id y variants.store_id
--    son NOT NULL). Un traslado mueve entre DOS filas de variantes distintas, y
--    la del destino muchas veces hay que crearla.
-- 2. El stock SALE del origen al despachar y ENTRA al destino al recibir. En el
--    medio no vive en ningún variants: el tránsito es transfer_items. Así la
--    mercancía no es vendible en NINGUNA de las dos tiendas mientras viaja.
-- 3. get_my_store_id() devuelve UNA tienda, así que el cliente NO PUEDE escribir
--    en la tienda destino. Toda la escritura pasa por las RPC SECURITY DEFINER
--    de este archivo; las tablas solo tienen política de SELECT.
--
-- ------------------------------------------------------------
-- LOS 5 CHEQUEOS QUE CADA RPC DE ESCRITURA REIMPLEMENTA
-- ------------------------------------------------------------
-- SECURITY DEFINER apaga el RLS: todo lo que garantizaría una política hay que
-- volver a hacerlo adentro. En orden, y comentados como [1]..[5] en el código:
--   [1] Identidad          → auth.uid() no nulo
--   [2] Permiso            → has_permission('traslados.gestionar')
--   [3] Vínculo de tienda  → get_my_store_id() / get_my_stores()
--   [4] Organización       → is_store_in_my_org() sobre AMBAS tiendas
--   [5] Pertenencia de la fila → el que más fácil se olvida: dentro de SECURITY
--       DEFINER, "SELECT * FROM transfers WHERE id = p_id" encuentra CUALQUIER
--       traslado de la base, incluido el de otra organización. Sin [5], pasar un
--       UUID ajeno bastaría para operarlo.
--
-- Mensajes de error en español: llegan tal cual al toast del cliente.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. normalize_catalog_text — la llave de comparación entre catálogos
-- ============================================================
-- Recorta, saca acentos, pasa a mayúsculas y colapsa espacios internos.
-- NULL y '' se vuelven ambos NULL, para que "sin marca" sea comparable.
--
-- translate() y no unaccent: la única extensión instalada es uuid-ossp (001) y
-- agregar una a producción para esto no se paga.
--
-- Medido sobre los datos reales de las dos tiendas: sin normalizar, el módulo
-- sugeriría 5 coincidencias cruzadas; normalizando, 15 (DOMINA/domina,
-- CHAMBER/Chamber, DEYLEID/Deyleid, NAVI/Navi, STIL/Stil).
--
-- IMMUTABLE para poder indexar por ella. A propósito SIN "SET search_path": solo
-- referencia builtins de pg_catalog (no hay superficie de ataque por search_path)
-- y el SET impediría que el planner la inline en las consultas del índice.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_catalog_text(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(
      upper(translate(btrim(coalesce(p, '')),
                      'áéíóúüñÁÉÍÓÚÜÑ',
                      'aeiouunAEIOUUN')),
      '\s+', ' ', 'g'),
    '');
$$;

COMMENT ON FUNCTION public.normalize_catalog_text(text) IS
  'Llave de comparación de catálogo entre tiendas (traslados): trim + sin acentos + mayúsculas + espacios colapsados; NULL/vacío → NULL. IMMUTABLE para indexar.';

-- Índice de apoyo para el match de productos del destino.
CREATE INDEX IF NOT EXISTS idx_products_catalog_match
  ON public.products (store_id,
                      normalize_catalog_text(name),
                      normalize_catalog_text(brand));


-- ============================================================
-- 2. TABLAS
-- ============================================================

-- ------------------------------------------------------------
-- transfers — la cabecera del traslado
-- ------------------------------------------------------------
CREATE TABLE public.transfers (
  id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number      integer     NOT NULL,
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_store_id        uuid        NOT NULL REFERENCES public.stores(id)        ON DELETE RESTRICT,
  to_store_id          uuid        NOT NULL REFERENCES public.stores(id)        ON DELETE RESTRICT,
  status               text        NOT NULL DEFAULT 'draft',
  carrier              text,
  tracking_ref         text,
  notes                text,

  created_by           uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  dispatched_by        uuid        REFERENCES public.profiles(id) ON DELETE RESTRICT,
  dispatched_at        timestamptz,

  received_by          uuid        REFERENCES public.profiles(id) ON DELETE RESTRICT,
  received_at          timestamptz,
  received_by_store_id uuid        REFERENCES public.stores(id)   ON DELETE RESTRICT,

  cancelled_by         uuid        REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_at         timestamptz,
  cancel_reason        text,

  -- text + CHECK y no ENUM: mismo criterio que cash_expenses.kind (017) y
  -- cash_expenses.payment_method (037). Agregar 'received_with_differences'
  -- cuando llegue el conteo será una línea, no un ALTER TYPE.
  CONSTRAINT transfers_status_check
    CHECK (status IN ('draft', 'in_transit', 'received', 'cancelled')),
  CONSTRAINT transfers_distinct_stores
    CHECK (from_store_id <> to_store_id)
);

COMMENT ON TABLE public.transfers IS
  'Traslados de mercancía entre tiendas de una misma organización. El stock sale del origen al despachar y entra al destino al recibir; mientras viaja no vive en ningún variants (no vendible en ninguna de las dos).';
COMMENT ON COLUMN public.transfers.organization_id IS
  'Desnormalizada desde from_store_id: la numeración es por organización y el índice único la necesita en la fila. La escribe siempre el servidor.';
COMMENT ON COLUMN public.transfers.received_by_store_id IS
  'Tienda ACTIVA de quien confirmó la recepción. Dato crudo, no interpretación: la UI deriva "confirmado por el destino / por el ORIGEN / por administración". Importa si después falta mercancía.';

-- Numeración por organización.
CREATE UNIQUE INDEX uq_transfers_org_number
  ON public.transfers (organization_id, transfer_number);

-- Las dos listas de la UI: "mis envíos" y "por recibir".
CREATE INDEX idx_transfers_from_store ON public.transfers (from_store_id, status, created_at DESC);
CREATE INDEX idx_transfers_to_store   ON public.transfers (to_store_id,   status, created_at DESC);


-- ------------------------------------------------------------
-- transfer_items — las líneas, con el snapshot
-- ------------------------------------------------------------
CREATE TABLE public.transfer_items (
  id              uuid    PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_id     uuid    NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  from_variant_id uuid    NOT NULL REFERENCES public.variants(id)  ON DELETE RESTRICT,

  -- Lo que ELIGIÓ quien envía (al armar) y lo que EFECTIVAMENTE pasó (al recibir).
  -- Separadas para que el re-chequeo del destino sea auditable y no magia.
  dest_action     text    NOT NULL,
  to_product_id   uuid    REFERENCES public.products(id) ON DELETE RESTRICT,
  to_variant_id   uuid    REFERENCES public.variants(id) ON DELETE RESTRICT,
  dest_resolution text,

  qty_sent        integer NOT NULL,
  qty_received    integer,

  -- Snapshot: sin él el DESTINO no puede ni listar lo que le mandaron, porque el
  -- RLS le tapa las variantes del origen. Lo copia el servidor, nunca el cliente.
  product_name    text    NOT NULL,
  brand           text,
  description     text,
  size_type       text,
  size            text,
  color           text,
  unit_cost       numeric(12,2),
  unit_price      numeric(12,2) NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transfer_items_dest_action_check
    CHECK (dest_action IN ('map_variant', 'map_product', 'create_product')),
  CONSTRAINT transfer_items_dest_resolution_check
    CHECK (dest_resolution IS NULL OR dest_resolution IN ('as_chosen', 'auto_matched')),
  CONSTRAINT transfer_items_qty_sent_positive
    CHECK (qty_sent > 0),
  CONSTRAINT transfer_items_qty_received_check
    CHECK (qty_received IS NULL OR qty_received >= 0),
  CONSTRAINT transfer_items_map_variant_target
    CHECK (dest_action <> 'map_variant' OR to_variant_id IS NOT NULL),
  -- Una línea por variante de origen: mandar 5 unidades es qty_sent = 5, no dos
  -- líneas. Mantiene simple la contabilidad del FOR UPDATE en el despacho.
  CONSTRAINT transfer_items_unique_variant
    UNIQUE (transfer_id, from_variant_id)
);

COMMENT ON TABLE public.transfer_items IS
  'Líneas de un traslado. El snapshot permite al destino ver qué le mandaron sin poder leer el catálogo del origen (RLS).';
COMMENT ON COLUMN public.transfer_items.dest_action IS
  'Elección de quien ENVÍA: map_variant (la variante existe en destino), map_product (existe el producto, falta la talla/color), create_product (no hay nada parecido).';
COMMENT ON COLUMN public.transfer_items.dest_resolution IS
  'Qué pasó al RECIBIR: as_chosen (se hizo lo elegido) o auto_matched (apareció un gemelo mientras viajaba y se mapeó en vez de duplicar). NULL mientras no se recibe.';
COMMENT ON COLUMN public.transfer_items.qty_received IS
  'NULL = recibido SIN contar (recepción simple). Se llena cuando exista el conteo por línea; entonces "qty_received IS NOT NULL" significa "esto se contó", retroactivamente correcto.';
COMMENT ON COLUMN public.transfer_items.unit_cost IS
  'Costo del ORIGEN. Solo se usa si la recepción CREA la variante destino; si mapea a una existente, su cost_price NO se toca (un traslado mueve mercancía, no la compra).';

CREATE INDEX idx_transfer_items_transfer ON public.transfer_items (transfer_id);
CREATE INDEX idx_transfer_items_from_var ON public.transfer_items (from_variant_id);
CREATE INDEX idx_transfer_items_to_var   ON public.transfer_items (to_variant_id) WHERE to_variant_id IS NOT NULL;

-- La coherencia restante (que tras recibir queden llenos to_product_id,
-- to_variant_id y dest_resolution) NO va como CHECK: tendría que distinguir
-- antes/después de la recepción. La garantiza la RPC, único escritor posible.


-- ============================================================
-- 3. TRIGGERS
-- ============================================================

-- ------------------------------------------------------------
-- assign_transfer_number — secuencial POR ORGANIZACIÓN
-- ------------------------------------------------------------
-- Molde: assign_order_number (005), con advisory lock que se sostiene hasta el
-- commit para serializar dos traslados simultáneos de la misma organización.
--
-- ⚠️ SECURITY DEFINER ES OBLIGATORIO ACÁ, y esto NO aplicaba en orders:
--    el RLS de transfers solo deja ver las filas donde MI tienda es origen o
--    destino. Con los permisos del usuario, un traslado entre otras dos tiendas
--    de la misma organización sería invisible → el MAX() daría bajo → violación
--    de uq_transfers_org_number. En orders no se nota porque la numeración y el
--    RLS usan la misma llave (la tienda).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_transfer_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('transfers_seq_' || NEW.organization_id::text));

  SELECT COALESCE(MAX(transfer_number), 0) + 1
    INTO v_next
    FROM public.transfers
   WHERE organization_id = NEW.organization_id;

  NEW.transfer_number := v_next;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_transfer_number
  BEFORE INSERT ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.assign_transfer_number();


-- ------------------------------------------------------------
-- enforce_transfer_org — defensa en profundidad
-- ------------------------------------------------------------
-- Redundante mientras las RPC sean el único escritor (no hay política de INSERT
-- ni GRANT de escritura). Va igual, con el mismo criterio que
-- enforce_profile_store_org (022/025): que la BD no dependa de que la capa de
-- arriba esté bien escrita.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_transfer_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_org uuid;
  v_to_org   uuid;
BEGIN
  SELECT organization_id INTO v_from_org FROM public.stores WHERE id = NEW.from_store_id;
  SELECT organization_id INTO v_to_org   FROM public.stores WHERE id = NEW.to_store_id;

  IF v_from_org IS NULL OR v_to_org IS NULL THEN
    RAISE EXCEPTION 'Alguna de las tiendas del traslado no tiene organización asignada';
  END IF;

  IF v_from_org <> v_to_org THEN
    RAISE EXCEPTION 'Un traslado no puede cruzar organizaciones';
  END IF;

  IF NEW.organization_id <> v_from_org THEN
    RAISE EXCEPTION 'La organización del traslado no coincide con la de sus tiendas';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_transfer_org
  BEFORE INSERT OR UPDATE OF from_store_id, to_store_id, organization_id
  ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_transfer_org();


-- ============================================================
-- 4. RLS — SOLO LECTURA
-- ============================================================
-- Ni una política de INSERT / UPDATE / DELETE: la escritura queda DENEGADA por
-- ausencia, igual que hoy están order_items y return_items para UPDATE/DELETE.
-- Todo pasa por las RPC.
--
-- La lectura NO lleva permiso extra, siguiendo el criterio explícito de la 024
-- (lectura libre en lo operativo dentro de la tienda): un vendedor VE que viene
-- un traslado aunque no pueda confirmarlo.
-- ------------------------------------------------------------
ALTER TABLE public.transfers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;

-- PRINCIPIO: la visibilidad tiene que ser un SUPERCONJUNTO de la capacidad,
-- nunca al revés. receive_transfer acepta a quien tenga la tienda destino entre
-- las suyas (get_my_stores()), aunque esté parado en otra; si el SELECT usara
-- solo get_my_store_id(), ese dueño podría confirmar un traslado que NO VE en
-- ninguna lista. Por eso la política usa el mismo criterio, y simétrico en las
-- dos puntas: veo un traslado si CUALQUIERA de sus dos tiendas es mía.
--
-- Las dos comparaciones baratas van primero a propósito: cubren el caso común
-- (vendedor, admin de una sola tienda) sin llegar a evaluar la función.
CREATE POLICY transfers_select ON public.transfers FOR SELECT
  USING (
       from_store_id = get_my_store_id()
    OR to_store_id   = get_my_store_id()
    OR EXISTS (
         SELECT 1 FROM get_my_stores() gs
          WHERE gs.store_id = transfers.from_store_id
             OR gs.store_id = transfers.to_store_id
       )
  );

-- La condición se repite explícita en vez de apoyarse en que el RLS de transfers
-- filtre la subconsulta: más largo, pero se lee sin tener que razonar sobre RLS
-- anidado.
CREATE POLICY transfer_items_select ON public.transfer_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.transfers t
     WHERE t.id = transfer_items.transfer_id
       AND (
            t.from_store_id = get_my_store_id()
         OR t.to_store_id   = get_my_store_id()
         OR EXISTS (
              SELECT 1 FROM get_my_stores() gs
               WHERE gs.store_id = t.from_store_id
                  OR gs.store_id = t.to_store_id
            )
       )
  ));

-- Privilegios ADEMÁS del RLS: aunque alguien agregara una política de escritura
-- por error, sin el GRANT no se puede escribir.
REVOKE ALL ON public.transfers      FROM anon, authenticated;
REVOKE ALL ON public.transfer_items FROM anon, authenticated;
GRANT SELECT ON public.transfers      TO authenticated;
GRANT SELECT ON public.transfer_items TO authenticated;


-- ============================================================
-- 5. HELPERS INTERNOS (no expuestos al cliente)
-- ============================================================

-- ------------------------------------------------------------
-- transfer_payload — la forma que devuelven las RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_payload(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT to_jsonb(t) || jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('to_barcode', v.barcode)
                       ORDER BY i.created_at, i.id)
        FROM public.transfer_items i
        LEFT JOIN public.variants v ON v.id = i.to_variant_id
       WHERE i.transfer_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.transfers t
  WHERE t.id = p_transfer_id;
$$;

COMMENT ON FUNCTION public.transfer_payload(uuid) IS
  'Cabecera + líneas de un traslado. to_barcode viaja porque la recepción necesita los códigos nuevos para "Imprimir etiquetas de lo recibido" (la etiqueta que viajó pegada a la prenda NO escanea en el destino).';

-- Interna: solo la llaman las RPC de abajo, que ya validaron el acceso.
REVOKE ALL ON FUNCTION public.transfer_payload(uuid) FROM public, anon, authenticated;


-- ------------------------------------------------------------
-- generate_free_barcode — 12 dígitos libres contra el UNIQUE global
-- ------------------------------------------------------------
-- variants_barcode_unique es GLOBAL, así que una variante creada en el destino
-- no puede reusar el código del origen: nace con el suyo. Mismo formato que los
-- 1.793 existentes (12 dígitos, primer dígito 1-9).
-- El bucle evita que una colisión al azar haga fallar una recepción entera.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_free_barcode()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_try  integer := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_code := (floor(random() * 900000000000)::bigint + 100000000000)::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.variants WHERE barcode = v_code);
    IF v_try >= 20 THEN
      RAISE EXCEPTION 'No se pudo generar un código de barras libre';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_free_barcode() FROM public, anon, authenticated;


-- ============================================================
-- 6. RPC 1 — save_transfer_draft (crear o editar el borrador)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_transfer_draft(
  p_to_store_id  uuid,
  p_items        jsonb,
  p_transfer_id  uuid DEFAULT NULL,
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
  v_uid           uuid;
  v_from          uuid;
  v_org           uuid;
  v_id            uuid;
  v_item          jsonb;
  v_needs_catalog boolean;
  v_n_items       integer;
  v_n_distinct    integer;
  v_action        text;
  v_qty           integer;
  v_var           record;
  v_to_product    uuid;
  v_to_variant    uuid;
  v_found_variant uuid;
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

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El traslado no tiene ítems';
  END IF;

  -- [2b] Permiso de catálogo: se pide DONDE ESTÁ LA DECISIÓN (al armar), no
  --      donde está la ejecución (al recibir). Las dos acciones que van a crear
  --      catálogo son create_product (una ficha nueva) y map_product (una talla
  --      o color nuevos dentro de una ficha existente).
  SELECT bool_or(it->>'dest_action' IN ('create_product', 'map_product'))
    INTO v_needs_catalog
    FROM jsonb_array_elements(p_items) it;

  IF COALESCE(v_needs_catalog, false) AND NOT has_permission('productos.gestionar') THEN
    RAISE EXCEPTION 'Para crear productos o tallas en la tienda destino necesitás el permiso de gestionar productos';
  END IF;

  -- [3] Vínculo de tienda: el origen es SIEMPRE la tienda activa. No existe
  --     "armar un traslado entre otras dos tiendas".
  v_from := get_my_store_id();
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'No hay tienda activa';
  END IF;

  IF p_to_store_id IS NULL OR p_to_store_id = v_from THEN
    RAISE EXCEPTION 'El destino debe ser una tienda distinta a la actual';
  END IF;

  -- [4] Organización (ambas tiendas)
  IF NOT is_store_in_my_org(v_from) THEN
    RAISE EXCEPTION 'Tu tienda activa no pertenece a tu organización';
  END IF;
  IF NOT is_store_in_my_org(p_to_store_id) THEN
    RAISE EXCEPTION 'La tienda destino no pertenece a tu organización';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_to_store_id AND is_active) THEN
    RAISE EXCEPTION 'La tienda destino está inactiva';
  END IF;

  v_org := get_my_organization_id();

  -- Sin from_variant_id repetidos (el UNIQUE lo atraparía, pero con un mensaje
  -- que no le sirve a nadie).
  SELECT count(*), count(DISTINCT it->>'from_variant_id')
    INTO v_n_items, v_n_distinct
    FROM jsonb_array_elements(p_items) it;
  IF v_n_items <> v_n_distinct THEN
    RAISE EXCEPTION 'Hay una variante repetida: usá una sola línea con la cantidad total';
  END IF;

  -- ── Cabecera: crear o editar ──────────────────────────────────────────────
  IF p_transfer_id IS NULL THEN
    INSERT INTO public.transfers
      (organization_id, from_store_id, to_store_id, status,
       carrier, tracking_ref, notes, created_by)
    VALUES
      (v_org, v_from, p_to_store_id, 'draft',
       NULLIF(btrim(coalesce(p_carrier, '')), ''),
       NULLIF(btrim(coalesce(p_tracking_ref, '')), ''),
       NULLIF(btrim(coalesce(p_notes, '')), ''),
       v_uid)
    RETURNING id INTO v_id;
  ELSE
    -- [5] Pertenencia de la fila: dentro de SECURITY DEFINER este SELECT
    --     encuentra CUALQUIER traslado de la base. Sin los chequeos de abajo,
    --     un UUID ajeno sería suficiente para editarlo.
    PERFORM 1 FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El traslado no existe';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.transfers
       WHERE id = p_transfer_id AND from_store_id = v_from
    ) THEN
      RAISE EXCEPTION 'Solo la tienda de origen puede editar este traslado';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.transfers
       WHERE id = p_transfer_id AND status = 'draft'
    ) THEN
      RAISE EXCEPTION 'Solo se puede editar un traslado en borrador';
    END IF;

    UPDATE public.transfers
       SET to_store_id  = p_to_store_id,
           carrier      = NULLIF(btrim(coalesce(p_carrier, '')), ''),
           tracking_ref = NULLIF(btrim(coalesce(p_tracking_ref, '')), ''),
           notes        = NULLIF(btrim(coalesce(p_notes, '')), ''),
           updated_at   = now()
     WHERE id = p_transfer_id;

    -- La edición REEMPLAZA el conjunto de líneas entero. Eso resuelve de paso
    -- el cambio de tienda destino: los mapeos viejos se van con las líneas.
    DELETE FROM public.transfer_items WHERE transfer_id = p_transfer_id;
    v_id := p_transfer_id;
  END IF;

  -- ── Líneas ────────────────────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_action := v_item->>'dest_action';
    v_qty    := (v_item->>'qty')::integer;

    IF v_action IS NULL OR v_action NOT IN ('map_variant', 'map_product', 'create_product') THEN
      RAISE EXCEPTION 'Acción de destino inválida en una de las líneas';
    END IF;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    -- El snapshot lo lee el SERVIDOR desde el origen; el cliente solo manda ids
    -- y cantidades, así que no puede escribir un snapshot engañoso.
    SELECT v.id, v.product_id, v.size, v.color, v.price, v.cost_price,
           p.name AS product_name, p.brand, p.description, p.size_type
      INTO v_var
      FROM public.variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE v.id = (v_item->>'from_variant_id')::uuid
       AND v.store_id = v_from
       AND v.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una de las variantes no es de tu tienda o está inactiva';
    END IF;

    v_to_product := NULLIF(v_item->>'to_product_id', '')::uuid;
    v_to_variant := NULLIF(v_item->>'to_variant_id', '')::uuid;

    IF v_action = 'map_variant' THEN
      IF v_to_variant IS NULL THEN
        RAISE EXCEPTION 'Falta la variante destino en una línea mapeada';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.variants
         WHERE id = v_to_variant AND store_id = p_to_store_id
      ) THEN
        RAISE EXCEPTION 'La variante destino no pertenece a la tienda destino';
      END IF;
      SELECT product_id INTO v_to_product FROM public.variants WHERE id = v_to_variant;

    ELSIF v_action = 'map_product' THEN
      IF v_to_product IS NULL THEN
        RAISE EXCEPTION 'Falta el producto destino en una línea mapeada';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.products
         WHERE id = v_to_product AND store_id = p_to_store_id
      ) THEN
        RAISE EXCEPTION 'El producto destino no pertenece a la tienda destino';
      END IF;

      -- Si esa talla/color YA existe en ese producto, esto en realidad es un
      -- map_variant. Se guarda como tal: el borrador queda mostrando a qué
      -- variante va, en vez de llegar a la recepción con una intención imposible.
      -- IS NOT DISTINCT FROM y no =: talla y color son nullable, y NULL = NULL
      -- es NULL (no true) — con = nunca matchearían dos variantes sin color.
      SELECT id INTO v_found_variant
        FROM public.variants
       WHERE product_id = v_to_product
         AND normalize_catalog_text(size)  IS NOT DISTINCT FROM normalize_catalog_text(v_var.size)
         AND normalize_catalog_text(color) IS NOT DISTINCT FROM normalize_catalog_text(v_var.color)
       LIMIT 1;

      IF v_found_variant IS NOT NULL THEN
        v_action     := 'map_variant';
        v_to_variant := v_found_variant;
      ELSE
        v_to_variant := NULL;
      END IF;

    ELSE  -- create_product
      IF v_to_product IS NOT NULL OR v_to_variant IS NOT NULL THEN
        RAISE EXCEPTION 'Una línea nueva no lleva destino elegido';
      END IF;
    END IF;

    INSERT INTO public.transfer_items
      (transfer_id, from_variant_id, dest_action, to_product_id, to_variant_id,
       qty_sent, product_name, brand, description, size_type, size, color,
       unit_cost, unit_price)
    VALUES
      (v_id, v_var.id, v_action, v_to_product, v_to_variant,
       v_qty, v_var.product_name, v_var.brand, v_var.description, v_var.size_type,
       v_var.size, v_var.color, v_var.cost_price, v_var.price);
  END LOOP;

  -- NO se valida stock acá a propósito: un borrador no comprueba ni reserva
  -- nada. El stock se valida (y se lockea) en dispatch_transfer.
  RETURN transfer_payload(v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_transfer_draft(uuid, jsonb, uuid, text, text, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.save_transfer_draft(uuid, jsonb, uuid, text, text, text) TO authenticated;


-- ============================================================
-- 7. RPC 2 — dispatch_transfer (descuenta del origen → en tránsito)
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid;
  v_t         record;
  v_it        record;
  v_var       record;
  v_available integer;
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

  -- El header se lockea SIEMPRE PRIMERO: es lo que serializa las transiciones de
  -- estado (dos despachos, o un despacho contra una reversión).
  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo de tienda.
  -- Solo el ORIGEN despacha, sin excepción de admin: despachar es meter la
  -- mercancía en una caja, y eso lo hace quien la tiene. (La recepción sí admite
  -- excepción porque en el destino puede no haber nadie con permiso.)
  IF v_t.from_store_id <> get_my_store_id() THEN
    RAISE EXCEPTION 'Solo la tienda de origen puede despachar este traslado';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  IF v_t.status <> 'draft' THEN
    RAISE EXCEPTION 'El traslado ya fue despachado o no está en borrador';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.transfer_items WHERE transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'El traslado no tiene ítems';
  END IF;

  -- ORDER BY from_variant_id: NO es cosmético. Dos despachos concurrentes que
  -- compartan variantes tomarían los locks en orden distinto y se deadlockearían.
  FOR v_it IN
    SELECT * FROM public.transfer_items
     WHERE transfer_id = p_transfer_id
     ORDER BY from_variant_id
  LOOP
    SELECT id, stock_qty, reserved_qty, store_id, is_active
      INTO v_var
      FROM public.variants
     WHERE id = v_it.from_variant_id
     FOR UPDATE;

    IF NOT FOUND OR v_var.store_id <> v_t.from_store_id OR NOT v_var.is_active THEN
      RAISE EXCEPTION 'La variante "%" ya no pertenece a la tienda o está inactiva', v_it.product_name;
    END IF;

    -- Disponible = stock - reservado. MISMA regla que la 038 le va a imponer a
    -- las ventas: lo apartado para un separado es intocable, y un traslado
    -- tampoco puede llevárselo.
    v_available := v_var.stock_qty - v_var.reserved_qty;
    IF v_it.qty_sent > v_available THEN
      RAISE EXCEPTION 'Stock insuficiente para "%" (% / %): disponible %, requerido %',
        v_it.product_name, COALESCE(v_it.size, '-'), COALESCE(v_it.color, '-'),
        v_available, v_it.qty_sent;
    END IF;

    -- El destino elegido tiene que seguir siendo del destino.
    IF v_it.to_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.variants
       WHERE id = v_it.to_variant_id AND store_id = v_t.to_store_id
    ) THEN
      RAISE EXCEPTION 'El destino elegido para "%" ya no pertenece a la tienda destino', v_it.product_name;
    END IF;
    IF v_it.to_variant_id IS NULL AND v_it.to_product_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE id = v_it.to_product_id AND store_id = v_t.to_store_id
    ) THEN
      RAISE EXCEPTION 'El producto destino elegido para "%" ya no pertenece a la tienda destino', v_it.product_name;
    END IF;

    UPDATE public.variants
       SET stock_qty  = stock_qty - v_it.qty_sent,
           updated_at = now()
     WHERE id = v_it.from_variant_id;

    INSERT INTO public.stock_movements
      (variant_id, store_id, type, qty, reference_id, notes, created_by)
    VALUES
      (v_it.from_variant_id, v_t.from_store_id, 'transfer_out', -v_it.qty_sent,
       p_transfer_id, 'Traslado #' || v_t.transfer_number || ' — salida', v_uid);
  END LOOP;

  -- Guard de transición: redundante con el chequeo de status de arriba (ya
  -- tenemos el lock del header), y va igual — es la aserción que documenta la
  -- transición y la que atrapa cualquier camino que se agregue después.
  UPDATE public.transfers
     SET status        = 'in_transit',
         dispatched_by = v_uid,
         dispatched_at = now(),
         updated_at    = now()
   WHERE id = p_transfer_id
     AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado durante el despacho; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispatch_transfer(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.dispatch_transfer(uuid) TO authenticated;


-- ============================================================
-- 8. RPC 3 — revert_transfer_dispatch (el stock vuelve al origen)
-- ============================================================
CREATE OR REPLACE FUNCTION public.revert_transfer_dispatch(
  p_transfer_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_t   record;
  v_it  record;
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

  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Indicá el motivo de la reversión (al menos 5 caracteres)';
  END IF;

  -- Header primero. Es LA pieza que hace segura la carrera más importante del
  -- módulo: el origen revirtiendo mientras el destino confirma. Las dos
  -- funciones lockean esta misma fila antes de tocar stock, así que se
  -- serializan; la que commitea primero gana y la otra falla con un mensaje
  -- claro. Nunca se mueve el stock dos veces ni en dos direcciones.
  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo: solo el origen, porque el stock
  -- vuelve ahí y quien revierte debería tener la caja de vuelta en la mano.
  IF v_t.from_store_id <> get_my_store_id() THEN
    RAISE EXCEPTION 'Solo la tienda de origen puede revertir el despacho';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  -- Que el estado sea in_transit ya garantiza que nadie lo recibió.
  IF v_t.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Solo se puede revertir un traslado en tránsito';
  END IF;

  FOR v_it IN
    SELECT * FROM public.transfer_items
     WHERE transfer_id = p_transfer_id
     ORDER BY from_variant_id          -- mismo orden de locks que el despacho
  LOOP
    PERFORM 1 FROM public.variants WHERE id = v_it.from_variant_id FOR UPDATE;

    -- Si la variante de origen se desactivó mientras tanto, se REACTIVA: volvió
    -- mercancía física, y stock que no se puede vender es peor.
    UPDATE public.variants
       SET stock_qty  = stock_qty + v_it.qty_sent,
           is_active  = true,
           updated_at = now()
     WHERE id = v_it.from_variant_id;

    -- transfer_in en la tienda de ORIGEN: el store_id del movimiento es lo que
    -- distingue esta entrada de la de una recepción normal.
    INSERT INTO public.stock_movements
      (variant_id, store_id, type, qty, reference_id, notes, created_by)
    VALUES
      (v_it.from_variant_id, v_t.from_store_id, 'transfer_in', v_it.qty_sent,
       p_transfer_id, 'Traslado #' || v_t.transfer_number || ' — reversa de despacho', v_uid);
  END LOOP;

  UPDATE public.transfers
     SET status        = 'cancelled',
         cancelled_by  = v_uid,
         cancelled_at  = now(),
         cancel_reason = btrim(p_reason),
         updated_at    = now()
   WHERE id = p_transfer_id
     AND status = 'in_transit';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado durante la reversión; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revert_transfer_dispatch(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.revert_transfer_dispatch(uuid, text) TO authenticated;


-- ============================================================
-- 9. RPC 4 — receive_transfer (la compleja)
-- ============================================================
-- p_counts existe DESDE EL DÍA 1 con su forma final para que la fase de conteo
-- no tenga que cambiar la firma. Hoy se RECHAZA si viene con algo: reservar el
-- parámetro sin fingir que se honra es más honesto que ignorarlo en silencio.
-- ============================================================
CREATE OR REPLACE FUNCTION public.receive_transfer(
  p_transfer_id uuid,
  p_counts      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid;
  v_t          record;
  v_it         record;
  v_n_name     text;
  v_n_brand    text;
  v_n_size     text;
  v_n_color    text;
  v_target_var uuid;
  v_target_pro uuid;
  v_res        text;
  v_cnt        integer;
  v_maybe      uuid;
BEGIN
  -- [1] Identidad
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_counts IS NOT NULL THEN
    RAISE EXCEPTION 'El conteo por línea todavía no está disponible: la recepción confirma las cantidades enviadas';
  END IF;

  -- [2] Permiso
  IF NOT has_permission('traslados.gestionar') THEN
    RAISE EXCEPTION 'No tenés permiso para gestionar traslados';
  END IF;

  -- Header primero (ver el comentario de revert_transfer_dispatch).
  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo de tienda, con la regla AMPLIADA:
  -- recibe normalmente el destino, pero también el ORIGEN o alguien que tenga la
  -- tienda destino entre las suyas (caso "en esa sede no hay nadie con permiso
  -- ahora"). get_my_stores() (013) evita reimplementar user_stores ∪ store base,
  -- y permite a un dueño confirmar SIN cambiar de tienda con el switcher.
  -- El permiso habilita la acción; el vínculo la acota.
  IF NOT (
       get_my_store_id() IN (v_t.from_store_id, v_t.to_store_id)
    OR EXISTS (SELECT 1 FROM get_my_stores() gs WHERE gs.store_id = v_t.to_store_id)
  ) THEN
    RAISE EXCEPTION 'No podés confirmar este traslado';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  IF v_t.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Solo se puede recibir un traslado en tránsito';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_t.to_store_id AND is_active) THEN
    RAISE EXCEPTION 'La tienda destino está inactiva';
  END IF;

  FOR v_it IN
    SELECT * FROM public.transfer_items
     WHERE transfer_id = p_transfer_id
     ORDER BY id
  LOOP
    v_n_name  := normalize_catalog_text(v_it.product_name);
    v_n_brand := normalize_catalog_text(v_it.brand);
    v_n_size  := normalize_catalog_text(v_it.size);
    v_n_color := normalize_catalog_text(v_it.color);

    v_target_var := NULL;
    v_target_pro := NULL;
    v_res        := NULL;

    -- ── A) map_variant: usar la elegida si sigue siendo del destino ─────────
    IF v_it.dest_action = 'map_variant' THEN
      SELECT id, product_id INTO v_target_var, v_target_pro
        FROM public.variants
       WHERE id = v_it.to_variant_id
         AND store_id = v_t.to_store_id
       FOR UPDATE;
      IF FOUND THEN
        v_res := 'as_chosen';
      ELSE
        -- Inalcanzable desde la app (to_variant_id tiene ON DELETE RESTRICT y no
        -- hay ninguna pantalla que mueva una variante de tienda). Si se llegara
        -- acá, cae al re-match de C y queda marcado auto_matched.
        v_target_var := NULL;
        v_target_pro := NULL;
      END IF;
    END IF;

    -- ── B) map_product: la ficha elegida (la variante se resuelve más abajo) ─
    IF v_target_var IS NULL AND v_it.dest_action = 'map_product' AND v_it.to_product_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.products WHERE id = v_it.to_product_id AND store_id = v_t.to_store_id) THEN
        v_target_pro := v_it.to_product_id;
        v_res        := 'as_chosen';   -- salvo que el guard de abajo encuentre una
      END IF;
    END IF;

    -- ── C) create_product (o los caminos caídos): buscar el gemelo ──────────
    IF v_target_var IS NULL AND v_target_pro IS NULL THEN
      -- C1) ¿Existe EXACTAMENTE UNA variante gemela (nombre+marca+talla+color)?
      -- IS NOT DISTINCT FROM en los cuatro: marca, talla y color son nullable y
      -- con = los productos sin marca nunca matchearían con su gemelo sin marca.
      -- (array_agg(...))[1] y NO min(v.id): PostgreSQL no tiene min() para uuid.
      -- Con ORDER BY dentro del agregado el candidato es determinista, y el
      -- predicado queda escrito UNA sola vez (en vez de duplicarlo en una
      -- consulta para el count y otra para el id).
      SELECT count(*), (array_agg(v.id ORDER BY v.id))[1]
        INTO v_cnt, v_maybe
        FROM public.variants v
        JOIN public.products p ON p.id = v.product_id
       WHERE p.store_id = v_t.to_store_id
         AND normalize_catalog_text(p.name)  IS NOT DISTINCT FROM v_n_name
         AND normalize_catalog_text(p.brand) IS NOT DISTINCT FROM v_n_brand
         AND normalize_catalog_text(v.size)  IS NOT DISTINCT FROM v_n_size
         AND normalize_catalog_text(v.color) IS NOT DISTINCT FROM v_n_color;

      IF v_cnt = 1 THEN
        PERFORM 1 FROM public.variants WHERE id = v_maybe FOR UPDATE;
        SELECT product_id INTO v_target_pro FROM public.variants WHERE id = v_maybe;
        v_target_var := v_maybe;
        v_res        := 'auto_matched';
      ELSE
        -- C2) ¿Existe EXACTAMENTE UN producto por nombre+marca? Entonces se crea
        -- la variante ADENTRO de esa ficha: evita duplicar el producto entero
        -- solo porque cambió la talla.
        -- Mismo motivo que arriba: no existe min(uuid).
        SELECT count(*), (array_agg(p.id ORDER BY p.id))[1]
          INTO v_cnt, v_maybe
          FROM public.products p
         WHERE p.store_id = v_t.to_store_id
           AND normalize_catalog_text(p.name)  IS NOT DISTINCT FROM v_n_name
           AND normalize_catalog_text(p.brand) IS NOT DISTINCT FROM v_n_brand;

        IF v_cnt = 1 THEN
          v_target_pro := v_maybe;
          v_res        := 'auto_matched';
        ELSE
          -- C3) AMBIGÜEDAD (o nada parecido): NO se adivina. Se crea el producto
          -- nuevo como se eligió. Nunca inventar un mapeo dudoso, nunca bloquear
          -- la recepción — si el destino ya tiene duplicados, elegir al azar
          -- entre ellos empeora el desorden en vez de arreglarlo.
          v_target_pro := NULL;
          v_res        := 'as_chosen';
        END IF;
      END IF;
    END IF;

    -- ── GUARD UNIFICADO: ¿esa talla/color ya existe en la ficha destino? ────
    -- Corre para CUALQUIER camino que haya resuelto un producto pero no una
    -- variante (B y C2 hoy, y cualquiera que se agregue después).
    --
    -- NO es una gentileza, es lo que evita un 23505 en el mostrador: si alguien
    -- creó esa talla/color en el destino mientras la mercancía viajaba, insertar
    -- a ciegas choca contra variants_combo_unique (product_id, size, color) y la
    -- recepción entera falla.
    --
    -- La comparación normalizada es MÁS AMPLIA que el UNIQUE crudo (igualdad
    -- cruda implica igualdad normalizada), así que atrapa todo lo que el UNIQUE
    -- rechazaría — incluido el caso 'M' contra 'm ', que el UNIQUE ve como
    -- distintos pero que igual conviene mapear en vez de duplicar.
    IF v_target_var IS NULL AND v_target_pro IS NOT NULL THEN
      SELECT id INTO v_maybe
        FROM public.variants
       WHERE product_id = v_target_pro
         AND normalize_catalog_text(size)  IS NOT DISTINCT FROM v_n_size
         AND normalize_catalog_text(color) IS NOT DISTINCT FROM v_n_color
       LIMIT 1;

      IF v_maybe IS NOT NULL THEN
        PERFORM 1 FROM public.variants WHERE id = v_maybe FOR UPDATE;
        v_target_var := v_maybe;
        v_res        := 'auto_matched';
      END IF;
    END IF;

    -- ── Crear el producto si hace falta ─────────────────────────────────────
    IF v_target_var IS NULL AND v_target_pro IS NULL THEN
      INSERT INTO public.products
        (name, description, brand, store_id, size_type, is_active)
      VALUES
        (v_it.product_name, v_it.description, v_it.brand, v_t.to_store_id,
         COALESCE(v_it.size_type, 'letter'), true)
      RETURNING id INTO v_target_pro;
    END IF;

    -- ── Crear la variante si hace falta ─────────────────────────────────────
    IF v_target_var IS NULL THEN
      -- Barcode NUEVO: variants_barcode_unique es global, la etiqueta que viajó
      -- pegada a la prenda NO escanea acá y hay que reimprimir al recibir.
      -- unit_cost del snapshot: es el único costo disponible para una variante
      -- que nace.
      INSERT INTO public.variants
        (product_id, store_id, size, color, price, cost_price,
         stock_qty, min_stock, barcode, is_active)
      VALUES
        (v_target_pro, v_t.to_store_id, v_it.size, v_it.color,
         v_it.unit_price, v_it.unit_cost, 0, 0, generate_free_barcode(), true)
      RETURNING id INTO v_target_var;
    END IF;
    -- Si se MAPEÓ a una variante existente, su cost_price NO se toca: un
    -- traslado mueve mercancía, no la compra. El destino conserva su costo y su
    -- margen. Pisarlo reescribiría en silencio el margen de las unidades que el
    -- destino YA tenía en esa variante. Contraste deliberado con
    -- increase_stock_on_purchase (011), que sí lo actualiza — porque una factura
    -- de compra SÍ es una compra.

    -- ── Sumar el stock (y reactivar si estaba inactiva) ─────────────────────
    UPDATE public.variants
       SET stock_qty  = stock_qty + v_it.qty_sent,
           is_active  = true,
           updated_at = now()
     WHERE id = v_target_var;

    -- Reactivar TAMBIÉN el producto si el destino había desactivado la ficha
    -- entera. No alcanza con la variante: usePOSProducts y useInventory filtran
    -- por products.is_active, así que con la ficha inactiva el stock llegaría
    -- INVISIBLE e invendible en las dos pantallas. Llegó mercancía física; una
    -- ficha apagada con stock adentro es peor que una ficha reactivada.
    -- Acotado a la ficha que se está recibiendo, y solo si estaba inactiva.
    UPDATE public.products
       SET is_active  = true,
           updated_at = now()
     WHERE id = (SELECT product_id FROM public.variants WHERE id = v_target_var)
       AND is_active = false;

    INSERT INTO public.stock_movements
      (variant_id, store_id, type, qty, reference_id, notes, created_by)
    VALUES
      (v_target_var, v_t.to_store_id, 'transfer_in', v_it.qty_sent,
       p_transfer_id, 'Traslado #' || v_t.transfer_number || ' — recepción', v_uid);

    -- qty_received QUEDA EN NULL a propósito: nadie contó, y el sistema no va a
    -- afirmar que sí. Cuando exista el conteo, "qty_received IS NOT NULL"
    -- significará "esto se contó", retroactivamente correcto y sin backfill.
    UPDATE public.transfer_items
       SET to_product_id   = COALESCE(v_target_pro,
                                      (SELECT product_id FROM public.variants WHERE id = v_target_var)),
           to_variant_id   = v_target_var,
           dest_resolution = v_res
     WHERE id = v_it.id;
  END LOOP;

  UPDATE public.transfers
     SET status               = 'received',
         received_by          = v_uid,
         received_at          = now(),
         received_by_store_id = get_my_store_id(),
         updated_at           = now()
   WHERE id = p_transfer_id
     AND status = 'in_transit';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado durante la recepción; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.receive_transfer(uuid, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.receive_transfer(uuid, jsonb) TO authenticated;


-- ============================================================
-- 10. RPC 5 — cancel_transfer_draft (descartar un borrador)
-- ============================================================
-- Separada de revert_transfer_dispatch A PROPÓSITO: una mueve stock y la otra
-- no. Una sola puerta invitaría al accidente de creer que se descarta un
-- borrador y terminar revirtiendo un despacho.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_transfer_draft(
  p_transfer_id uuid,
  p_reason      text DEFAULT NULL
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

  SELECT * INTO v_t FROM public.transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado no existe';
  END IF;

  -- [5] Pertenencia de la fila + [3] vínculo de tienda
  IF v_t.from_store_id <> get_my_store_id() THEN
    RAISE EXCEPTION 'Solo la tienda de origen puede descartar este traslado';
  END IF;

  -- [4] Organización
  IF NOT (is_store_in_my_org(v_t.from_store_id) AND is_store_in_my_org(v_t.to_store_id)) THEN
    RAISE EXCEPTION 'El traslado no pertenece a tu organización';
  END IF;

  IF v_t.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se puede descartar un traslado en borrador; si ya fue despachado, revertí el despacho';
  END IF;

  -- Se ANULA, no se borra: se conserva la fila y el número, como el resto de la
  -- casa. No toca stock porque un borrador nunca lo movió.
  UPDATE public.transfers
     SET status        = 'cancelled',
         cancelled_by  = v_uid,
         cancelled_at  = now(),
         cancel_reason = NULLIF(btrim(coalesce(p_reason, '')), ''),
         updated_at    = now()
   WHERE id = p_transfer_id
     AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El traslado cambió de estado; volvé a intentar';
  END IF;

  RETURN transfer_payload(p_transfer_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_transfer_draft(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_transfer_draft(uuid, text) TO authenticated;


-- ============================================================
-- 11. RPC 6 — search_transfer_targets (sugerencias de mapeo)
-- ============================================================
-- SECURITY DEFINER pero STABLE y SIN UNA SOLA ESCRITURA.
--
-- ⚠️ ES LA ÚNICA RELAJACIÓN DELIBERADA DEL AISLAMIENTO EN TODO EL MÓDULO:
--    cualquier usuario con traslados.gestionar puede LEER el catálogo de
--    cualquier tienda DE SU PROPIA ORGANIZACIÓN. Está acotado a la org, exige el
--    permiso, es de solo lectura, devuelve un set fijo de columnas y va con
--    LIMIT. Es el primer lugar donde debería mirar una revisión de seguridad.
--
-- Sin esto el módulo no puede existir: el RLS le tapa al origen el catálogo del
-- destino, así que no habría forma de elegir a dónde va cada línea.
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_transfer_targets(
  p_to_store_id     uuid,
  p_from_variant_id uuid DEFAULT NULL,
  p_query           text DEFAULT NULL,
  p_limit           integer DEFAULT 20
)
RETURNS TABLE (
  product_id   uuid,
  product_name text,
  brand        text,
  description  text,
  variant_id   uuid,
  size         text,
  color        text,
  price        numeric,
  stock_qty    integer,
  is_active    boolean,
  match_kind   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- Los parámetros OUT de RETURNS TABLE (size, color, price, brand, is_active…)
-- se llaman igual que columnas reales. Todas las referencias van calificadas
-- (p.name, v.size, c.match_kind), y esta directiva deja explícito que ante
-- cualquier ambigüedad gana la COLUMNA, no la variable.
#variable_conflict use_column
DECLARE
  v_uid     uuid;
  v_n_name  text;
  v_n_brand text;
  v_n_size  text;
  v_n_color text;
  v_lim     integer;
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

  -- [4] Organización — el límite duro de esta ventana
  IF p_to_store_id IS NULL OR NOT is_store_in_my_org(p_to_store_id) THEN
    RAISE EXCEPTION 'La tienda destino no pertenece a tu organización';
  END IF;

  v_lim := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  IF p_from_variant_id IS NOT NULL THEN
    -- [3] La variante de referencia tiene que ser de MI tienda.
    SELECT normalize_catalog_text(p.name),
           normalize_catalog_text(p.brand),
           normalize_catalog_text(v.size),
           normalize_catalog_text(v.color)
      INTO v_n_name, v_n_brand, v_n_size, v_n_color
      FROM public.variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE v.id = p_from_variant_id
       AND v.store_id = get_my_store_id();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La variante de origen no es de tu tienda';
    END IF;

    RETURN QUERY
    WITH cand AS (
      SELECT p.id AS product_id, p.name AS product_name, p.brand, p.description,
             v.id AS variant_id, v.size, v.color, v.price, v.stock_qty, v.is_active,
             CASE
               WHEN normalize_catalog_text(p.brand) IS NOT DISTINCT FROM v_n_brand
                AND normalize_catalog_text(v.size)  IS NOT DISTINCT FROM v_n_size
                AND normalize_catalog_text(v.color) IS NOT DISTINCT FROM v_n_color
                 THEN 'exact_variant'
               WHEN normalize_catalog_text(p.brand) IS NOT DISTINCT FROM v_n_brand
                 THEN 'same_product'
               ELSE 'name_similar'
             END AS match_kind
        FROM public.products p
        JOIN public.variants v ON v.product_id = p.id
       WHERE p.store_id = p_to_store_id
         AND normalize_catalog_text(p.name) IS NOT DISTINCT FROM v_n_name
    )
    SELECT c.product_id, c.product_name, c.brand, c.description,
           c.variant_id, c.size, c.color, c.price, c.stock_qty, c.is_active,
           c.match_kind
      FROM cand c
     ORDER BY CASE c.match_kind
                WHEN 'exact_variant' THEN 1
                WHEN 'same_product'  THEN 2
                ELSE 3
              END,
              c.product_name, c.size, c.color
     LIMIT v_lim;

  ELSE
    -- Modo búsqueda libre, para elegir a mano.
    IF p_query IS NULL OR length(btrim(p_query)) < 2 THEN
      RAISE EXCEPTION 'Escribí al menos 2 caracteres para buscar';
    END IF;

    RETURN QUERY
    SELECT p.id, p.name, p.brand, p.description,
           v.id, v.size, v.color, v.price, v.stock_qty, v.is_active,
           'name_similar'::text
      FROM public.products p
      JOIN public.variants v ON v.product_id = p.id
     WHERE p.store_id = p_to_store_id
       AND (
            p.name    ILIKE '%' || btrim(p_query) || '%'
         OR p.brand   ILIKE '%' || btrim(p_query) || '%'
         OR v.sku     ILIKE '%' || btrim(p_query) || '%'
         OR v.barcode  =    btrim(p_query)
       )
     ORDER BY p.name, v.size, v.color
     LIMIT v_lim;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_transfer_targets(uuid, uuid, text, integer) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.search_transfer_targets(uuid, uuid, text, integer) TO authenticated;


COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. Las dos tablas existen con RLS activo y SOLO política de SELECT:
--
--      SELECT relname, relrowsecurity FROM pg_class
--       WHERE relname IN ('transfers','transfer_items');       -- ambas true
--
--      SELECT tablename, policyname, cmd FROM pg_policies
--       WHERE tablename IN ('transfers','transfer_items');     -- solo SELECT
--
-- 2. authenticated NO puede escribir (ni por GRANT ni por RLS):
--
--      SELECT grantee, privilege_type FROM information_schema.role_table_grants
--       WHERE table_name IN ('transfers','transfer_items')
--         AND grantee IN ('anon','authenticated');             -- solo SELECT/authenticated
--
-- 3. Las 6 RPC existen y anon NO puede ejecutarlas:
--
--      SELECT p.proname, p.prosecdef,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
--             has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ok
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('save_transfer_draft','dispatch_transfer',
--                           'revert_transfer_dispatch','receive_transfer',
--                           'cancel_transfer_draft','search_transfer_targets');
--      -- prosecdef = true, auth_ok = true, anon_ok = FALSE en las 6.
--
-- 4. normalize_catalog_text hace lo que dice (todas deben dar true):
--
--      SELECT normalize_catalog_text('  DEYLEID ') = normalize_catalog_text('deyleid'),
--             normalize_catalog_text('Ñandú')      = 'NANDU',
--             normalize_catalog_text('')           IS NULL,
--             normalize_catalog_text(NULL)         IS NULL,
--             normalize_catalog_text('a  b')       = 'A B';
--
-- 5. El índice de match se usa (debe decir Index Scan / Bitmap):
--
--      EXPLAIN SELECT 1 FROM products
--       WHERE store_id = '<uuid>'
--         AND normalize_catalog_text(name) = 'JEAN DAMA';
--
-- 6. Numeración por organización, no por tienda: crear dos traslados en
--    sentidos opuestos entre dos tiendas de la misma org y confirmar que los
--    números son consecutivos (1, 2) y no (1, 1).
--
-- 7. La matriz completa de la fase 3 está en plan/gmura-plan-traslados.md §7.
--
-- ============================================================
-- REVERSIÓN
-- ============================================================
-- A diferencia de la 040, esta migración SÍ es reversible de forma limpia,
-- siempre que no haya traslados registrados:
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.search_transfer_targets(uuid, uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.cancel_transfer_draft(uuid, text);
--   DROP FUNCTION IF EXISTS public.receive_transfer(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.revert_transfer_dispatch(uuid, text);
--   DROP FUNCTION IF EXISTS public.dispatch_transfer(uuid);
--   DROP FUNCTION IF EXISTS public.save_transfer_draft(uuid, jsonb, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.transfer_payload(uuid);
--   DROP FUNCTION IF EXISTS public.generate_free_barcode();
--   DROP TABLE IF EXISTS public.transfer_items;
--   DROP TABLE IF EXISTS public.transfers;
--   DROP FUNCTION IF EXISTS public.assign_transfer_number();
--   DROP FUNCTION IF EXISTS public.enforce_transfer_org();
--   DROP INDEX IF EXISTS public.idx_products_catalog_match;
--   DROP FUNCTION IF EXISTS public.normalize_catalog_text(text);
--   COMMIT;
--
-- Si YA hay traslados recibidos, el DROP de las tablas borraría la trazabilidad
-- de movimientos de stock que sí ocurrieron (los stock_movements quedarían con
-- reference_id apuntando a la nada). En ese caso la reversión correcta es dejar
-- las tablas y quitar solo el acceso: REVOKE EXECUTE de las 6 RPC.
-- ============================================================
