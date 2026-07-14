import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useCurrentShift } from './useCashShift'
import toast from 'react-hot-toast'
import {
  calculateExchangeAmounts,
  isReturnablePayment,
  ADDI_RETURN_BLOCK_MSG,
} from '@/lib/returnCalc'
import { assertShiftForPayment, returnMovesCash } from '@/lib/shiftGuard'
import type { PaymentMethod, ReturnType, Return } from '@/types/database.types'

// ── Input types ───────────────────────────────────────────────────────────────

export type ReturnItemInput = {
  variant_id: string
  qty: number
  // Precio realmente pagado (con descuento por ítem).
  unit_price: number
  // Precio de catálogo del ítem devuelto (para trasladar su descuento al cambio).
  list_price: number
}

export type ExchangeItemInput = {
  variant_id: string
  product_id: string
  qty: number
  // Catálogo del ítem nuevo (unit_price = list_price: sin redescuento propio).
  unit_price: number
  list_price: number
}

export type CreateReturnInput = {
  original_order_id: string
  original_order_number: number
  customer_id: string | null
  type: ReturnType
  returnItems: ReturnItemInput[]
  exchangeItems: ExchangeItemInput[] // solo cuando type === 'exchange'
  refundMethod: PaymentMethod
  notes: string
}

// Agrupa cantidades por variant_id para que el chequeo de stock contemple
// duplicados (ej: dos líneas de exchange apuntando a la misma variante).
function aggregateQtyByVariant(items: { variant_id: string; qty: number }[]) {
  const map = new Map<string, number>()
  for (const item of items) {
    map.set(item.variant_id, (map.get(item.variant_id) ?? 0) + item.qty)
  }
  return map
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function useCreateReturn() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: currentShift } = useCurrentShift()

  return useMutation({
    mutationFn: async (input: CreateReturnInput): Promise<Return> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id

      if (!storeId || !userId) {
        throw new Error('Sesión inválida. Vuelve a iniciar sesión.')
      }

      // Validación de inputs antes de tocar BD
      if (input.returnItems.length === 0) {
        throw new Error('Debes seleccionar al menos un ítem para devolver')
      }
      if (input.returnItems.some((r) => r.qty <= 0)) {
        throw new Error('La cantidad a devolver debe ser mayor a 0')
      }
      if (input.type === 'exchange' && input.exchangeItems.length === 0) {
        throw new Error('Debes seleccionar al menos una variante de cambio')
      }
      if (input.type === 'exchange' && input.exchangeItems.some((e) => e.qty <= 0)) {
        throw new Error('La cantidad de cambio debe ser mayor a 0')
      }

      // Netea el cambio UNA vez: lo usan el guard de turno, la orden del cambio
      // (Paso 4) y el reembolso de la diferencia (Paso 5).
      const exchange =
        input.type === 'exchange'
          ? calculateExchangeAmounts(input.returnItems, input.exchangeItems)
          : null

      // Valor devuelto en una devolución pura (Σ pagado de los ítems devueltos).
      const returnedValue = input.returnItems.reduce(
        (sum, ri) => sum + ri.qty * ri.unit_price,
        0,
      )

      // Guard de turno: si la devolución/cambio MUEVE efectivo (reembolso en
      // efectivo o cobro de diferencia), exige turno abierto. Sin turno, el
      // egreso del reembolso se omitía en silencio (faltante fantasma) y la
      // orden del cambio quedaba con shift_id NULL (diferencia fuera del cuadre).
      if (
        returnMovesCash({
          type: input.type,
          refundMethod: input.refundMethod,
          returnedValue,
          exchangeRefundDue: exchange?.refundDue ?? 0,
          exchangeCharge: exchange?.orderTotal ?? 0,
        })
      ) {
        assertShiftForPayment(currentShift?.id)
      }

      // Bloqueo de Addi (defensa en profundidad; la UI ya bloquea antes).
      // Las ventas financiadas con Addi no admiten devoluciones ni cambios.
      const { data: origOrder, error: origErr } = await supabase
        .from('orders')
        .select('payment_method')
        .eq('id' as never, input.original_order_id)
        .eq('store_id' as never, storeId)
        .single()
      if (origErr || !origOrder) {
        throw new Error('No se pudo verificar la orden original')
      }
      if (
        !isReturnablePayment(
          (origOrder as { payment_method: string }).payment_method,
        )
      ) {
        throw new Error(ADDI_RETURN_BLOCK_MSG)
      }

      // Paso 1 — Verificar stock de variantes nuevas (agrupando duplicados)
      if (input.type === 'exchange') {
        const required = aggregateQtyByVariant(input.exchangeItems)

        for (const [variantId, qtyRequired] of required) {
          const { data: variant, error } = await supabase
            .from('variants')
            .select('stock_qty, products(name), size, color')
            .eq('id' as never, variantId)
            .eq('store_id' as never, storeId)
            .single()

          if (error || !variant) {
            throw new Error(
              'Variante de cambio no encontrada o no pertenece a esta tienda',
            )
          }

          type RawVariant = {
            stock_qty: number
            products: { name: string } | null
            size: string | null
            color: string | null
          }
          const v = variant as unknown as RawVariant

          if (v.stock_qty < qtyRequired) {
            const label = [v.products?.name, v.size, v.color]
              .filter(Boolean)
              .join(' ')
            throw new Error(
              `Sin stock disponible para ${label} (requeridas: ${qtyRequired}, disponible: ${v.stock_qty})`,
            )
          }
        }
      }

      // Paso 2 — INSERT returns
      const { data: returnRecord, error: returnErr } = await supabase
        .from('returns')
        .insert({
          original_order_id: input.original_order_id,
          store_id: storeId,
          created_by: userId,
          type: input.type,
          status: 'completed',
          notes: input.notes.trim() || null,
        } as never)
        .select()
        .single()

      if (returnErr || !returnRecord) {
        throw new Error(
          returnErr?.message ?? 'No se pudo registrar la devolución',
        )
      }
      const ret = returnRecord as Return

      // Paso 3 — INSERT return_items (el trigger repone stock automáticamente)
      const { error: itemsErr } = await supabase.from('return_items').insert(
        input.returnItems.map((ri) => ({
          return_id: ret.id,
          variant_id: ri.variant_id,
          qty: ri.qty,
          unit_price: ri.unit_price,
          action: input.type === 'return' ? 'refund' : 'exchange',
        })) as never,
      )

      if (itemsErr) {
        // Rollback manual: la fila returns quedó huérfana. ON DELETE CASCADE
        // limpia los return_items (en caso de que alguno sí entró).
        await supabase.from('returns').delete().eq('id' as never, ret.id)
        throw new Error(
          `No se pudieron registrar los ítems devueltos: ${itemsErr.message}`,
        )
      }

      // Paso 4 — Si es cambio: registrar SOLO la diferencia de precio como
      // venta (no el valor completo del producto nuevo). La orden lleva los
      // ítems nuevos como order_items para que el trigger deduct_stock_on_sale
      // descuente su stock, pero el total se netea con un descuento que acredita
      // los ítems devueltos: subtotal = valor nuevos, descuento = min(devueltos,
      // nuevos), total = max(0, diferencia). Así reportes no se inflan y caja
      // refleja solo el movimiento real.
      if (input.type === 'exchange' && exchange) {
        const { data: newOrder, error: orderErr } = await supabase
          .from('orders')
          .insert({
            store_id: storeId,
            customer_id: input.customer_id,
            created_by: userId,
            status: 'completed',
            subtotal: exchange.orderSubtotal,
            discount: exchange.orderDiscount,
            total: exchange.orderTotal,
            payment_method: input.refundMethod,
            cash_received: null,
            // Marca la orden como ingreso por devolución (diferencia de cambio),
            // para mostrarla en la sección Devoluciones del cuadre, no en Ventas.
            return_id: ret.id,
            // Imputa la diferencia cobrada al turno abierto (026). Antes se
            // insertaba SIN shift_id → la diferencia quedaba fuera del cuadre
            // aunque hubiera turno. El guard garantiza turno si orderTotal > 0.
            shift_id: currentShift?.id ?? null,
          } as never)
          .select()
          .single()

        if (orderErr || !newOrder) {
          // La devolución ya está confirmada; no podemos revertirla sin RPC.
          // Avisamos al usuario para que cree la venta manualmente.
          throw new Error(
            `Devolución registrada pero falló crear la orden de cambio: ${
              orderErr?.message ?? 'desconocido'
            }. Crea la venta manualmente.`,
          )
        }

        const order = newOrder as { id: string }

        const { error: exchItemsErr } = await supabase.from('order_items').insert(
          input.exchangeItems.map((i) => ({
            order_id: order.id,
            variant_id: i.variant_id,
            product_id: i.product_id,
            qty: i.qty,
            // El ítem NUEVO del cambio va a precio de catálogo (sin redescuento):
            // unit_price = list_price = catálogo del nuevo. El descuento del
            // original se netea a nivel de orden (order.discount), no por línea.
            unit_price: i.unit_price,
            list_price: i.list_price,
          })) as never,
        )

        if (exchItemsErr) {
          // La orden quedó huérfana sin ítems (y sin descontar stock).
          // ON DELETE CASCADE limpia order_items si alguno entró.
          await supabase.from('orders').delete().eq('id' as never, order.id)
          throw new Error(
            `Devolución registrada pero falló agregar los ítems de cambio: ${exchItemsErr.message}. Crea la venta manualmente.`,
          )
        }
      }

      // Paso 5 — Reflejar el dinero que SALE de la caja en el cuadre del turno,
      // solo si el reembolso es en efectivo y hay turno abierto:
      //  · Devolución pura → se reembolsa el valor de los ítems devueltos.
      //  · Cambio → solo si el producto nuevo es MÁS BARATO se devuelve la
      //    diferencia (refundDue); si es más caro, el cliente paga y eso ya
      //    entró como venta en la orden del Paso 4 (sin egreso).
      if (input.refundMethod === 'cash') {
        const refundTotal =
          input.type === 'exchange' ? (exchange?.refundDue ?? 0) : returnedValue
        if (refundTotal > 0) {
          // El guard de turno ya garantizó turno abierto para un reembolso en
          // efectivo, así que currentShift está presente. Se imputa al turno de
          // la TIENDA (026); antes se buscaba por opened_by = userId, que fallaba
          // si otro cajero de la tienda había abierto el turno.
          const shiftId = currentShift?.id ?? null
          if (shiftId) {
            const reason =
              input.type === 'exchange'
                ? `Devolución por cambio #${input.original_order_number}`
                : `Devolución venta #${input.original_order_number}`
            const { error: expErr } = await supabase
              .from('cash_expenses')
              .insert({
                shift_id: shiftId,
                store_id: storeId,
                amount: refundTotal,
                reason,
                // Categoriza el egreso como reembolso de devolución → sección
                // Devoluciones del cuadre (separado de gastos normales).
                kind: 'return',
                return_id: ret.id,
                notes: input.notes.trim() || null,
                created_by: userId,
              } as never)
            if (expErr) {
              // La devolución ya se confirmó; no la revertimos por un fallo de
              // caja. Avisamos para registrar el egreso manualmente.
              toast.error(
                `Devolución registrada, pero no se reflejó en caja: ${expErr.message}. Regístralo como egreso manual.`,
              )
            }
          }
        }
      }

      return ret
    },

    onSuccess: () => {
      // Invalidar todo lo que muestre stock o devoluciones.
      // React Query hace match por prefijo, así que ['returns'] cubre
      // ['returns', 'history'], ['returns', 'order-detail'], etc.
      void queryClient.invalidateQueries({ queryKey: ['returns'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      // El reembolso/cambio en efectivo afecta el cuadre del turno.
      void queryClient.invalidateQueries({ queryKey: ['shift-expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['shift-closing'] })
      void queryClient.invalidateQueries({ queryKey: ['cash-shifts'] })
      toast.success('Devolución registrada exitosamente')
    },

    onError: (err: Error) => toast.error(err.message),
  })
}
