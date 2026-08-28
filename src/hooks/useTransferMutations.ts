import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import type { Transfer, TransferDestAction } from '@/types/database.types'

// ─────────────────────────────────────────────────────────────────────────────
// Mutations del módulo de traslados. TODAS pasan por las RPC SECURITY DEFINER
// de la migración 041: las tablas transfers / transfer_items no tienen política
// de escritura ni GRANT de INSERT/UPDATE, así que no hay otro camino posible.
//
// Los mensajes de error de las RPC ya vienen en ESPAÑOL y redactados para el
// usuario final ("Stock insuficiente para X: disponible 1, requerido 2"), así
// que el toast los muestra tal cual en vez de inventar uno genérico.
//
// El `as never` en supabase.rpc es la convención vigente del proyecto: los tipos
// generados de Supabase no incluyen las funciones, así que el cliente no las
// conoce (ver useStores.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface TransferItemInput {
  from_variant_id: string
  qty: number
  dest_action: TransferDestAction
  /** Requerido para map_variant. */
  to_variant_id?: string | null
  /** Requerido para map_product. */
  to_product_id?: string | null
}

export interface SaveTransferDraftInput {
  to_store_id: string
  items: TransferItemInput[]
  /** Presente = editar ese borrador (reemplaza TODAS sus líneas). */
  transfer_id?: string | null
  carrier?: string | null
  tracking_ref?: string | null
  notes?: string | null
}

/**
 * Invalidación amplia: un traslado toca stock en DOS tiendas, así que además de
 * las queries del módulo hay que refrescar todo lo que lee inventario. La
 * recepción puede además CREAR productos y variantes en el destino.
 */
