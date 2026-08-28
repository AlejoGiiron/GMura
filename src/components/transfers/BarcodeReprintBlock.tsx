import { Barcode, CheckCircle2, Printer } from 'lucide-react'

interface BarcodeReprintBlockProps {
  /** Cantidad de etiquetas a imprimir (una por unidad). */
  count: number
  fromStoreName: string
  toStoreName: string
  printed: boolean
  onPrint: () => void
  onViewCodes: () => void
}

/**
 * Handoff §1.4 y §5.6 — el bloque de etiquetas.
 *
 * REQUISITO NO NEGOCIABLE: es un bloque PERSISTENTE, no un toast. El código de
 * barras es único por tienda; las etiquetas pegadas a la prenda son del origen y
 * la lectora del destino no las reconoce. Un toast desaparece y el problema
 * aparece tres días después en la caja.
 *
 * Los textos de §5.6 están redactados con cuidado y NO se reescriben.
 */
export default function BarcodeReprintBlock({
  count,
  fromStoreName,
  toStoreName,
  printed,
  onPrint,
  onViewCodes,
}: BarcodeReprintBlockProps) {
  if (printed) {
    return (
      <section className="rounded-xl border border-green-300 bg-green-50 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 size={18} className="mt-[2px] flex-shrink-0 text-green-600" />
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold text-green-800">Etiquetas reimpresas</h3>
            <p className="mt-1 text-[12.5px] leading-snug text-green-800">
              Se generaron <span className="font-mono font-semibold">{count}</span> etiquetas con
              los códigos de {toStoreName}. Pegalas sobre las etiquetas viejas antes de poner la
              mercancía en el piso de venta.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={onPrint}
                className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-green-800 hover:bg-green-50"
              >
                <Printer size={14} />
                Volver a imprimir
              </button>
              <button
                onClick={onViewCodes}
                className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-green-800 hover:bg-green-50"
              >
                Ver códigos
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <Barcode size={18} className="mt-[2px] flex-shrink-0 text-red-600" />
        <div className="flex-1">
          <h3 className="text-[14px] font-semibold text-red-700">
            Hay que reimprimir las etiquetas de código de barras
          </h3>
          <p className="mt-1 text-[12.5px] leading-snug text-red-700">
            El código de barras es <strong>único por tienda</strong>. Las etiquetas que vienen
            pegadas a la prenda son de {fromStoreName} y{' '}
            <strong>la lectora no las va a reconocer acá</strong>. Sin reimprimir, estas{' '}
            <span className="font-mono font-semibold">{count}</span> unidades no se pueden vender
            con lectora.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:bg-red-700"
            >
              <Printer size={14} />
              Imprimir {count} etiquetas
            </button>
            <button
              onClick={onViewCodes}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-red-700 hover:bg-red-50"
            >
              Ver códigos
            </button>
            <span className="ml-1 text-[11.5px] text-red-600">
              Este aviso queda hasta que imprimas.
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
