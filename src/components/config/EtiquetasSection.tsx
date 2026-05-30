import { useState, useEffect, useRef } from 'react'
import { Printer } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import type { LabelFormat, LabelFields } from '@/types/config.types'

// ─── Label Preview ────────────────────────────────────────────────────────────

const FORMAT_DIMS: Record<LabelFormat, { w: string; h: string; barcodeH: number }> = {
  '38x25': { w: '38mm', h: '25mm', barcodeH: 22 },
  '50x30': { w: '50mm', h: '30mm', barcodeH: 28 },
  '58x40': { w: '58mm', h: '40mm', barcodeH: 36 },
}

const SAMPLE_CODE = '7890123456789'

function LabelPreview({ format, fields }: { format: LabelFormat; fields: LabelFields }) {
  const ref = useRef<SVGSVGElement>(null)
  const dims = FORMAT_DIMS[format]

  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, SAMPLE_CODE, {
        format: 'CODE128',
        width: 1,
        height: dims.barcodeH,
        displayValue: false,
        margin: 0,
      })
    } catch {
      // código inválido
    }
  }, [dims.barcodeH])

  return (
    <div
      style={{
        width: dims.w,
        height: dims.h,
        border: '0.3mm solid #ccc',
        padding: '1mm 1.5mm',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {fields.name && (
        <p style={{ fontSize: '5.5pt', fontWeight: 700, lineHeight: 1.1, margin: 0 }}>
          Producto ejemplo
        </p>
      )}
      {fields.size_color && (
        <p style={{ fontSize: '4.5pt', color: '#555', lineHeight: 1, margin: 0 }}>
          T.M · Negro
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <svg ref={ref} style={{ width: '100%' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {fields.sku && (
          <p style={{ fontSize: '4pt', fontFamily: 'monospace', color: '#666', margin: 0 }}>
            SKU-001
          </p>
        )}
        {fields.price && (
          <p style={{ fontSize: '6.5pt', fontWeight: 700, margin: 0 }}>
            {fmtCOP(45000)}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<LabelFormat, string> = {
  '38x25': '38 × 25 mm (estándar)',
  '50x30': '50 × 30 mm (mediana)',
  '58x40': '58 × 40 mm (grande)',
}

export default function EtiquetasSection() {
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStoreConfig } = useConfigMutations()

  const [format, setFormat] = useState<LabelFormat>('38x25')
  const [fields, setFields] = useState<LabelFields>({
    sku: true,
    name: true,
    size_color: true,
    price: true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    setFormat(config.label_format)
    setFields(config.label_fields)
  }, [store, config])

  function toggleField(key: keyof LabelFields) {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({ label_format: format, label_fields: fields })
      toast.success('Configuración de etiquetas guardada')
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
          {[1, 2].map((i) => (
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
          <Printer size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Etiquetas de precio</h2>
          <p className="text-xs text-[#737373]">Formato, campos y vista previa</p>
        </div>
      </div>

      <div className="divide-y divide-[#f5f4f1]">
        {/* Format */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Formato de etiqueta
          </p>
          <div className="space-y-2">
            {(Object.keys(FORMAT_LABELS) as LabelFormat[]).map((f) => (
              <label
                key={f}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  format === f
                    ? 'border-violet-300 bg-violet-50'
                    : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="label-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="accent-violet-500"
                />
                <span className="text-sm font-medium text-[#1a1a1a]">{FORMAT_LABELS[f]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Fields */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Campos a mostrar
          </p>
          <div className="space-y-2">
            {/* Barcode: always active */}
            <label className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3 opacity-70">
              <input type="checkbox" checked disabled className="accent-violet-500" />
              <span className="text-sm font-medium text-[#1a1a1a]">Código de barras</span>
              <span className="ml-auto text-[11px] text-[#a8a29e]">siempre activo</span>
            </label>
            {(
              [
                { key: 'name', label: 'Nombre del producto' },
                { key: 'size_color', label: 'Talla y color' },
                { key: 'sku', label: 'SKU' },
                { key: 'price', label: 'Precio' },
              ] as { key: keyof LabelFields; label: string }[]
            ).map(({ key, label }) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  fields[key]
                    ? 'border-violet-300 bg-violet-50'
                    : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={() => toggleField(key)}
                  className="accent-violet-500"
                />
                <span className="text-sm font-medium text-[#1a1a1a]">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Vista previa
          </p>
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#fafaf9] py-8">
            <LabelPreview format={format} fields={fields} />
            <p className="mt-3 text-[11px] text-[#a8a29e]">
              Escala real: {FORMAT_LABELS[format]}
            </p>
          </div>
        </div>
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