function invalidateTransferQueries(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [
    'transfers',
    // El badge del sidebar es lo primero que la gente mira: si no se invalida,
    // alguien confirma una recepción y sigue viendo "3" media hora (§4.5).
    'transfers-incoming-count',
    'transfer-status-counts',
    'transfer-detail',
    'transfer-targets',
    'inventory',
    'variants',
    'products',
    'pos-products',
    'stock-movements',
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

// ── useSaveTransferDraft ──────────────────────────────────────────────────────

export function useSaveTransferDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveTransferDraftInput): Promise<Transfer> => {
      if (!input.to_store_id) throw new Error('Elegí la tienda destino')
      if (!input.items.length) throw new Error('Agregá al menos un ítem al traslado')

      const { data, error } = await supabase.rpc('save_transfer_draft' as never, {
        p_to_store_id: input.to_store_id,
        p_items: input.items.map((i) => ({
          from_variant_id: i.from_variant_id,
          qty: i.qty,
          dest_action: i.dest_action,
          to_variant_id: i.to_variant_id ?? null,
          to_product_id: i.to_product_id ?? null,
        })),
        p_transfer_id: input.transfer_id ?? null,
        p_carrier: input.carrier ?? null,
        p_tracking_ref: input.tracking_ref ?? null,
        p_notes: input.notes ?? null,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: (transfer, input) => {
      invalidateTransferQueries(queryClient)
      toast.success(
        input.transfer_id
          ? `Traslado #${transfer.transfer_number} actualizado`
          : `Traslado #${transfer.transfer_number} guardado como borrador`,
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useDispatchTransfer ───────────────────────────────────────────────────────
// Descuenta el stock del ORIGEN y deja el traslado en tránsito: a partir de acá
// la mercancía no es vendible en NINGUNA de las dos tiendas.

export function useDispatchTransfer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (transferId: string): Promise<Transfer> => {
      const { data, error } = await supabase.rpc('dispatch_transfer' as never, {
        p_transfer_id: transferId,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: (transfer) => {
      invalidateTransferQueries(queryClient)
      toast.success(`Traslado #${transfer.transfer_number} despachado — va en camino`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useReceiveTransfer ────────────────────────────────────────────────────────
// Suma el stock en el DESTINO, creando o mapeando la variante según lo que se
// eligió al armar. p_counts queda reservado para la fase de conteo por línea;
// hoy la RPC lo rechaza, así que ni se envía.

export function useReceiveTransfer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (transferId: string): Promise<Transfer> => {
      const { data, error } = await supabase.rpc('receive_transfer' as never, {
        p_transfer_id: transferId,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: (transfer) => {
      invalidateTransferQueries(queryClient)
      toast.success(`Traslado #${transfer.transfer_number} recibido`)
      // La etiqueta que viajó pegada a la prenda NO escanea acá: el barcode es
      // único global, así que la variante del destino tiene el suyo propio.
      toast('Reimprimí las etiquetas de lo recibido para poder venderlo con lectora', {
        icon: '🏷️',
        duration: 6000,
      })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useRevertTransferDispatch ─────────────────────────────────────────────────
// Devuelve el stock al ORIGEN. Solo desde 'in_transit' y solo la tienda origen.

export function useRevertTransferDispatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { transferId: string; reason: string }): Promise<Transfer> => {
      if (input.reason.trim().length < 5) {
        throw new Error('Indicá el motivo de la reversión (al menos 5 caracteres)')
      }
      const { data, error } = await supabase.rpc('revert_transfer_dispatch' as never, {
        p_transfer_id: input.transferId,
        p_reason: input.reason.trim(),
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: (transfer) => {
      invalidateTransferQueries(queryClient)
      toast.success(`Despacho del #${transfer.transfer_number} revertido — el stock volvió al origen`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useUpdateTransferShipping ─────────────────────────────────────────────────
// Edita SOLO transportadora, guía y notas (RPC de la 043). El caso real: la guía
// se consigue después de despachar. Solo la tienda de ORIGEN, y solo mientras el
// traslado esté en borrador o en tránsito.

export interface UpdateShippingInput {
  transferId: string
  carrier: string | null
  trackingRef: string | null
  notes: string | null
}

export function useUpdateTransferShipping() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateShippingInput): Promise<Transfer> => {
      const { data, error } = await supabase.rpc('update_transfer_shipping' as never, {
        p_transfer_id: input.transferId,
        p_carrier: input.carrier,
        p_tracking_ref: input.trackingRef,
        p_notes: input.notes,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: () => {
      // No mueve stock: alcanza con refrescar el módulo.
      void queryClient.invalidateQueries({ queryKey: ['transfers'] })
      void queryClient.invalidateQueries({ queryKey: ['transfer-detail'] })
      toast.success('Datos del envío actualizados')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useMarkLabelsPrinted ──────────────────────────────────────────────────────
// Persiste que las etiquetas del destino se imprimieron (RPC de la 043b). Solo
// la tienda DESTINO. Idempotente: volver a imprimir pisa el timestamp.
//
// Sin toast: la confirmación visible es que el bloque de la pantalla pasa de
// rojo a verde. Un toast encima sería ruido sobre algo que ya se ve.

export function useMarkLabelsPrinted() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (transferId: string): Promise<Transfer> => {
      const { data, error } = await supabase.rpc('mark_transfer_labels_printed' as never, {
        p_transfer_id: transferId,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transfer-detail'] })
      void queryClient.invalidateQueries({ queryKey: ['transfers'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── useCancelTransferDraft ────────────────────────────────────────────────────
// Descarta un BORRADOR. No toca stock (un borrador nunca lo movió). Se anula, no
// se borra: la fila y el número quedan, como el resto de la casa.

export function useCancelTransferDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { transferId: string; reason?: string }): Promise<Transfer> => {
      const { data, error } = await supabase.rpc('cancel_transfer_draft' as never, {
        p_transfer_id: input.transferId,
        p_reason: input.reason?.trim() || null,
      } as never)
      if (error) throw error
      return data as unknown as Transfer
    },
    onSuccess: (transfer) => {
      invalidateTransferQueries(queryClient)
      toast.success(`Borrador #${transfer.transfer_number} descartado`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
