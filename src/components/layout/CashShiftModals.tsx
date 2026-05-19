import { useEffect, useState } from 'react'
import { X, Wallet, Banknote } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useCashShiftMutations } from '@/hooks/useCashShiftMutations'
import { useCashShiftSales } from '@/hooks/useCashShift'
import type { CashShift } from '@/types/database.types'

function parseCOP(value: string): number {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 0
  return parseInt(digits, 10)
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

// ─── Modal: Abrir turno ───────────────────────────────────────────────────────

interface OpenShiftModalProps {
  onClose: () => void
}

export function OpenShiftModal({ onClose }: OpenShiftModalProps) {
  const { openShift } = useCashShiftMutations()
  const [amount, setAmount] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openShift.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, openShift.isPending])

  const parsed = parseCOP(amount)

  function handleSubmit() {
    openShift.mutate(parsed, { onSuccess: onClose })
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !openShift.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
              <Wallet size={18} className="text-violet-600" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Abrir turno de caja
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                Registra el monto inicial en efectivo.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={openShift.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Monto inicial en caja
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="0"
              inputMode="numeric"
              className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
            />
            <span className="text-xs text-[#a8a29e]">COP</span>
          </div>
          {parsed > 0 && (
            <p className="mt-1.5 text-xs text-[#737373]">{fmtCOP(parsed)}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={openShift.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={openShift.isPending}
            className="h-10 flex-1 rounded-lg bg-violet-600 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:cursor-wait disabled:opacity-70"
          >
            {openShift.isPending ? 'Abriendo…' : 'Abrir turno'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Cerrar turno ──────────────────────────────────────────────────────

interface CloseShiftModalProps {
  shift: CashShift
  onClose: () => void
}

export function CloseShiftModal({ shift, onClose }: CloseShiftModalProps) {
  const { closeShift } = useCashShiftMutations()
  const { data: cashSales = 0, isLoading: loadingSales } = useCashShiftSales(
    shift.opened_at,
  )
  const [contado, setContado] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeShift.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, closeShift.isPending])

  const openingAmount = Number(shift.opening_amount)
  const expected = openingAmount + cashSales
  const real = parseCOP(contado)
  const diff = real - expected
  const hasInput = contado.length > 0

  function handleSubmit() {
    closeShift.mutate(
      { shift_id: shift.id, closing_amount: real },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !closeShift.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <Banknote size={18} className="text-amber-700" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Cerrar turno
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                Confirma el monto contado en caja.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={closeShift.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="mb-5 space-y-2 rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-[#737373]">Apertura</span>
            <span className="font-mono font-medium text-[#1a1a1a]">
              {fmtCOP(openingAmount)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#737373]">Hora apertura</span>
            <span className="font-medium text-[#1a1a1a]">
              {formatTime(shift.opened_at)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#737373]">Ventas en efectivo</span>
            <span className="font-mono font-medium text-[#1a1a1a]">
              {loadingSales ? '…' : fmtCOP(cashSales)}
            </span>
          </div>
          <div className="flex justify-between border-t border-[#ebe9e6] pt-2">
            <span className="font-semibold text-[#1a1a1a]">Esperado en caja</span>
            <span className="font-mono text-base font-bold text-[#1a1a1a]">
              {fmtCOP(expected)}
            </span>
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Monto real contado
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              autoFocus
              value={contado}
              onChange={(e) => setContado(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && hasInput && handleSubmit()}
              placeholder="0"
              inputMode="numeric"
              className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
            />
            <span className="text-xs text-[#a8a29e]">COP</span>
          </div>
        </div>

        {hasInput && (
          <div
            className={`mb-5 flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
              diff === 0
                ? 'border-green-200 bg-green-50'
                : diff > 0
                  ? 'border-violet-200 bg-violet-50'
                  : 'border-red-200 bg-red-50'
            }`}
          >
            <span className="font-medium text-[#1a1a1a]">
              {diff === 0
                ? 'Cuadra exacto'
                : diff > 0
                  ? 'Sobrante'
                  : 'Faltante'}
            </span>
            <span
              className={`font-mono text-base font-bold ${
                diff === 0
                  ? 'text-green-700'
                  : diff > 0
                    ? 'text-violet-700'
                    : 'text-red-700'
              }`}
            >
              {diff === 0
                ? fmtCOP(0)
                : diff > 0
                  ? `+${fmtCOP(diff)}`
                  : fmtCOP(diff)}
            </span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={closeShift.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={closeShift.isPending || !hasInput}
            className="h-10 flex-1 rounded-lg bg-violet-600 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {closeShift.isPending ? 'Cerrando…' : 'Cerrar turno'}
          </button>
        </div>
      </div>
    </div>
  )
}
