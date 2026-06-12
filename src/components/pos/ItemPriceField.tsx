import { useState } from 'react'
import { fmtCOP } from '@/lib/formatters'
import { minFinalPrice } from '@/stores/cartStore'

interface ItemPriceFieldProps {
  // Precio de catálogo (referencia para el tachado y el tope).
  listPrice: number
  // Precio final actual (ya clampeado por el padre).
  unitPrice: number
  // Tope de rebaja por ítem en pesos (max_item_discount de la config).
  maxItemDiscount: number
  // Recibe el precio final tecleado; el PADRE clampa (store o clampItemPrice)
  // y la prop unitPrice refleja el valor ya clampeado.
  onCommit: (finalPrice: number) => void
}

/**
 * Editor de precio FINAL por ítem, compartido entre el POS y el wizard de
 * separados. Muestra el catálogo tachado + el final + badges (-%, "Producto
 * gratis", "Rebaja alta"). Con tope 0 queda de solo lectura (fijo en catálogo).
 *
 * Usa estado local solo mientras se edita para no clampear en cada tecla;
 * confirma en blur/Enter.
 */
export function ItemPriceField({
  listPrice,
  unitPrice,
  maxItemDiscount,
  onCommit,
}: ItemPriceFieldProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const priceLocked = maxItemDiscount <= 0
  const discounted = unitPrice < listPrice
  const isFree = unitPrice === 0
  const pctOff =
    discounted && listPrice > 0
      ? Math.round((1 - unitPrice / listPrice) * 100)
      : 0
  const highDiscount = !isFree && pctOff > 50

  const displayVal =
    editing !== null
      ? editing === ''
        ? ''
        : Number(editing).toLocaleString('es-CO')
      : unitPrice.toLocaleString('es-CO')

  function commit() {
    if (editing === null) return
    onCommit(Number(editing || '0'))
    setEditing(null)
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {discounted && (
        <span className="text-[11px] text-slate-400 line-through">
          {fmtCOP(listPrice)}
        </span>
      )}
      <div
        className={`flex h-7 items-center gap-1 rounded-lg border px-2 ${
          priceLocked
            ? 'border-slate-100 bg-slate-50'
            : 'border-slate-200 bg-white focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100'
        }`}
      >
        <span className="text-xs text-slate-400">$</span>
        <input
          value={displayVal}
          onFocus={() => {
            if (!priceLocked) setEditing(String(unitPrice))
          }}
          onChange={(e) => setEditing(e.target.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          readOnly={priceLocked}
          inputMode="numeric"
          title={
            priceLocked
              ? 'Descuento por ítem deshabilitado (tope $0)'
              : `Mínimo ${fmtCOP(minFinalPrice(listPrice, maxItemDiscount))}`
          }
          className="w-20 bg-transparent text-right text-xs font-semibold tabular-nums outline-none read-only:cursor-default read-only:text-slate-500"
        />
        <span className="text-[10px] text-slate-400">c/u</span>
      </div>
      {discounted && !isFree && (
        <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
          -{pctOff}%
        </span>
      )}
      {isFree && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          Producto gratis
        </span>
      )}
      {highDiscount && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          Rebaja alta
        </span>
      )}
    </div>
  )
}
