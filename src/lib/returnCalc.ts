// Lógica pura para netear cambios (exchanges). Un cambio NO debe registrar el
// valor completo del producto nuevo como venta: solo la diferencia de precio.
// Aislada del hook useReturnMutations para poder testearla sin red.

export interface ReturnLine {
  qty: number
  unit_price: number
}

export interface ExchangeAmounts {
  returnedTotal: number
  exchangeTotal: number
  // exchangeTotal - returnedTotal. Positiva = el cliente paga; negativa = se le
  // reembolsa; cero = cambio del mismo valor.
  difference: number
  // Cómo se registra la orden del cambio: subtotal = valor de los ítems nuevos
  // (para que sus order_items descuenten stock vía trigger) con un descuento que
  // acredita los ítems devueltos, de modo que el total (lo que cuenta como
  // venta) sea solo la diferencia, nunca el valor completo.
  orderSubtotal: number
  orderDiscount: number
  orderTotal: number
  // Dinero que SALE de la caja cuando el cambio es más barato (reembolso).
  refundDue: number
}

export function sumLines(lines: ReturnLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0)
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
  const returnedTotal = sumLines(returnItems)
  const exchangeTotal = sumLines(exchangeItems)
  const difference = exchangeTotal - returnedTotal

  return {
    returnedTotal,
    exchangeTotal,
    difference,
    orderSubtotal: exchangeTotal,
    orderDiscount: Math.min(returnedTotal, exchangeTotal),
    orderTotal: Math.max(0, difference),
    refundDue: Math.max(0, -difference),
  }
}
