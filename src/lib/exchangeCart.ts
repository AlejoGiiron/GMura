// Carrito de "productos nuevos" para un cambio (exchange). Desacopla los ítems
// nuevos de los devueltos: el cliente arma libremente una lista, con cantidad
// propia por línea, para cubrir el crédito. Lógica pura para poder testearla sin
// React ni red (el netting de la plata lo hace calculateExchangeAmounts).

export type ExchangeLine = {
  variant_id: string
  product_id: string
  qty: number
  // Precio de catálogo del ítem nuevo (unit_price = list_price en el cambio).
  list_price: number
  // Stock disponible al momento de agregar; tope del stepper.
  stock_qty: number
  // Datos de display.
  product_name: string
  size: string | null
  color: string | null
  sku: string | null
}

// Variante elegida en el picker (forma de ExchangeVariantOption de useReturns).
export type ExchangeCandidate = {
  id: string
  product_id: string
  product_name: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  sku: string | null
}

// true si la variante ya está en el carrito y alcanzó su stock (no cabe más).
export function isAtStockCap(list: ExchangeLine[], v: ExchangeCandidate): boolean {
  const existing = list.find((e) => e.variant_id === v.id)
  return !!existing && existing.qty >= v.stock_qty
}

// Agrega una variante. Si ya existe incrementa qty respetando el stock; si ya
// está en el tope retorna la misma lista sin cambios.
export function addExchangeLine(
  list: ExchangeLine[],
  v: ExchangeCandidate,
): ExchangeLine[] {
  const existing = list.find((e) => e.variant_id === v.id)
  if (existing) {
    if (existing.qty >= v.stock_qty) return list
    return list.map((e) =>
      e.variant_id === v.id ? { ...e, qty: e.qty + 1 } : e,
    )
  }
  return [
    ...list,
    {
      variant_id: v.id,
      product_id: v.product_id,
      qty: 1,
      list_price: v.price,
      stock_qty: v.stock_qty,
      product_name: v.product_name,
      size: v.size,
      color: v.color,
      sku: v.sku,
    },
  ]
}

// Fija la cantidad de una línea, clampeada a [1, stock_qty].
export function setExchangeLineQty(
  list: ExchangeLine[],
  variantId: string,
  qty: number,
): ExchangeLine[] {
  return list.map((e) =>
    e.variant_id === variantId
      ? { ...e, qty: Math.min(e.stock_qty, Math.max(1, Math.floor(qty) || 1)) }
      : e,
  )
}

// Quita una línea del carrito.
export function removeExchangeLine(
  list: ExchangeLine[],
  variantId: string,
): ExchangeLine[] {
  return list.filter((e) => e.variant_id !== variantId)
}
