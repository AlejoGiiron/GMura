import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, TriangleAlert, Truck } from 'lucide-react'
import { useDispatchTransfer } from '@/hooks/useTransferMutations'
import { formatTransferMoney, formatTransferNumber } from '@/lib/transfers'
import { KeyValueRow, RpcErrorBlock } from './TransferPieces'
import type { BuilderSummary } from '@/lib/transferBuilder'

interface DispatchModalProps {
  transferId: string
  transferNumber: number
  fromStoreName: string
  toStoreName: string
  summary: BuilderSummary
  carrier: string | null
  trackingRef: string | null
  onClose: () => void
  onDispatched: () => void
}

/**
 * §1.3 y §5.5 — el modal de despacho.
 *
 * Su trabajo es que el usuario entienda que esto TIENE CONSECUENCIA sobre el
 * stock. El bloque ámbar no es decorativo: es la única explicación de que la
 * mercancía queda invendible en las dos tiendas. Sus textos NO se reescriben.
 */
export default function DispatchModal({
  transferId,
  transferNumber,
  fromStoreName,
  toStoreName,
  summary,
  carrier,
  trackingRef,
  onClose,
  onDispatched,
}: DispatchModalProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [done, setDone] = useState(false)
  const dispatch = useDispatchTransfer()
  const checkboxRef = useRef<HTMLInputElement>(null)

  // §4.3 — el foco entra en el CHECKBOX, no en el botón primario: que un Enter
  // reflejo no despache.
  useEffect(() => {
    checkboxRef.current?.focus()
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dispatch.isPending) onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, dispatch.isPending])

  function handleDispatch() {
    dispatch.mutate(transferId, { onSuccess: () => setDone(true) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[540px] flex-col rounded-[14px] bg-white shadow-xl">
        {done ? (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-7 text-center">
              <CheckCircle2 size={40} className="mx-auto text-green-600" />
              <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-neutral-900">
                Traslado despachado
              </h2>
              <p className="mx-auto mt-2 max-w-[400px] text-[13px] leading-snug text-neutral-600">
                <span className="font-mono font-semibold">{summary.units}</span> unidades salieron
                de {fromStoreName} y están en tránsito hacia {toStoreName}. El encargado de{' '}
                {toStoreName} ya lo ve en «Por recibir».
              </p>
              <div className="mx-auto mt-5 max-w-[380px] rounded-xl border border-stone-200 px-4 py-2">
                <KeyValueRow label="Traslado" value={formatTransferNumber(transferNumber)} mono />
                <KeyValueRow label="Productos" value={summary.products} mono />
                <KeyValueRow label="Unidades" value={summary.units} mono />
                <KeyValueRow label="Guía" value={trackingRef ?? '—'} mono />
              </div>
            </div>
            <footer className="flex flex-shrink-0 justify-end border-t border-stone-200 px-5 py-3.5">
              <button
                onClick={onDispatched}
                className="rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-700"
              >
                Ir a traslados
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="flex-shrink-0 px-6 pb-3 pt-5">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-neutral-900">
                Despachar el traslado a {toStoreName}
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-neutral-600">
                Este paso mueve el stock. Después de despachar, el traslado deja de ser un
                borrador y no se puede editar.
              </p>
            </header>

            <div className="flex-1 overflow-y-auto px-6">
              {dispatch.isError && (
                <div className="mb-3">
                  <RpcErrorBlock message={(dispatch.error as Error).message} />
                </div>
              )}

              <section className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-amber-800">
                  <TriangleAlert size={14} />
                  Qué pasa al despachar
                </p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-amber-800">
                  <li>
                    • Las <span className="font-mono font-semibold">{summary.units}</span> unidades
                    salen del stock de {fromStoreName} de inmediato.
                  </li>
                  <li>
                    • Quedan <strong>en tránsito</strong>: no se pueden vender en {fromStoreName}{' '}
                    ni en {toStoreName}.
                  </li>
                  <li>
                    • {toStoreName} ve el envío en «Por recibir» y lo confirma al llegar.
                  </li>
                </ul>
              </section>

              <div className="mt-3 rounded-xl border border-stone-200 px-4 py-2">
                <KeyValueRow label="Productos" value={summary.products} mono />
                <KeyValueRow label="Unidades" value={summary.units} mono />
                <KeyValueRow
                  label="Valor a precio de venta"
                  value={formatTransferMoney(summary.value)}
                  mono
                />
                <KeyValueRow label="Envío" value={carrier ?? 'Sin definir'} />
                <KeyValueRow label="Guía" value={trackingRef ?? '—'} mono />
                {summary.newProduct > 0 && (
                  <KeyValueRow
                    label="Fichas nuevas que se crearán allá"
                    value={summary.newProduct}
                    mono
                  />
                )}
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                <input
                  ref={checkboxRef}
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-[2px] h-[15px] w-[15px] accent-violet-600"
                />
                <span className="text-[13px] text-neutral-700">
                  Confirmo que la mercancía ya está empacada y sale de {fromStoreName}.
                </span>
              </label>
            </div>

            <footer className="mt-4 flex flex-shrink-0 items-center justify-end gap-2 border-t border-stone-200 px-5 py-3.5">
              <button
                onClick={onClose}
                disabled={dispatch.isPending}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-[13px] font-semibold text-neutral-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Volver al borrador
              </button>
              <button
                onClick={handleDispatch}
                // Sin el checkbox el primario está deshabilitado, en gris y sin
                // sombra. No se pide escribir el nombre de la tienda: la acción
                // es reversible con revert_transfer_dispatch, así que una
                // confirmación tipada sería fricción excesiva.
                disabled={!confirmed || dispatch.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
              >
                <Truck size={15} />
                {dispatch.isPending ? 'Despachando…' : 'Despachar y mover el stock'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
