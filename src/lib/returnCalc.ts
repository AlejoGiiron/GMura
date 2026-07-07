// Lógica pura para netear cambios (exchanges). Un cambio NO debe registrar el
// valor completo del producto nuevo como venta: solo la diferencia de precio.
// Aislada del hook useReturnMutations para poder testearla sin red.
//
// Política de descuento (fix/exchange-discount): el descuento por ítem del
// producto ORIGINAL se traslada como MONTO ABSOLUTO al producto nuevo, de modo
// que un cambio por el mismo catálogo no genere una diferencia falsa a cobrar.
// Insight clave: trasladar el descuento absoluto y comparar contra lo pagado es
// algebraicamente idéntico a comparar catálogo_nuevo − catálogo_devuelto
//   (nuevoNeto − creditoPagado)
//   = (catalogoNuevo − descuento) − (catalogoDevuelto − descuento)
//   = catalogoNuevo − catalogoDevuelto
// Por eso `difference` se calcula sobre catálogos (base homogénea), evitando el
// bug de restar catálogo (bruto) contra pagado (neto).

export interface ReturnLine {
  qty: number
  // Precio realmente PAGADO por unidad (con descuento por ítem aplicado).
  unit_price: number
  // Precio de CATÁLOGO por unidad (sin descuento).
  list_price: number
}

export interface ExchangeAmounts {
  // ── Desglose para la UI (Fase 2) ──────────────────────────────────────────
  // Lo que el cliente pagó por lo devuelto (crédito real): Σ unit_price·qty.
  creditoPagado: number
  // Descuento absoluto trasladado desde lo devuelto: Σ (list − unit)·qty.
  descuentoTrasladado: number
  // Catálogo total de los ítems nuevos: Σ list_price·qty.
  catalogoNuevo: number
  // Catálogo total de los ítems devueltos: Σ list_price·qty.
  catalogoDevuelto: number
  // Valor del/los ítem(s) nuevo(s) tras trasladarle el descuento (piso en 0).
  nuevoNeto: number
  // exchangeTotal − returnedTotal, en base catálogo. Positiva = el cliente
  // paga; negativa = quedaría a favor del cliente (Fase 3 lo bloqueará); cero =
  // cambio del mismo valor.
  difference: number
  // Cuánto FALTA en catálogo para que la diferencia no sea negativa. > 0 solo
  // cuando lo nuevo vale menos que lo devuelto. Lo usará el bloqueo de Fase 3.
  shortfall: number

  // ── Alias históricos (semántica preservada) ───────────────────────────────
  // = creditoPagado (Σ unit_price·qty de lo devuelto).
  returnedTotal: number
  // = catalogoNuevo (Σ list_price·qty de lo nuevo).
  exchangeTotal: number

  // ── Cómo se registra la orden del cambio ──────────────────────────────────
  // subtotal = catálogo de lo nuevo (para que sus order_items descuenten stock
  // vía trigger) con un descuento que netea el crédito, de modo que el total
  // (lo que cuenta como venta) sea solo la diferencia, nunca el valor completo.
  orderSubtotal: number
  orderDiscount: number
  orderTotal: number
  // Dinero que SALE de la caja cuando el cambio queda a favor del cliente. En
  // Fase 3 el bloqueo lo mantendrá en 0 para cambios; se conserva por ahora.
  refundDue: number
}

// Σ (unit_price · qty) — valor PAGADO de las líneas.
export function sumLines(lines: ReturnLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0)
}

// Σ (list_price · qty) — valor de CATÁLOGO de las líneas.
export function sumCatalog(lines: ReturnLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.list_price, 0)
}

// Las ventas financiadas con Addi no admiten devoluciones ni cambios.
export const ADDI_RETURN_BLOCK_MSG =
  'Las ventas pagadas con Addi no admiten devoluciones ni cambios por el acuerdo de financiación.'

// true si una orden con ese método de pago puede devolverse/cambiarse.
export function isReturnablePayment(paymentMethod: string): boolean {
  return paymentMethod !== 'addi'
}

export function calculateExchangeAmounts(
  returnItems: ReturnLine[],
  exchangeItems: ReturnLine[],
): ExchangeAmounts {
  const creditoPagado = sumLines(returnItems)
  const catalogoDevuelto = sumCatalog(returnItems)
  const descuentoTrasladado = catalogoDevuelto - creditoPagado
  const catalogoNuevo = sumCatalog(exchangeItems)

  const nuevoNeto = Math.max(0, catalogoNuevo - descuentoTrasladado)
  // Base homogénea (catálogo vs catálogo): traslada el descuento sin el bug.
  const difference = catalogoNuevo - catalogoDevuelto
  const shortfall = Math.max(0, catalogoDevuelto - catalogoNuevo)

  const orderSubtotal = catalogoNuevo
  const orderTotal = Math.max(0, difference)
  const orderDiscount = orderSubtotal - orderTotal

  return {
    creditoPagado,
    descuentoTrasladado,
    catalogoNuevo,
    catalogoDevuelto,
    nuevoNeto,
    difference,
    shortfall,
    returnedTotal: creditoPagado,
    exchangeTotal: catalogoNuevo,
    orderSubtotal,
    orderDiscount,
    orderTotal,
    refundDue: Math.max(0, -difference),
  }
}
