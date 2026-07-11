import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useCurrentShift } from './useCashShift'
import { useResolvedConfig } from './useConfig'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import type { Order, PaymentMethod } from '@/types/database.types'
import { assertValidPayments, primaryPaymentMethod } from '@/lib/orderPayments'
import { orderTotals, minFinalPrice } from '@/stores/cartStore'
import type { CartItem } from '@/stores/cartStore'
import { isValidGiftReason } from '@/lib/giftReasons'

// Una línea de pago de la venta: método + monto. Una venta simple trae UNA
// línea (amount = total); una venta MIXTA, varias. Σ amount == total.
export interface OrderPaymentLine {
  method: PaymentMethod
  amount: number
}

export interface CreateOrderInput {
  // Cada ítem lleva unit_price (precio final vendido) y list_price (catálogo).
  // El descuento se deriva por ítem; ya no hay descuento global de cabecera.
  items: CartItem[]
  customer_id: string | null
  // Pagos de la venta (order_payments, 032). Una o varias líneas; su suma debe
  // ser igual al total (incluido el recargo). Reemplaza al payment_method único.
  payments: OrderPaymentLine[]
  // Recibido en la línea EFECTIVO (para calcular el vuelto). Solo cash.
  cash_received?: number
  // Recargo manual (ej. Addi). Se suma al total. Default 0.
  surcharge?: number
}

