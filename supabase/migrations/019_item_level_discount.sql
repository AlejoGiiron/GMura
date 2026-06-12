-- ============================================================
-- 019 — Descuento por ítem (precio final + precio de catálogo)
--
-- Cambia el modelo de descuento de "uno global por cabecera" a "por ítem":
-- el vendedor escribe el PRECIO FINAL de cada línea. Para conservar el
-- precio de catálogo de referencia (tachado en ticket/UI, base de reportes)
-- se agrega list_price en order_items y layaway_items.
--
--   unit_price = precio FINAL vendido (con descuento por ítem ya aplicado)
--   list_price = precio de CATÁLOGO al momento de la venta/separado
--   invariante: unit_price <= list_price  (el descuento solo baja el precio)
--
-- orders.discount / layaways.discount pasan a ser DERIVADOS:
--   subtotal = Σ(list_price·qty), discount = subtotal − Σ(unit_price·qty),
--   total    = subtotal − discount (+ surcharge en orders).
--
-- REQUIERE BD RESETEADA (tablas order_items y layaway_items vacías): la
-- columna list_price entra NOT NULL sin default. No hay datos históricos que
-- migrar (decisión de negocio confirmada). Si en algún entorno la tabla no
-- estuviera vacía, usar la variante en 3 pasos (ADD nullable → UPDATE
-- list_price = unit_price → SET NOT NULL).
--
-- El parámetro de tope (max_item_discount) vive en stores.config (jsonb) y
-- NO requiere migración.
-- ============================================================


-- ── order_items ───────────────────────────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN list_price numeric(12,2) NOT NULL CHECK (list_price >= 0),
  ADD CONSTRAINT order_items_final_le_list CHECK (unit_price <= list_price);

COMMENT ON COLUMN public.order_items.unit_price IS
  'Precio FINAL vendido por unidad (con descuento por ítem ya aplicado). unit_price <= list_price.';

COMMENT ON COLUMN public.order_items.list_price IS
  'Precio de CATÁLOGO por unidad al momento de la venta (referencia para tachado y reportes). El descuento por línea es derivado: (list_price - unit_price) * qty.';


-- ── layaway_items ─────────────────────────────────────────────────────────────
ALTER TABLE public.layaway_items
  ADD COLUMN list_price numeric(12,2) NOT NULL CHECK (list_price >= 0),
  ADD CONSTRAINT layaway_items_final_le_list CHECK (unit_price <= list_price);

COMMENT ON COLUMN public.layaway_items.unit_price IS
  'Precio FINAL por unidad del ítem del separado (con descuento por ítem aplicado). unit_price <= list_price. Se propaga a order_items al completar el separado.';

COMMENT ON COLUMN public.layaway_items.list_price IS
  'Precio de CATÁLOGO por unidad al crear el separado (referencia para tachado y reportes). Descuento por línea derivado: (list_price - unit_price) * qty.';
