import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, ClipboardCheck } from 'lucide-react'
import { useAdjustStock } from '@/hooks/useInventoryMutations'
import { useResolvedConfig } from '@/hooks/useConfig'
import { getColorHex } from '@/lib/products'
import {
  buildAdjustReason,
  computeAdjustment,
  isValidAdjustDetail,
  type AdjustMode,
} from '@/lib/stockAdjust'

// Diálogo de "Ajustar stock" (RPC adjust_variant_stock, 045). Es la única forma
// de cambiar el stock a mano: desde Productos (panel de variantes y matriz) y
// desde Inventario. Pide cantidad y motivo, y el movimiento queda registrado
// con quién lo hizo.

export interface StockAdjustVariant {
  id: string
  productName: string
  size: string | null
  color: string | null
  stock_qty: number
  reserved_qty: number
}

interface Props {
  variant: StockAdjustVariant
  onClose: () => void
  /** Después de un ajuste exitoso (antes de cerrar). */
  onDone?: () => void
  /** Si se pasa, muestra una X en la tarjeta para elegir otra variante. */
  onChangeVariant?: () => void
}

const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]'
const inputCls =
  'w-full rounded-lg border border-[#ebe9e6] bg-white text-sm outline-none transition-[border-color,box-shadow] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_#8b5cf61a]'

export default function StockAdjustDialog({ variant, onClose, onDone, onChangeVariant }: Props) {
  const reasons = useResolvedConfig().adjustment_reasons
  const adjust = useAdjustStock()

  const [mode, setMode] = useState<AdjustMode>('delta')
  const [tipo, setTipo] = useState<string>(reasons[0] ?? 'Otro')
  const [qty, setQty] = useState('')
  const [detalle, setDetalle] = useState('')
  const qtyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    qtyRef.current?.focus()
  }, [mode])

  // Al pasar a conteo, sugerir el tipo de conteo si la tienda lo tiene.
  function changeMode(next: AdjustMode) {
    setMode(next)
    setQty('')
    if (next === 'count') {
      const conteo = reasons.find((r) => r.toLowerCase().includes('conteo'))
      if (conteo) setTipo(conteo)
    }
  }

  const calc = useMemo(
    () =>
      computeAdjustment({
        mode,
        qtyInput: qty,
        current: variant.stock_qty,
        reserved: variant.reserved_qty,
      }),
    [mode, qty, variant.stock_qty, variant.reserved_qty],
  )

  const detailOk = isValidAdjustDetail(detalle)
  const canSubmit = calc.delta !== null && calc.delta !== 0 && !calc.error && detailOk && !adjust.isPending

  function handleSubmit() {
    if (!canSubmit || calc.delta === null) return
    adjust.mutate(
      {
        variantId: variant.id,
        delta: calc.delta,
        reason: buildAdjustReason(tipo, detalle),
        expectedQty: calc.expectedQty,
      },
      {
        onSuccess: () => {
          onDone?.()
          onClose()
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-[540px] max-w-[calc(100vw-32px)] overflow-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-6">
          <div>
            <h2
              className="tracking-[-0.025em]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 600, color: '#1a1a1a' }}
            >
              Ajustar stock
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Queda registrado quién lo hizo y por qué.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
            aria-label="Cerrar"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="space-y-5 px-7 py-6">
          {/* Variante */}
          <div className="flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3">
            <div className="flex items-center gap-3">
              {variant.color && (
                <span
                  className="h-5 w-5 shrink-0 rounded-full"
                  style={{ background: getColorHex(variant.color), boxShadow: '0 0 0 1.5px #d6d3d1' }}
                />
              )}
              <div>
                <p className="text-sm font-semibold text-[#1a1a1a]">{variant.productName}</p>
                <p className="text-xs text-[#737373]">
                  {[variant.size && `Talla ${variant.size}`, variant.color].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[.05em] text-[#a8a29e]">Stock actual</p>
                <p
                  className="text-[28px] font-bold tabular-nums leading-none"
                  style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: '#1a1a1a' }}
                >
                  {variant.stock_qty}
                </p>
                {variant.reserved_qty > 0 && (
                  <p className="mt-1 text-[11px] font-medium text-violet-600">
                    {variant.reserved_qty} apartadas en separados
                  </p>
                )}
              </div>
              {onChangeVariant && (
                <button
                  onClick={onChangeVariant}
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#ebe9e6] bg-white hover:bg-[#f5f4f1]"
                  aria-label="Elegir otra variante"
                >
                  <X size={12} className="text-[#525252]" />
                </button>
              )}
            </div>
          </div>

          {/* Modo */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'delta', label: 'Sumar o restar', hint: 'Llegó, se dañó, se regaló…', icon: Plus },
              { value: 'count', label: 'Conteo físico', hint: 'Dejar en lo que contaste', icon: ClipboardCheck },
            ] as const).map((o) => (
              <button
                key={o.value}
                onClick={() => changeMode(o.value)}
                className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  mode === o.value ? 'border-violet-400 bg-violet-50' : 'border-[#ebe9e6] bg-white hover:bg-[#f8f7f5]'
                }`}
              >
                <o.icon size={16} className={mode === o.value ? 'mt-0.5 text-violet-600' : 'mt-0.5 text-[#a8a29e]'} />
                <span>
                  <span className="block text-sm font-semibold text-[#1a1a1a]">{o.label}</span>
                  <span className="block text-xs text-[#737373]">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Cantidad */}
          <div>
            <label className={labelCls}>
              {mode === 'count' ? 'Unidades contadas' : 'Cantidad'}{' '}
              {mode === 'delta' && (
                <span className="font-normal normal-case text-[#a8a29e]">(positivo = entra · negativo = sale)</span>
              )}
            </label>
            <input
              ref={qtyRef}
              type="text"
              inputMode="numeric"
              className={`${inputCls} h-10 px-3 font-mono`}
              placeholder={mode === 'count' ? 'Ej: 12' : 'Ej: 3 o -1'}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
            />
            {calc.error ? (
              <p className="mt-1.5 text-xs font-medium text-red-600">{calc.error}</p>
            ) : calc.resulting !== null && calc.delta !== null ? (
              <p className="mt-1.5 text-xs text-[#737373]">
                Queda en{' '}
                <span className="font-mono font-semibold text-emerald-600">{calc.resulting}</span>
                {' '}({calc.delta > 0 ? `+${calc.delta}` : calc.delta})
              </p>
            ) : null}
          </div>

          {/* Tipo */}
          <div>
            <label className={labelCls}>Tipo de ajuste</label>
            <select
              className={`${inputCls} h-10 appearance-none px-3 pr-8`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {reasons.map((r) => (
                <option key={r}>{r}</option>
              ))}
              {!reasons.some((r) => r.toLowerCase() === 'otro') && <option>Otro</option>}
            </select>
          </div>

          {/* Motivo */}
          <div>
            <label className={labelCls}>
              Motivo <span className="font-bold text-red-400">*</span>
            </label>
            <textarea
              className={`${inputCls} resize-y px-3 py-2.5`}
              rows={3}
              maxLength={250}
              placeholder="Qué pasó: de dónde vino o a dónde fue la mercancía"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-10 flex-1 rounded-lg bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adjust.isPending ? 'Guardando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}
