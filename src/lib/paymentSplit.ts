import type { PaymentMethod } from '@/types/database.types'

// Línea de pago en la UI (monto como string del input). El dominio usa números
// (PaymentLine en lib/orderPayments); la conversión ocurre al confirmar. Vive
// aquí, fuera del componente, para no romper react-refresh (el .tsx solo
// exporta el componente).
export interface SplitLine {
  method: PaymentMethod
  amount: string
}

export function sumSplitLines(lines: SplitLine[]): number {
  return lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
}
