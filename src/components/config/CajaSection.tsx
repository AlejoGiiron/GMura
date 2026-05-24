import { useState, useEffect, useRef } from 'react'
import { CreditCard, Plus, Trash2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, resolveConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_KEYS,
  migrateLegacyPaymentMethods,
} from '@/lib/paymentMethods'
import type { PaymentMethod } from '@/types/database.types'

export default function CajaSection() {
  const { data: store, isLoading } = useStoreConfig()
  const { updateStoreConfig, uploadPaymentQR } = useConfigMutations()
  const fileRef = useRef<HTMLInputElement>(null)

  const [reasons, setReasons] = useState<string[]>([])
  const [newReason, setNewReason] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    const cfg = resolveConfig(store.config)
    setReasons(cfg.adjustment_reasons)
    setPaymentMethods(migrateLegacyPaymentMethods(cfg.payment_methods))
    setPaymentQrUrl(cfg.payment_qr_url)
  }, [store])

  function addReason() {
    const v = newReason.trim()
    if (!v) return
    if (reasons.includes(v)) {
      toast.error('Ese motivo ya existe')
      return
    }
    setReasons([...reasons, v])
    setNewReason('')
  }

  function togglePayment(value: PaymentMethod) {
    setPaymentMethods((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value],
    )
  }

  async function handlePaymentQR(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen')
      return
    }
    try {
      const url = await uploadPaymentQR.mutateAsync(file)
      setPaymentQrUrl(url)
      await updateStoreConfig.mutateAsync({ payment_qr_url: url })
      toast.success('QR de pagos actualizado')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        adjustment_reasons: reasons,
        payment_methods: paymentMethods,
      })
      toast.success('Configuración de caja guardada')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-100 text-violet-600">
          <CreditCard size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Configuración de caja</h2>
          <p className="text-xs text-[#737373]">Ajustes, métodos de pago y QR para pagos</p>
        </div>
      </div>

      <div className="divide-y divide-[#f5f4f1]">
        {/* Adjustment reasons */}
        <div className="px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Motivos de ajuste de inventario
          </p>
          <div className="space-y-1">
            {reasons.map((reason, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2"
              >
                <span className="flex-1 text-sm text-[#1a1a1a]">{reason}</span>
                <button
                  onClick={() => setReasons(reasons.filter((_, i) => i !== idx))}
                  className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addReason() }}
              placeholder="Nuevo motivo"
              className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <button
              onClick={addReason}
              disabled={!newReason.trim()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus size={13} />
              Agregar
            </button>
          </div>
        </div>

        {/* Payment methods */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Métodos de pago habilitados
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHOD_KEYS.map((value) => {
              const meta = PAYMENT_METHODS[value]
              const Icon = meta.icon
              const checked = paymentMethods.includes(value)
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    checked
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePayment(value)}
                    className="h-4 w-4 accent-violet-500"
                  />
                  <Icon size={14} style={{ color: meta.hex }} />
                  <span className="text-sm font-medium text-[#1a1a1a]">{meta.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Payment QR (sirve para Transferencia) */}
        {paymentMethods.includes('transfer') && (
          <div className="px-5 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              QR para pagos
            </p>
            <div className="flex items-start gap-4">
              {paymentQrUrl ? (
                <img
                  src={paymentQrUrl}
                  alt="QR para pagos"
                  className="h-24 w-24 rounded-lg border border-[#ebe9e6] object-contain"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg border-[1.5px] border-dashed border-[#d6d3d1] bg-[#fafaf9] text-[#a8a29e]">
                  <Upload size={20} />
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handlePaymentQR(e)}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadPaymentQR.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-50"
                >
                  <Upload size={12} />
                  {paymentQrUrl ? 'Cambiar QR' : 'Subir QR'}
                </button>
                <p className="mt-1.5 text-[11px] text-[#a8a29e]">
                  Se muestra al cobrar con Transferencia
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#8b5cf6] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
