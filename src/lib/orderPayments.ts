import type { PaymentMethod } from '@/types/database.types'
import { PAYMENT_METHOD_KEYS } from './paymentMethods'
import { fmtCOP } from './formatters'

// Lógica pura de las líneas de pago de una venta directa (order_payments, 032).
// Aislada de useCreateOrder para poder testear las validaciones sin React ni red.

export interface PaymentLine {
  method: PaymentMethod
  amount: number
}

// Métodos válidos para una venta directa: cash/card/transfer/addi. NO 'credit'
// (fiar es un flujo aparte; su efectivo entra por credit_payments).
export function isDirectPaymentMethod(m: PaymentMethod): boolean {
  return (PAYMENT_METHOD_KEYS as readonly PaymentMethod[]).includes(m)
}

// Método primario = el de mayor monto; desempate estable por nombre. Es lo que
// se guarda en orders.payment_method (denormalización legacy: el cuadre y los
// reportes leen order_payments, no este campo). Para una venta de un solo
// método es ese método → idéntico al comportamiento previo. Asume lines no vacío.
export function primaryPaymentMethod(lines: PaymentLine[]): PaymentMethod {
  return [...lines].sort(
    (a, b) => b.amount - a.amount || a.method.localeCompare(b.method),
  )[0].method
}

export function sumPaymentLines(lines: PaymentLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}

// Validaciones COMUNES a una venta y a un abono (separado/fiado):
//  · al menos una línea
//  · método válido (no 'credit')
//  · cada monto > 0
//  · un método por línea (consolidado, sin repetir)
export function assertValidSplitLines(lines: PaymentLine[]): void {
  if (!lines || lines.length === 0) {
    throw new Error('Falta el método de pago')
  }
  const seen = new Set<PaymentMethod>()
  for (const l of lines) {
    if (!isDirectPaymentMethod(l.method)) {
      throw new Error(`Método de pago inválido: ${l.method}`)
    }
    if (!(l.amount > 0)) {
      throw new Error('Cada pago debe ser mayor a $0')
    }
    if (seen.has(l.method)) {
      throw new Error('No repitas el mismo método; consolídalo en una línea')
    }
    seen.add(l.method)
  }
}

// VENTA: las líneas deben sumar EXACTAMENTE el total (tolerancia de 0.5 por
// redondeo de centavos).
export function assertValidPayments(lines: PaymentLine[], total: number): void {
  assertValidSplitLines(lines)
  const paid = sumPaymentLines(lines)
  if (Math.abs(paid - total) > 0.5) {
    throw new Error(
      `Los pagos (${fmtCOP(paid)}) no cuadran con el total (${fmtCOP(total)})`,
    )
  }
}

// ABONO (separado/fiado): las líneas pueden sumar cualquier monto > 0 que NO
// supere el saldo pendiente. El total del abono es Σ líneas.
export function assertValidAbono(lines: PaymentLine[], maxAmount: number): void {
  assertValidSplitLines(lines)
  const paid = sumPaymentLines(lines)
  if (paid > maxAmount + 0.5) {
    throw new Error(`El abono no puede superar el saldo (${fmtCOP(maxAmount)})`)
  }
}
