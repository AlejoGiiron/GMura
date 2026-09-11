import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { X, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { useResolvedConfig } from '@/hooks/useConfig'
import { deriveLabelStyle, findLabelSize } from '@/lib/labelSizes'
import LabelPrintSurface from '@/components/print/LabelPrintSurface'
import { LABEL_PRINT_CLASS } from '@/lib/labelPrint'
import { formatTransferMoney } from '@/lib/transfers'
import type { LabelSize } from '@/types/config.types'

const PRINT_CONTAINER_ID = 'gmura-transfer-labels-print'

export interface TransferLabelLine {
  transferItemId: string
  productName: string
  brand: string | null
  size: string | null
  color: string | null
  price: number
  qty: number
  barcode: string | null
}

interface TransferLabelsModalProps {
  lines: TransferLabelLine[]
  toStoreName: string
  /** Solo listar los códigos, sin ofrecer impresión ("Ver códigos"). */
  viewOnly?: boolean
  onPrinted: () => void
  onClose: () => void
}

function BarcodeSvg({
  code,
  height = 26,
  width = 1.2,
}: {
  code: string
  height?: number
  width?: number
}) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, code, {
        format: 'CODE128',
        width,
        height,
        displayValue: false,
        margin: 1,
      })
    } catch {
      // Un código inválido deja la etiqueta sin barras; el número sigue impreso.
    }
  }, [code, height, width])
  return <svg ref={ref} style={{ width: '100%' }} />
}

/**
 * Etiquetas de las variantes DESTINO de un traslado recibido.
 *
 * Una etiqueta por unidad: si llegaron 3 de la misma variante, van 3 etiquetas.
 * Usa el tamaño de etiqueta configurado de la tienda, igual que LabelPrintModal.
 *
 * No se reusa LabelPrintModal directamente porque aquel es POR PRODUCTO
 * (recibe productName + variants de una sola ficha) y además persiste barcodes
 * generados; acá las líneas cruzan varios productos y los códigos ya existen.
 */
export default function TransferLabelsModal({
  lines,
  toStoreName,
  viewOnly = false,
  onPrinted,
  onClose,
}: TransferLabelsModalProps) {
  const config = useResolvedConfig()
  const size: LabelSize =
    findLabelSize(config.label_sizes, config.label_default_size_id) ?? config.label_sizes[0]

  // Mismo escalado que el modal de productos y que la preview de Config: si
  // la tienda usa 50x30 o 58x40, la etiqueta escala en vez de quedar con la
  // tipografia de 38x25.
  const s = deriveLabelStyle(size)

  const printable = lines.filter((l) => !!l.barcode)
  const missing = lines.length - printable.length
  const totalLabels = printable.reduce((a, l) => a + l.qty, 0)


  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function handlePrint() {
    try {
      window.print()
      // Se marca como impreso al disparar el diálogo: no hay forma fiable de
      // saber si el usuario canceló, y el costo de un falso positivo (el aviso
      // se apaga de más) es menor que el de un falso negativo (el aviso rojo
      // para siempre después de haber impreso bien).
      onPrinted()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  // Una etiqueta por unidad.
  const labels = printable.flatMap((l) =>
    Array.from({ length: l.qty }, (_, i) => ({ ...l, key: `${l.transferItemId}-${i}` })),
  )

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
          <header className="flex flex-shrink-0 items-center justify-between border-b border-stone-200 px-5 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-neutral-900">
                {viewOnly ? 'Códigos de barras' : `Etiquetas de ${toStoreName}`}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-neutral-500">
                {viewOnly
                  ? 'Los códigos nuevos de cada ficha del destino.'
                  : `${totalLabels} etiquetas · formato ${size.name} (${size.width_mm} × ${size.height_mm} mm)`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-stone-100 hover:text-neutral-600"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {missing > 0 && (
              <p className="mb-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                {missing === 1
                  ? '1 línea no tiene código de barras y no se puede imprimir.'
                  : `${missing} líneas no tienen código de barras y no se pueden imprimir.`}
              </p>
            )}

            <ul className="divide-y divide-stone-100">
              {printable.map((l) => (
                <li key={l.transferItemId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-neutral-800">
                      {l.productName}
                      {l.brand && (
                        <span className="ml-1.5 text-[10.5px] font-bold tracking-[0.06em] text-neutral-400">
                          {l.brand}
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-neutral-500">
                      T.{l.size ?? '—'} · {l.color ?? '—'}
                    </p>
                  </div>
                  <span className="font-mono text-[12.5px] text-neutral-600">{l.barcode}</span>
                  <span className="w-14 text-right font-mono text-[13px] font-semibold text-neutral-800">
                    ×{l.qty}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <footer className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-stone-200 px-5 py-3.5">
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-[13px] font-semibold text-neutral-700 hover:bg-stone-50"
            >
              Cerrar
            </button>
            {!viewOnly && (
              <button
                onClick={handlePrint}
                disabled={totalLabels === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
              >
                <Printer size={15} />
                Imprimir {totalLabels} etiquetas
              </button>
            )}
          </footer>
        </div>
      </div>

      {/* Superficie de impresión compartida con el modal de productos: portal a
          body y UNA etiqueta por página. Sin wrapper flex a propósito. */}
      <LabelPrintSurface containerId={PRINT_CONTAINER_ID} size={size}>
        {labels.map((l) => (
          <div
            key={l.key}
            className={LABEL_PRINT_CLASS}
            style={{
              width: s.width,
              height: s.height,
              border: s.border,
              padding: s.padding,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            {config.label_fields.name && (
              <div style={{ fontSize: s.nameFs, fontWeight: 700, lineHeight: 1.1 }}>
                {l.productName}
              </div>
            )}
            {config.label_fields.size_color && (
              <div style={{ fontSize: s.detailFs, lineHeight: 1.1 }}>
                T.{l.size ?? '—'} · {l.color ?? '—'}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
              <BarcodeSvg code={l.barcode as string} height={s.barcodeHeight} width={s.barcodeWidth} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: s.skuFs }}>
              <span style={{ fontFamily: 'monospace' }}>{l.barcode}</span>
              {config.label_fields.price && (
                <span style={{ fontSize: s.priceFs, fontWeight: 700 }}>
                  {formatTransferMoney(l.price)}
                </span>
              )}
            </div>
          </div>
        ))}
      </LabelPrintSurface>
    </>
  )
}
