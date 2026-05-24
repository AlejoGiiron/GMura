import { useEffect, useState } from 'react'
import { X, Wallet, Banknote, Receipt } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useCashShiftMutations } from '@/hooks/useCashShiftMutations'
import { useCashShiftSales } from '@/hooks/useCashShift'
import { useShiftExpenses } from '@/hooks/useCashExpenses'
import { useRegisterExpense } from '@/hooks/useCashExpenseMutations'
import { useStoreConfig, resolveConfig } from '@/hooks/useConfig'
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

// ─── Modal: Registrar gasto ───────────────────────────────────────────────────

interface ExpenseModalProps {
  onClose: () => void
}

export function ExpenseModal({ onClose }: ExpenseModalProps) {
  const { data: store } = useStoreConfig()
  const config = resolveConfig(store?.config ?? null)
  const reasons = config.expense_reasons
  const registerExpense = useRegisterExpense()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<string>(reasons[0] ?? '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!reason && reasons.length > 0) setReason(reasons[0])
  }, [reasons, reason])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !registerExpense.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, registerExpense.isPending])

  const parsed = parseCOP(amount)
  const canSubmit = parsed > 0 && !!reason

  function handleSubmit() {
    if (!canSubmit) return
    registerExpense.mutate(
      { amount: parsed, reason, notes },
      {
        onSuccess: () => {
          setAmount('')
          setNotes('')
          onClose()
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !registerExpense.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
              <Receipt size={18} className="text-violet-600" />
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
                Registrar gasto
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                Egreso de efectivo del turno actual.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={registerExpense.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Monto */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Monto
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
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

        {/* Motivo (pills) */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Motivo
          </label>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => {
              const active = r === reason
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-violet-600 bg-violet-600 text-white'
                      : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-violet-300 hover:bg-violet-50'
                  }`}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notas */}
        <div className="mb-5">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Notas (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 200))}
            rows={2}
            placeholder="Detalles adicionales…"
            className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a29e] focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <p className="mt-1 text-[10px] text-[#a8a29e]">
            {notes.length}/200
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={registerExpense.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || registerExpense.isPending}
            className="h-10 flex-1 rounded-lg bg-violet-600 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {registerExpense.isPending ? 'Registrando…' : 'Registrar gasto'}
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
  const { data: expenses = [], isLoading: loadingExpenses } = useShiftExpenses(
    shift.id,
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
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const expected = openingAmount + cashSales - totalExpenses
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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
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

        {/* Lista de gastos (solo si hay) */}
        {!loadingExpenses && expenses.length > 0 && (
          <div className="mb-4 rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
              <Receipt size={11} /> Gastos del turno
            </p>
            <div className="space-y-1.5 border-b border-[#ebe9e6] pb-2.5 text-sm">
              {expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[#525252]">{e.reason}</span>
                  <span className="shrink-0 font-mono font-medium text-[#1a1a1a]">
                    {fmtCOP(Number(e.amount))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex justify-between">
              <span className="text-sm font-semibold text-[#1a1a1a]">
                Total egresos
              </span>
              <span className="font-mono text-sm font-bold text-red-700">
                -{fmtCOP(totalExpenses)}
              </span>
            </div>
          </div>
        )}

        {/* Cuadre */}
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
            <span className="text-[#737373]">+ Ventas en efectivo</span>
            <span className="font-mono font-medium text-emerald-700">
              {loadingSales ? '…' : `+${fmtCOP(cashSales)}`}
            </span>
          </div>
          {totalExpenses > 0 && (
            <div className="flex justify-between">
              <span className="text-[#737373]">− Egresos</span>
              <span className="font-mono font-medium text-red-700">
                -{fmtCOP(totalExpenses)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-[#ebe9e6] pt-2">
            <span className="font-semibold text-[#1a1a1a]">= Esperado en caja</span>
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

