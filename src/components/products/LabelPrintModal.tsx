import { useState, useEffect, useRef } from 'react'
import { X, Printer, Minus, Plus } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { fmtCOP } from '@/lib/formatters'
import type { Variant } from '@/types/database.types'

// ─── Barcode SVG helpers ──────────────────────────────────────────────────────

interface BarcodeSvgProps {
  code: string
  height?: number
  width?: number
}

function BarcodeSvg({ code, height = 28, width = 1.2 }: BarcodeSvgProps) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !code) return
    try {
      JsBarcode(ref.current, code, {
        format: 'CODE128',
        width,
        height,
        displayValue: false,
        margin: 1,
      })
    } catch {
      // Código inválido — dejar el SVG vacío
    }
  }, [code, height, width])

  return <svg ref={ref} style={{ width: '100%' }} />
}

// ─── Etiqueta física 38×25mm ──────────────────────────────────────────────────

interface LabelCardProps {
  variant: Variant
  productName: string
}

function LabelCard({ variant, productName }: LabelCardProps) {
  const code = variant.barcode ?? variant.sku ?? variant.id.slice(-10)
  const truncName =
    productName.length > 22 ? `${productName.slice(0, 21)}…` : productName
  const detail = [variant.size && `T.${variant.size}`, variant.color]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="label-card"
      style={{
        width: '38mm',
        height: '25mm',
        border: '0.3mm solid #ccc',
        padding: '1mm 1.5mm',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        background: '#fff',
      }}
    >
      <p style={{ fontSize: '5.5pt', fontWeight: 700, lineHeight: 1.1, margin: 0 }}>
        {truncName}
      </p>
      {detail && (
        <p style={{ fontSize: '4.5pt', color: '#555', lineHeight: 1, margin: 0 }}>
          {detail}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <BarcodeSvg code={code} height={24} width={1} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <p style={{ fontSize: '4pt', color: '#666', fontFamily: 'monospace', margin: 0 }}>
          {(variant.sku ?? code).slice(0, 14)}
        </p>
        <p style={{ fontSize: '6.5pt', fontWeight: 700, margin: 0 }}>
          {fmtCOP(variant.price)}
        </p>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface LabelPrintModalProps {
  productName: string
  variants: Variant[]
  onClose: () => void
}

interface LabelItem {
  variant: Variant
  qty: number
}

export default function LabelPrintModal({
  productName,
  variants,
  onClose,
}: LabelPrintModalProps) {
  const [items, setItems] = useState<LabelItem[]>(() =>
    variants.map((v) => ({ variant: v, qty: 1 })),
  )

  // Inyectar estilos de impresión mientras el modal está abierto
  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'gmura-label-print-style'
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #gmura-label-print,
        #gmura-label-print * { visibility: visible !important; }
        #gmura-label-print {
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 100% !important;
          padding: 4mm !important;
          box-sizing: border-box !important;
        }
        @page { margin: 0; size: auto; }
      }
    `
    document.head.appendChild(style)
    return () => document.getElementById('gmura-label-print-style')?.remove()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function setQty(variantId: string, delta: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.variant.id === variantId
          ? { ...item, qty: Math.max(1, item.qty + delta) }
          : item,
      ),
    )
  }

  const labelsToRender = items.flatMap(({ variant, qty }) =>
    Array.from({ length: qty }, (_, i) => ({ variant, key: `${variant.id}-${i}` })),
  )

  const totalLabels = labelsToRender.length

  return (
    <>
      {/* Contenedor de impresión (invisible en pantalla) */}
      <div
        id="gmura-label-print"
        style={{
          display: 'none',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2mm' }}>
          {labelsToRender.map(({ variant, key }) => (
            <LabelCard key={key} variant={variant} productName={productName} />
          ))}
        </div>
      </div>

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 grid place-items-center"
        style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="w-[560px] max-h-[90vh] overflow-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-6">
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Imprimir etiquetas
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                {productName} ·{' '}
                {totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
            >
              <X size={14} className="text-[#525252]" />
            </button>
          </div>

          {/* Cantidad por variante */}
          <div className="space-y-3 px-7 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Cantidad por variante
            </p>
            {items.map(({ variant, qty }) => (
              <div
                key={variant.id}
                className="flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-14 shrink-0">
                    <BarcodeSvg
                      code={variant.barcode ?? variant.sku ?? variant.id.slice(-8)}
                      height={14}
                      width={1}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">
                      {[variant.size && `Talla ${variant.size}`, variant.color]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    <p className="text-xs text-[#737373]">
                      {variant.sku ?? variant.barcode ?? '—'} · {fmtCOP(variant.price)}
                    </p>
                  </div>
                </div>
                <div className="flex h-8 items-center overflow-hidden rounded-lg border border-[#ebe9e6] bg-white">
                  <button
                    onClick={() => setQty(variant.id, -1)}
                    disabled={qty <= 1}
                    className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5] disabled:opacity-40"
                  >
                    <Minus size={11} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">
                    {qty}
                  </span>
                  <button
                    onClick={() => setQty(variant.id, 1)}
                    className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5]"
                  >
                    <Plus size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Vista previa */}
          <div className="border-t border-[#f5f4f1] px-7 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Vista previa
            </p>
            <div className="flex items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-6">
              {items[0] && (
                <LabelCard
                  variant={items[0].variant}
                  productName={productName}
                />
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-[#a8a29e]">
              Escala real: 38 × 25 mm
            </p>
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
              onClick={() => window.print()}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95"
            >
              <Printer size={14} />
              Imprimir {totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
