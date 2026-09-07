import { useState } from 'react'
import { Lock, TriangleAlert } from 'lucide-react'
import { AttrChip } from './BuilderPieces'
import { MappingBadge } from './TransferBadges'
import {
  destinationFromCandidate,
  sameLabel,
  type CandidateProduct,
  type DraftLine,
} from '@/lib/transferBuilder'

// ─────────────────────────────────────────────────────────────────────────────
// §3.5 y §3.6 — la tarjeta de candidato y el selector completo.
//
// Es el componente con más reglas del módulo. TODOS los textos de §5.3 viven
// acá y NO se reescriben: están redactados para que elegir bien sea más fácil
// que elegir mal, que es lo único que impide que el módulo duplique el catálogo
// del destino.
// ─────────────────────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  source,
  selected,
  onSelect,
}: {
  candidate: CandidateProduct
  source: Pick<DraftLine, 'size' | 'color'>
  selected: boolean
  onSelect: () => void
}) {
  const isExact = !!candidate.exactVariantId
  const hasSize = candidate.sizes.some((s) => sameLabel(s, source.size))
  const hasColor = candidate.colors.some((c) => sameLabel(c, source.color))

  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-violet-400 bg-violet-50/50 ring-[3px] ring-violet-500/10'
          : 'border-stone-200 bg-white hover:bg-stone-50'
      }`}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="mt-1 h-[15px] w-[15px] accent-violet-600"
      />
      <div className="min-w-0 flex-1">
        {/* Nombre + marca + descripción son obligatorios los TRES: "PRETINA
            ANCHA" existe 48 veces con distinta marca y estilo. Con el nombre
            solo, la elección es una moneda al aire. */}
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-neutral-800">
          {candidate.productName}
          {candidate.brand && (
            <span className="ml-1.5 text-[10.5px] font-bold tracking-[0.06em] text-neutral-400">
              {candidate.brand}
            </span>
          )}
        </p>
        <p className="text-[12.5px] text-neutral-600">{candidate.description ?? '—'}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {candidate.sizes.map((s) => (
            <AttrChip key={s} label={s} tone={sameLabel(s, source.size) ? 'match' : 'neutral'} />
          ))}
          {!hasSize && source.size && <AttrChip label={source.size} tone="toCreate" />}

          <span className="mx-1 h-3.5 w-px bg-stone-200" />

          {candidate.colors.map((c) => (
            <AttrChip key={c} label={c} tone={sameLabel(c, source.color) ? 'match' : 'neutral'} />
          ))}
          {!hasColor && source.color && <AttrChip label={source.color} tone="toCreate" />}
        </div>
      </div>

      <div className="flex-shrink-0">
        <MappingBadge type={isExact ? 'exact' : 'newSize'} short />
      </div>
    </label>
  )
}

interface DestinationPickerProps {
  source: DraftLine
  candidates: CandidateProduct[]
  loading: boolean
  destStoreName: string
  canCreateProducts: boolean
  onChoose: (v: {
    destAction: 'map_variant' | 'map_product' | 'create_product'
    toProductId: string | null
    toVariantId: string | null
  }) => void
  onClose: () => void
}

export default function DestinationPicker({
  source,
  candidates,
  loading,
  destStoreName,
  canCreateProducts,
  onChoose,
  onClose,
}: DestinationPickerProps) {
  const [filter, setFilter] = useState('')

  const shown = filter.trim()
    ? candidates.filter((c) =>
        `${c.productName} ${c.brand ?? ''} ${c.description ?? ''}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      )
    : candidates

  const isCreateSelected = source.destAction === 'create_product'

  return (
    <div
      className="border-t border-stone-200 bg-stone-50/60 px-4 pb-4 pt-3.5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-neutral-700">
          ¿A qué ficha de {destStoreName} va este producto?
        </p>
        {candidates.length > 0 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar candidatos…"
            className="w-56 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[12.5px] placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
          />
        )}
      </div>

      {loading ? (
        <div className="mt-3 space-y-[7px]">
          {/* La opción "Crear producto nuevo" NO se muestra mientras cargan los
              candidatos: ofrecerla antes empuja a crear duplicados (§1.2). */}
          <div className="h-[74px] animate-pulse rounded-[10px] bg-stone-100" />
          <div className="h-[74px] animate-pulse rounded-[10px] bg-stone-100" />
        </div>
      ) : (
        <>
          {candidates.length > 0 && (
            <>
              <p className="mt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400">
                {candidates.length === 1
                  ? `1 ficha parecida en ${destStoreName}`
                  : `${candidates.length} fichas parecidas en ${destStoreName}`}
              </p>

              <div className="mt-2 space-y-[7px]" role="radiogroup">
                {shown.map((c) => (
                  <CandidateCard
                    key={c.productId}
                    candidate={c}
                    source={source}
                    selected={
                      source.destAction !== 'create_product' &&
                      source.toProductId === c.productId
                    }
                    onSelect={() => onChoose(destinationFromCandidate(c))}
                  />
                ))}
                {shown.length === 0 && (
                  <p className="py-2 text-[12.5px] text-neutral-500">
                    Ningún candidato coincide con «{filter.trim()}».
                  </p>
                )}
              </div>

              <div className="my-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-stone-200" />
                <span className="text-[11.5px] text-neutral-400">o, si ninguna sirve</span>
                <span className="h-px flex-1 bg-stone-200" />
              </div>
            </>
          )}

          {candidates.length === 0 && (
            <div className="mt-3 rounded-[10px] border border-dashed border-stone-300 bg-white px-3 py-3">
              <p className="text-[12.5px] leading-snug text-neutral-600">
                {canCreateProducts
                  ? `No hay ninguna ficha parecida en ${destStoreName}. Hay que crear el producto allá.`
                  : `No hay ninguna ficha parecida en ${destStoreName}. Hay que crear el producto allá — y tu rol no puede crear productos, así que esta línea no se puede trasladar todavía.`}
              </p>
            </div>
          )}

          {/* Opción de crear: separada por el divisor y DESPUÉS de todos los
              candidatos, así no es la salida fácil. */}
          <label
            className={`mt-2 flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${
              !canCreateProducts
                ? 'cursor-not-allowed border-stone-200 bg-stone-100'
                : isCreateSelected
                  ? 'cursor-pointer border-violet-400 bg-violet-50/50 ring-[3px] ring-violet-500/10'
                  : 'cursor-pointer border-stone-200 bg-white hover:bg-stone-50'
            }`}
          >
            <input
              type="radio"
              checked={isCreateSelected}
              disabled={!canCreateProducts}
              onChange={() =>
                onChoose({ destAction: 'create_product', toProductId: null, toVariantId: null })
              }
              className="mt-1 h-[15px] w-[15px] accent-violet-600 disabled:opacity-40"
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-[13.5px] font-semibold ${
                  canCreateProducts ? 'text-neutral-800' : 'text-neutral-400'
                }`}
              >
                Crear producto nuevo en {destStoreName}
              </p>
              <p
                className={`text-[12.5px] ${
                  canCreateProducts ? 'text-neutral-600' : 'text-neutral-400'
                }`}
              >
                Se crea la ficha {source.productName}
                {source.brand && ` · ${source.brand}`}
                {source.description && ` · ${source.description}`}, con talla{' '}
                {source.size ?? '—'} y color {source.color ?? '—'}.
              </p>

              {!canCreateProducts && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2">
                  <Lock size={13} className="mt-[2px] flex-shrink-0 text-neutral-400" />
                  <p className="text-[12px] leading-snug text-neutral-500">
                    Tu rol no puede crear productos. Pedile a un administrador que cree la ficha
                    en {destStoreName}, o elegí una de las fichas de arriba.
                  </p>
                </div>
              )}

              {canCreateProducts && candidates.length > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                  <TriangleAlert size={13} className="mt-[2px] flex-shrink-0 text-amber-600" />
                  <p className="text-[12px] leading-snug text-amber-800">
                    {candidates.length === 1
                      ? `Hay 1 ficha parecida arriba. Crear una nueva duplica el catálogo de ${destStoreName}.`
                      : `Hay ${candidates.length} fichas parecidas arriba. Crear una nueva duplica el catálogo de ${destStoreName}.`}
                  </p>
                </div>
              )}
            </div>
          </label>
        </>
      )}
    </div>
  )
}
