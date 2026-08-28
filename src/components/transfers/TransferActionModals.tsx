import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  useCancelTransferDraft,
  useRevertTransferDispatch,
} from '@/hooks/useTransferMutations'
import { formatTransferNumber } from '@/lib/transfers'
import { InlineAlert } from './TransferPieces'

// ─────────────────────────────────────────────────────────────────────────────
// Las dos RPC sin pantalla propia (handoff §0.3). Son acciones de EXCEPCIÓN:
// viven en el menú "···" de la fila, nunca como botón primario.
// ─────────────────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[540px] flex-col rounded-[14px] bg-white shadow-xl">
        <header className="flex flex-shrink-0 items-start justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-neutral-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-stone-100 hover:text-neutral-600"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-stone-200 px-5 py-3.5">
          {footer}
        </footer>
      </div>
    </div>
  )
}

// ── Descartar borrador ────────────────────────────────────────────────────────

export function CancelDraftModal({
  transferId,
  transferNumber,
  onClose,
}: {
  transferId: string
  transferNumber: number
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const cancel = useCancelTransferDraft()

  return (
    <ModalShell
      title={`Descartar el borrador ${formatTransferNumber(transferNumber)}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-[13px] font-semibold text-neutral-700 hover:bg-stone-50"
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              cancel.mutate({ transferId, reason }, { onSuccess: onClose })
            }
            disabled={cancel.isPending}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-[13px] font-semibold text-white hover:bg-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {cancel.isPending ? 'Descartando…' : 'Descartar borrador'}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-snug text-neutral-600">
        El borrador queda anulado y no se puede seguir editando. No se movió stock, así que no
        hay nada que devolver.
      </p>
      <label className="mt-4 block">
        <span className="text-[12.5px] font-semibold text-neutral-700">
          Motivo <span className="font-normal text-neutral-400">(opcional)</span>
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. Se armó por error."
          className="mt-1.5 w-full rounded-lg border border-stone-200 px-3 py-2 text-[13px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
        />
      </label>
    </ModalShell>
  )
}

// ── Revertir despacho ─────────────────────────────────────────────────────────

export function RevertDispatchModal({
  transferId,
  transferNumber,
  units,
  fromStoreName,
  onClose,
}: {
  transferId: string
  transferNumber: number
  units: number
  fromStoreName: string
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const revert = useRevertTransferDispatch()
  // Mismo patrón que el checkbox del despacho: el botón no se habilita hasta
  // cumplir el mínimo, en vez de dejar clickear y fallar.
  const valid = reason.trim().length >= 5

  return (
    <ModalShell
      title={`Revertir el despacho de ${formatTransferNumber(transferNumber)}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-[13px] font-semibold text-neutral-700 hover:bg-stone-50"
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              revert.mutate({ transferId, reason: reason.trim() }, { onSuccess: onClose })
            }
            disabled={!valid || revert.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          >
            {revert.isPending ? 'Revirtiendo…' : 'Revertir despacho'}
          </button>
        </>
      }
    >
      <InlineAlert tone="warning">
        Las <span className="font-mono font-semibold">{units}</span> unidades vuelven al stock de{' '}
        {fromStoreName} y el traslado queda anulado.
      </InlineAlert>

      <label className="mt-4 block">
        <span className="text-[12.5px] font-semibold text-neutral-700">Motivo</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          placeholder="Ej. La encomienda no salió, se despachó por error."
          className="mt-1.5 w-full rounded-lg border border-stone-200 px-3 py-2 text-[13px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
        />
        <span className="mt-1 block text-[11.5px] text-neutral-400">Mínimo 5 caracteres.</span>
      </label>
    </ModalShell>
  )
}