export function useCreateOrder() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: currentShift } = useCurrentShift()
  const maxItemDiscount = useResolvedConfig().max_item_discount

  return useMutation({
    mutationFn: async (input: CreateOrderInput): Promise<Order> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id

      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }

      if (input.items.length === 0) {
        throw new Error('El carrito está vacío')
      }
      for (const item of input.items) {
        if (!item.variant_id || !item.product_id) {
          throw new Error('Ítem inválido en el carrito (falta variante o producto)')
        }
        if (item.qty <= 0) {
          throw new Error(`Cantidad inválida para ${item.name}`)
        }
        if (item.unit_price < 0 || item.list_price < 0) {
          throw new Error(`Precio inválido para ${item.name}`)
        }
        // Defensa del modelo por ítem (el store ya clampa; esto atrapa
        // anomalías antes de que el CHECK de la BD rechace el insert):
        //  · el precio final no puede superar el catálogo (CHECK unit <= list)
        //  · ni bajar del mínimo permitido por el tope configurado
        if (item.unit_price > item.list_price) {
          throw new Error(
            `Precio inválido para ${item.name}: el precio final (${fmtCOP(
              item.unit_price,
            )}) no puede superar el de catálogo (${fmtCOP(item.list_price)}).`,
          )
        }
        if (item.isGift) {
          // Regalo: motivo de la lista + precio 0 (coherente con el CHECK
          // order_items_gift_coherent de la 027). NO pasa por el tope de
          // descuento: es un mecanismo aparte, gateado por ventas.regalo.
          if (!isValidGiftReason(item.giftReason)) {
            throw new Error(
              `Regalo sin motivo válido para ${item.name}.`,
            )
          }
          if (item.unit_price !== 0) {
            throw new Error(
              `Un ítem de regalo debe tener precio 0 (${item.name}).`,
            )
          }
        } else {
          // No-regalo: respeta el mínimo permitido por el tope configurado.
          const minFinal = minFinalPrice(item.list_price, maxItemDiscount)
          if (item.unit_price < minFinal) {
            throw new Error(
              `Descuento no permitido para ${item.name}: el precio mínimo es ${fmtCOP(
                minFinal,
              )}.`,
            )
          }
        }
      }

      // Totales derivados de los ítems (subtotal catálogo, descuento derivado,
      // total = finales + recargo). Misma fórmula/redondeo que el carrito.
      const { subtotal, discount, surcharge, total } = orderTotals(
        input.items,
        input.surcharge,
      )
      if (total < 0) {
        throw new Error('El total no puede ser negativo')
      }

      // Validación de las líneas de pago (pagos mixtos, 032): ≥1 línea, método
      // válido (no 'credit'), monto > 0, sin método repetido y Σ montos == total
      // (tolerancia de centavos). Lógica pura testeada en lib/orderPayments.
      const lines = input.payments
      assertValidPayments(lines, total)

      // orders.payment_method = método PRIMARIO (el de mayor monto; desempate
      // estable). Denormalización legacy: el cuadre y los reportes ya leen
      // order_payments, no este campo. Para una venta de un solo método es ese
      // método (idéntico a antes); evita agregar 'mixed' al enum.
      const primaryMethod = primaryPaymentMethod(lines)

      console.info('[useCreateOrder] Creando orden…', {
        items: input.items.length,
        total,
        surcharge,
        payments: lines.length,
        primaryMethod,
      })

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          created_by: userId,
          status: 'completed',
          subtotal,
          discount,
          surcharge,
          total,
          payment_method: primaryMethod,
          cash_received: input.cash_received ?? null,
          // Imputa la venta al turno abierto de la tienda (026). El POS exige
          // turno para vender, así que normalmente estará presente; null si no.
          shift_id: currentShift?.id ?? null,
        } as never)
        .select()
        .single()

      if (orderError || !order) {
        console.error('[useCreateOrder] Error insertando orden:', orderError)
        throw new Error(
          `Error al guardar venta: ${orderError?.message ?? 'desconocido'}`,
        )
      }

      const o = order as Order

      // Rollback compensatorio: borra la orden recién creada. El ON DELETE
      // CASCADE de order_payments y order_items limpia los hijos ya insertados
      // (no hay transacciones en el cliente Supabase, de ahí el borrado manual).
      const rollbackOrder = async (context: string) => {
        const { error: rbErr } = await supabase
          .from('orders')
          .delete()
          .eq('id' as never, o.id)
        if (rbErr) {
          console.error(`[useCreateOrder] Rollback (${context}) falló:`, rbErr)
        }
      }

      // Líneas de pago (order_payments, 032). Se insertan ANTES que los ítems:
      // si fallan, se borra la orden sin haber tocado stock (los ítems disparan
      // la deducción). Una venta simple inserta una sola fila.
      console.info(
        `[useCreateOrder] Orden ${o.id} creada, insertando ${lines.length} pago(s)…`,
      )
      const { error: paymentsError } = await supabase.from('order_payments').insert(
        lines.map((l) => ({
          order_id: o.id,
          store_id: storeId,
          method: l.method,
          amount: l.amount,
        })) as never,
      )
      if (paymentsError) {
        console.error(
          '[useCreateOrder] Error insertando pagos, ejecutando rollback…',
          paymentsError,
        )
        await rollbackOrder('order_payments')
        throw new Error(`Error al guardar el pago: ${paymentsError.message}`)
      }

      console.info(
        `[useCreateOrder] Insertando ${input.items.length} ítems…`,
      )

      const { error: itemsError } = await supabase.from('order_items').insert(
        input.items.map((item) => ({
          order_id: o.id,
          variant_id: item.variant_id,
          product_id: item.product_id,
          qty: item.qty,
          // unit_price = precio FINAL vendido; list_price = catálogo (NOT NULL
          // en la BD). list_price es obligatorio: el `as never` lo ocultaría.
          unit_price: item.unit_price,
          list_price: item.list_price,
          // Regalo: is_gift + motivo. Si no es regalo, gift_reason va NULL
          // (coherente con el CHECK order_items_gift_coherent de la 027).
          is_gift: item.isGift,
          gift_reason: item.isGift ? item.giftReason : null,
        })) as never,
      )

      if (itemsError) {
        console.error(
          '[useCreateOrder] Error insertando ítems, ejecutando rollback…',
          itemsError,
        )
        await rollbackOrder('order_items')
        throw new Error(`Error al guardar venta: ${itemsError.message}`)
      }

      console.info('[useCreateOrder] Ítems insertados correctamente')
      return o
    },

    onSuccess: (order) => {
      console.info('✅ Orden creada:', order.id)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['cash-shift'] })
    },

    onError: (err: Error) => {
      console.error('[useCreateOrder] Mutación falló:', err)
      toast.error(err.message)
    },
  })
}
