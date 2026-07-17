import { bogotaDayOf } from './dateRange'

// Lógica pura del "entró a caja" de una fila del historial de ventas. Aislada de
// useSalesHistory (que solo hace las queries) para poder testearla sin React ni
// red. Paralela a shiftCalc.ts / creditCalc.ts / returnCalc.ts.
//
// PROBLEMA que resuelve: el historial muestra el TOTAL de la venta, pero en un
// separado o en un fiado ese total NO es el dinero que entró al cajón ese día.
// El cajero ve una venta de $185.000, no encuentra esa plata y cree que el
// cuadre está mal. El sistema ya calcula bien; lo que faltaba era COMUNICARLO.
//
// MODELO — de dónde sale el dinero de cada tipo:
//   · Directa: el total entró el día de la venta. Invariante de la 032:
//     Σ order_payments = orders.total para toda orden no fiada.
//   · Separado: la orden SOLO existe al completarlo, y completar exige saldar en
//     el momento → entró el pago de cierre (más cualquier otro abono del mismo
//     día), nunca el total: los abonos previos entraron otros días. Es
//     consistente con el cuadre, que excluye esta orden y cuenta cada
//     layaway_payment el día que se cobró (useShiftClosing → excludedOrderIds).
//   · Fiado: entró solo el abono inicial si lo hubo; puede ser $0.
//
// NO se usa orders.paid_amount: es el acumulado histórico de TODOS los abonos
// (crece con los días y con otros turnos), no el dinero de este día. El cálculo
// parte siempre de los pagos fechados.

export type SaleKind = 'direct' | 'layaway' | 'credit'

/** Abono fechado: una fila de layaway_payments (separado) o credit_payments (fiado). */
export interface SalePaymentInput {
  amount: number
  created_at: string
  // Abono de una deuda vieja cargada al sistema (028/029): ese dinero entró
  // antes de existir el registro, nunca pasó por esta caja.
  is_historical?: boolean
}

export interface SaleCashInput {
  // Instante de la orden. Fija el DÍA al que se ancla el cálculo: el día de la
  // venta, no el filtro activo de la pantalla (así el número no cambia al pasar
  // el filtro de "hoy" a "este mes").
  created_at: string
  total: number
  is_credit: boolean
  // true si la orden nació de completar un separado. Se resuelve con el cruce
  // inverso layaways.converted_order_id → orders.id (no hay orders.layaway_id).
  from_layaway: boolean
  // Abonos del separado o del fiado. Vacío en una venta directa.
  payments?: SalePaymentInput[]
}

export interface SaleCashInfo {
  kind: SaleKind
  // Dinero que entró a la caja el día de la venta.
  enteredToday: number
  // La línea solo se muestra cuando el dinero que entró difiere del total; así
  // el ojo cae en las filas anómalas y las ventas directas quedan limpias.
  showEnteredLine: boolean
}

// Tolerancia de centavos, mismo criterio que el resto de la lógica financiera
// (isCreditFullyPaid, useCompleteLayaway).
const EPSILON = 0.5

export function resolveSaleKind(input: {
  is_credit: boolean
  from_layaway: boolean
}): SaleKind {
  // La orden de conversión de un separado nunca se inserta con is_credit, así
  // que los dos flags no compiten. Si alguna vez lo hicieran, el separado manda:
  // es el origen del dinero y el que explica por qué el total no entró hoy.
  if (input.from_layaway) return 'layaway'
  if (input.is_credit) return 'credit'
  return 'direct'
}

/**
 * Suma los abonos REALES fechados el mismo día Bogotá que la venta. Descarta los
 * históricos y los de otros días. La comparación es por día civil de Bogotá: un
 * abono de las 23:00 cae en el mismo día que su venta aunque en UTC ya sea el
 * día siguiente.
 */
export function sumPaymentsOnSaleDay(
  saleCreatedAt: string,
  payments: SalePaymentInput[],
): number {
  const saleDay = bogotaDayOf(new Date(saleCreatedAt))
  let sum = 0
  for (const p of payments) {
    if (p.is_historical) continue
    if (bogotaDayOf(new Date(p.created_at)) !== saleDay) continue
    sum += Number(p.amount)
  }
  return sum
}

/**
 * Clasifica una fila del historial y calcula cuánto entró a la caja el día de la
 * venta. Ver el encabezado del archivo para el modelo de cada tipo.
 */
export function resolveSaleCash(input: SaleCashInput): SaleCashInfo {
  const kind = resolveSaleKind(input)
  const total = Number(input.total)

  // Una venta directa cobra el total en el acto: no hay abonos que sumar.
  const enteredToday =
    kind === 'direct'
      ? total
      : sumPaymentsOnSaleDay(input.created_at, input.payments ?? [])

  return {
    kind,
    enteredToday,
    showEnteredLine: Math.abs(enteredToday - total) > EPSILON,
  }
}
