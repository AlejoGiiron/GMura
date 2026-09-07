import { ChevronDown, X } from 'lucide-react'
import { MappingBadge } from './TransferBadges'
import { QtyStepper } from './BuilderPieces'
import DestinationPicker from './DestinationPicker'
import { useTransferTargets } from '@/hooks/useTransfers'
import { formatTransferMoney, mappingType } from '@/lib/transfers'
import { availableOf, groupCandidates, type DraftLine } from '@/lib/transferBuilder'

interface TransferLineCardProps {
  line: DraftLine
  index: number
  toStoreId: string
  destStoreName: string
  canCreateProducts: boolean
  expanded: boolean
  onToggle: () => void
  onQtyChange: (n: number) => void
  onDestinationChange: (v: {
    destAction: 'map_variant' | 'map_product' | 'create_product'
    toProductId: string | null
    toVariantId: string | null
  }) => void
  onRemove: () => void
}

/** §3.7 — tarjeta de línea: fila del producto + franja de mapeo + selector. */
export default function TransferLineCard({
  line,
  index,
  toStoreId,
  destStoreName,
  canCreateProducts,
  expanded,
  onToggle,
  onQtyChange,
  onDestinationChange,
  onRemove,
}: TransferLineCardProps) {
  // Los candidatos se piden solo cuando la línea está abierta; al agregarla ya
  // se consultaron para aplicar §4.1, así que salen de la caché de React Query.
  const { data: rows = [], isLoading } = useTransferTargets(
    expanded ? toStoreId : null,
    expanded ? line.fromVariantId : null,
    null,
  )
  const candidates = groupCandidates(rows)

  const available = availableOf(line)
  const atMax = line.qty >= available
  const undecided = line.destAction === null
  const type = mappingType(line.destAction)

  const resumen = (() => {
    if (line.destAction === 'create_product') return `Se crea la ficha en ${destStoreName}`
    if (line.destAction) {
      const c = candidates.find((x) => x.productId === line.toProductId)
      return c
        ? [c.productName, c.brand, c.description].filter(Boolean).join(' · ')
        : 'Ficha del destino elegida'
    }
    return candidates.length > 0
      ? `${candidates.length} fichas parecidas en ${destStoreName} — elegí una`
      : `Sin candidatos en ${destStoreName}`
  })()

  const stripe: Record<typeof type, string> = {
    exact: 'bg-green-50 hover:bg-green-100/70',
    newSize: 'bg-violet-50 hover:bg-violet-100/70',
    newProduct: 'bg-amber-50 hover:bg-amber-100/70',
    undecided: 'bg-red-50 hover:bg-red-100/70',
  }

  return (
    <article
      id={`linea-${index}`}
      // Una línea sin decidir lleva borde rojo y halo en TODA la tarjeta, para
      // que se encuentre haciendo scroll.
      className={`overflow-hidden rounded-xl border bg-white transition-shadow ${
        undecided ? 'border-red-300 shadow-[0_0_0_3px_rgba(220,38,38,0.08)]' : 'border-stone-200'
      }`}
    >
      {/* ── Fila del producto ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-[15px] py-[13px]">
        {/* minWidth 220px: sin ese piso el bloque de texto absorbe todo el
            déficit y el nombre se parte letra por letra. */}
        <div className="min-w-[220px] flex-1">
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-800">
            {line.productName}
            {line.brand && (
              <span className="ml-1.5 text-[10.5px] font-bold tracking-[0.06em] text-neutral-400">
                {line.brand}
              </span>
            )}
          </p>
          <p className="text-[12.5px] text-neutral-600">
            {[line.description, line.size && `T.${line.size}`, line.color]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <QtyStepper value={line.qty} max={available} onChange={onQtyChange} />

        <div className="min-w-[132px] text-right">
          <p className="font-mono text-[15px] font-semibold text-neutral-800">
            {formatTransferMoney(line.qty * line.unitPrice)}
          </p>
          <p className={`text-[11.5px] ${atMax ? 'font-semibold text-amber-700' : 'text-neutral-400'}`}>
            de {available} disponibles
          </p>
          {line.reservedQty > 0 && (
            <p className="text-[11px] text-neutral-400">
              {line.stockQty} en stock · {line.reservedQty} apartadas
            </p>
          )}
        </div>

        <button
          onClick={onRemove}
          aria-label={`Quitar ${line.productName} del envío`}
          className="rounded-lg p-1.5 text-neutral-300 transition-colors hover:bg-stone-100 hover:text-neutral-600"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Franja de mapeo ───────────────────────────────────────────────── */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2.5 px-[15px] py-2 text-left transition-colors ${stripe[type]}`}
      >
        <MappingBadge type={type} short />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-600">{resumen}</span>
        <span className="flex items-center gap-1 text-[12.5px] font-semibold text-neutral-500">
          {expanded ? 'Cerrar' : line.destAction ? 'Cambiar' : 'Elegir destino'}
          <ChevronDown
            size={13}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {expanded && (
        <DestinationPicker
          source={line}
          candidates={candidates}
          loading={isLoading}
          destStoreName={destStoreName}
          canCreateProducts={canCreateProducts}
          onChoose={onDestinationChange}
          onClose={onToggle}
        />
      )}
    </article>
  )
}
