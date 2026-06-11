import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  User,
  Plus,
  Minus,
  Search,
  Bookmark,
  Wallet,
  Calendar,
  Tag,
  Printer,
  ChevronRight,
  ChevronLeft,
  CheckCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { addDays, format } from 'date-fns'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import {
  useCreateLayaway,
  type NewLayawayItem,
} from '@/hooks/useLayawayMutations'
import { useLayawayDetail } from '@/hooks/useLayaways'
import {
  calculateMaxDiscount,
  calculateRequiredInitialPayment,
} from '@/lib/layawayCalc'
import {
  usePOSSearch,
  type POSProduct,
  type POSVariant,
} from '@/hooks/usePOSSearch'
import { useCustomerSearch } from '@/hooks/useCustomers'
import { useCreateCustomer } from '@/hooks/useCustomerMutations'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_KEYS,
  migrateLegacyPaymentMethods,
} from '@/lib/paymentMethods'
import type { Customer, PaymentMethod } from '@/types/database.types'
import {
  LayawayReceipt,
  LayawayReceiptPrint,
} from './LayawayReceipt'

// ── Tipos internos ────────────────────────────────────────────────────────────

export interface DraftItem {
  variant_id: string
  product_id: string
  name: string
  brand: string | null
  size: string | null
  color: string | null
  unit_price: number
  qty: number
  available: number
}

export interface NewLayawayPrefill {
  customer: Customer | null
  items: DraftItem[]
}

interface Props {
  prefill?: NewLayawayPrefill
  onClose: () => void
  onCreated: (layawayId: string) => void
}

function parseCOP(value: string): number {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 0
  return parseInt(digits, 10)
}

function customerInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

// ── Variant picker reutilizable (simplificado) ────────────────────────────────

function VariantPicker({
  product,
  onAdd,
  onClose,
}: {
  product: POSProduct
  onAdd: (variant: POSVariant) => void
  onClose: () => void
}) {
  const sizes = [
    ...new Set(product.variants.map((v) => v.size).filter(Boolean)),
  ] as string[]
  const colors = [
    ...new Set(product.variants.map((v) => v.color).filter(Boolean)),
  ] as string[]
  const [selectedSize, setSelectedSize] = useState<string | null>(sizes[0] ?? null)
  const [selectedColor, setSelectedColor] = useState<string | null>(
    colors[0] ?? null,
  )

  const matched = product.variants.find(
    (v) =>
      (sizes.length === 0 || v.size === selectedSize) &&
      (colors.length === 0 || v.color === selectedColor),
  )
  const available = matched?.stock_qty ?? 0

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Agregar al separado
            </p>
            {product.brand && (
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                {product.brand}
              </p>
            )}
            <h3 className="mt-0.5 text-base font-semibold text-slate-900">
              {product.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        {sizes.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Talla
            </p>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => {
                const avail = product.variants.some(
                  (v) =>
                    v.size === s &&
                    (colors.length === 0 || v.color === selectedColor) &&
                    v.stock_qty > 0,
                )
                return (
                  <button
                    key={s}
                    disabled={!avail}
                    onClick={() => setSelectedSize(s)}
                    className={`min-w-[40px] rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                      selectedSize === s
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : avail
                          ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                          : 'cursor-not-allowed border-dashed border-slate-200 text-slate-300 line-through'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {colors.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Color
            </p>
            <div className="flex flex-wrap gap-2.5">
              {colors.map((c) => {
                const avail = product.variants.some(
                  (v) =>
                    v.color === c &&
                    (sizes.length === 0 || v.size === selectedSize) &&
                    v.stock_qty > 0,
                )
                return (
                  <button
                    key={c}
                    disabled={!avail}
                    onClick={() => setSelectedColor(c)}
                    title={c}
                    className={`h-8 w-8 rounded-full ${!avail ? 'cursor-not-allowed opacity-30' : ''}`}
                    style={{
                      background: getColorHex(c),
                      outline:
                        selectedColor === c
                          ? '2px solid #8b5cf6'
                          : '2px solid transparent',
                      outlineOffset: 2,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.12)',
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span
            className={`text-sm font-medium ${
              available > 2
                ? 'text-green-600'
                : available > 0
                  ? 'text-orange-500'
                  : 'text-red-500'
            }`}
          >
            {available > 0
              ? `${available} disponible${available !== 1 ? 's' : ''}`
              : 'Sin stock'}
          </span>
          {matched && (
            <span className="font-mono text-base font-semibold text-slate-900">
              {fmtCOP(matched.price)}
            </span>
          )}
        </div>

        <button
          disabled={!matched || available === 0}
          onClick={() => matched && onAdd(matched)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-violet-700"
        >
          <Plus size={16} /> Agregar
        </button>
      </div>
    </div>
  )
}

// ── Customer search (inline simplificado) ─────────────────────────────────────

function CustomerStep({
  selected,
  onSelect,
}: {
  selected: Customer | null
  onSelect: (c: Customer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const { data: results = [] } = useCustomerSearch(query)
  const containerRef = useRef<HTMLDivElement>(null)
  const dq = query.trim()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
        >
          {customerInitials(selected.full_name)}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#1a1a1a]">
            {selected.full_name}
          </p>
          {selected.phone && (
            <p className="text-xs text-[#737373]">{selected.phone}</p>
          )}
        </div>
        <button
          onClick={() => onSelect(null)}
          className="text-[#737373] hover:text-[#1a1a1a]"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  const showNoResults = open && dq.length >= 2 && results.length === 0

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
        <User size={15} className="shrink-0 text-[#737373]" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar cliente por nombre o teléfono…"
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
        />
      </div>
      {open && (results.length > 0 || showNoResults) && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-[#ebe9e6] bg-white shadow-lg">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c)
                setOpen(false)
                setQuery('')
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-[#fafaf9]"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
              >
                {customerInitials(c.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[#1a1a1a]">
                  {c.full_name}
                </span>
                {c.phone && (
                  <span className="text-xs text-[#737373]">{c.phone}</span>
                )}
              </div>
            </button>
          ))}
          {showNoResults && (
            <button
              onClick={() => {
                setOpen(false)
                setShowQuickCreate(true)
              }}
              className="flex w-full items-center gap-2.5 border-t border-[#f5f4f1] px-3 py-2.5 text-left text-sm font-medium text-violet-600 hover:bg-violet-50"
            >
              <Plus size={14} /> Crear cliente rápido &ldquo;{dq}&rdquo;
            </button>
          )}
        </div>
      )}

      {showQuickCreate && (
        <QuickCreateInline
          prefillName={query}
          onCreated={(c) => {
            onSelect(c)
            setShowQuickCreate(false)
            setQuery('')
          }}
          onClose={() => setShowQuickCreate(false)}
        />
      )}
    </div>
  )
}

function QuickCreateInline({
  prefillName,
  onCreated,
  onClose,
}: {
  prefillName: string
  onCreated: (c: Customer) => void
  onClose: () => void
}) {
  const [name, setName] = useState(prefillName)
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState('')
  const create = useCreateCustomer()

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-base font-semibold text-[#1a1a1a]">
          Crear cliente rápido
        </p>
        <div className="mb-3 space-y-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErr('')
            }}
            placeholder="Nombre completo *"
            className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setErr('')
            }}
            placeholder="Teléfono *"
            className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
          />
          {err && <p className="text-[11px] text-red-500">{err}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-[#ebe9e6] py-2.5 text-sm font-medium text-[#525252]"
          >
            Cancelar
          </button>
          <button
            disabled={create.isPending}
            onClick={() => {
              if (name.trim().length < 2 || phone.trim().length < 7) {
                setErr('Nombre mínimo 2 chars y teléfono mínimo 7')
                return
              }
              create.mutate(
                {
                  full_name: name.trim(),
                  phone: phone.trim(),
                  email: '',
                  document_id: '',
                  notes: '',
                },
                { onSuccess: (c) => onCreated(c) },
              )
            }}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {create.isPending ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Items step ────────────────────────────────────────────────────────────────

function ItemsStep({
  items,
  onAdd,
  onSetQty,
  onRemove,
}: {
  items: DraftItem[]
  onAdd: (item: DraftItem) => void
  onSetQty: (variantId: string, qty: number) => void
  onRemove: (variantId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [pickerProduct, setPickerProduct] = useState<POSProduct | null>(null)
  const { data: results = [], isLoading } = usePOSSearch(query)

  const displayed = useMemo(() => results.slice(0, 12), [results])

  function handleAddVariant(product: POSProduct, variant: POSVariant) {
    onAdd({
      variant_id: variant.id,
      product_id: product.id,
      name: product.name,
      brand: product.brand,
      size: variant.size,
      color: variant.color,
      unit_price: variant.price,
      qty: 1,
      available: variant.stock_qty,
    })
    setPickerProduct(null)
  }

  const total = items.reduce((s, it) => s + it.unit_price * it.qty, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
        <Search size={15} className="shrink-0 text-[#737373]" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto, marca, SKU o código…"
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-[#737373]">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[1.1fr_1fr]">
        {/* Resultados */}
        <div className="min-h-0 overflow-y-auto rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-2">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-[#a8a29e]">
              <Search size={22} />
              <p className="text-xs">Busca un producto para empezar</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {displayed.map((p) => {
                const totalStock = p.variants.reduce(
                  (s, v) => s + v.stock_qty,
                  0,
                )
                const minPrice = Math.min(...p.variants.map((v) => v.price))
                return (
                  <button
                    key={p.id}
                    onClick={() => setPickerProduct(p)}
                    disabled={totalStock === 0}
                    className="group flex flex-col rounded-lg border border-[#ebe9e6] bg-white p-2 text-left hover:border-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="mb-1 aspect-square overflow-hidden rounded-md bg-slate-100">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-300">
                          <Tag size={20} />
                        </div>
                      )}
                    </div>
                    {p.brand && (
                      <p className="line-clamp-1 text-[9px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                        {p.brand}
                      </p>
                    )}
                    <p className="line-clamp-1 text-[12px] font-medium text-[#1a1a1a]">
                      {p.name}
                    </p>
                    <p className="font-mono text-[11px] font-bold text-[#1a1a1a]">
                      {fmtCOP(minPrice)}
                    </p>
                    {totalStock === 0 && (
                      <p className="text-[10px] text-red-500">Sin stock</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Items agregados */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
          <div className="border-b border-[#f5f4f1] px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Ítems del separado
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[#a8a29e]">
                <Bookmark size={22} />
                <p className="text-xs">
                  Agrega productos desde el panel izquierdo.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#f5f4f1]">
                {items.map((it) => (
                  <div key={it.variant_id} className="flex items-center gap-2 px-3 py-2.5">
                    <div
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{
                        background: it.color ? getColorHex(it.color) : '#e2e8f0',
                        boxShadow: '0 0 0 1.5px rgba(0,0,0,0.12)',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      {it.brand && (
                        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                          {it.brand}
                        </p>
                      )}
                      <p className="truncate text-[12.5px] font-medium text-[#1a1a1a]">
                        {it.name}
                      </p>
                      <p className="text-[11px] text-[#737373]">
                        {[it.size ? `T.${it.size}` : null, it.color]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        · {fmtCOP(it.unit_price)} c/u
                      </p>
                    </div>
                    <div className="flex h-7 items-center overflow-hidden rounded-lg border border-[#ebe9e6]">
                      <button
                        onClick={() => onSetQty(it.variant_id, it.qty - 1)}
                        className="flex h-full w-6 items-center justify-center text-[#737373] hover:bg-[#fafaf9]"
                      >
                        <Minus size={11} />
                      </button>
                      <span className="w-6 text-center text-xs font-semibold tabular-nums">
                        {it.qty}
                      </span>
                      <button
                        onClick={() => onSetQty(it.variant_id, it.qty + 1)}
                        disabled={it.qty >= it.available}
                        className="flex h-full w-6 items-center justify-center text-[#737373] hover:bg-[#fafaf9] disabled:opacity-30"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                    <span className="w-20 shrink-0 text-right font-mono text-[12.5px] font-semibold text-[#1a1a1a]">
                      {fmtCOP(it.unit_price * it.qty)}
                    </span>
                    <button
                      onClick={() => onRemove(it.variant_id)}
                      className="text-[#a8a29e] hover:text-[#1a1a1a]"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-[#737373]">Total</span>
              <span className="font-mono text-base font-bold text-[#1a1a1a]">
                {fmtCOP(total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {pickerProduct && (
        <VariantPicker
          product={pickerProduct}
          onAdd={(v) => handleAddVariant(pickerProduct, v)}
          onClose={() => setPickerProduct(null)}
        />
      )}
    </div>
  )
}

// ── Confirm step ──────────────────────────────────────────────────────────────

interface ConfirmStepProps {
  subtotal: number
  discount: string
  setDiscount: (v: string) => void
  showDiscount: boolean
  total: number
  required: number
  amount: string
  setAmount: (v: string) => void
  method: PaymentMethod
  setMethod: (m: PaymentMethod) => void
  notes: string
  setNotes: (v: string) => void
  enabledMethods: PaymentMethod[]
}

function ConfirmStep({
  subtotal,
  discount,
  setDiscount,
  showDiscount,
  total,
  required,
  amount,
  setAmount,
  method,
  setMethod,
  notes,
  setNotes,
  enabledMethods,
}: ConfirmStepProps) {
  const parsedAmount = parseCOP(amount)
  const parsedDiscount = parseCOP(discount)
  // Descuento libre: el único límite es el subtotal; >50% solo advierte.
  const effectiveDiscount = Math.min(parsedDiscount, subtotal)
  const overSubtotal = parsedDiscount > subtotal
  const over50 = !overSubtotal && parsedDiscount > subtotal * 0.5
  const visibleMethods = PAYMENT_METHOD_KEYS.filter((m) =>
    enabledMethods.includes(m),
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Desglose subtotal / descuento / total */}
      <div className="rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
          Resumen
        </p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-[#525252]">
            <span>Subtotal</span>
            <span className="font-mono">{fmtCOP(subtotal)}</span>
          </div>
          {effectiveDiscount > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Descuento</span>
              <span className="font-mono">-{fmtCOP(effectiveDiscount)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-[#ebe9e6] pt-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Total
            </span>
            <span className="font-mono text-2xl font-bold text-[#1a1a1a]">
              {fmtCOP(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Descuento (solo si está habilitado en config) — monto libre */}
      {showDiscount && (
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Descuento
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
              inputMode="numeric"
              className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
            />
            <span className="text-xs text-[#a8a29e]">COP</span>
          </div>
          {parsedDiscount > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setDiscount('')}
                className="rounded-lg border border-[#ebe9e6] bg-white px-2.5 py-1 text-xs font-semibold text-[#525252] hover:border-red-300 hover:bg-red-50"
              >
                Quitar descuento
              </button>
            </div>
          )}
          {overSubtotal ? (
            <p className="mt-1.5 text-[11px] text-red-600">
              El descuento no puede superar el valor del separado (
              {fmtCOP(subtotal)}).
            </p>
          ) : over50 ? (
            <p className="mt-1.5 text-[11px] text-amber-600">
              Este descuento supera el 50% del valor del separado.
            </p>
          ) : null}
        </div>
      )}

      {/* Card destacado: abono mínimo */}
      {required > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-violet-700">
                Abono mínimo requerido
              </p>
              <p className="mt-0.5 text-[12px] text-violet-900">
                Para crear este separado debes cobrar al menos esta suma hoy.
              </p>
            </div>
            <p className="font-mono text-xl font-bold text-violet-900">
              {fmtCOP(required)}
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-end justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Abono inicial
          </label>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
          <span className="text-sm text-[#737373]">$</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            placeholder="0"
            inputMode="numeric"
            className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
          />
          <span className="text-xs text-[#a8a29e]">COP</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {required > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(required))}
              className="rounded-lg border border-[#ebe9e6] bg-white px-2.5 py-1 text-xs font-semibold text-[#525252] hover:border-violet-300 hover:bg-violet-50"
            >
              Mínimo ({fmtCOP(required)})
            </button>
          )}
          <button
            type="button"
            onClick={() => setAmount(String(total))}
            className="rounded-lg border border-[#ebe9e6] bg-white px-2.5 py-1 text-xs font-semibold text-[#525252] hover:border-violet-300 hover:bg-violet-50"
          >
            Total ({fmtCOP(total)})
          </button>
        </div>
        {parsedAmount > 0 && parsedAmount < required && (
          <p className="mt-1.5 text-[11px] text-red-600">
            El abono debe ser al menos {fmtCOP(required)}.
          </p>
        )}
        {parsedAmount > total && (
          <p className="mt-1.5 text-[11px] text-red-600">
            El abono no puede superar el total.
          </p>
        )}
      </div>

      {parsedAmount > 0 && (
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Método de pago
          </label>
          <div className="grid grid-cols-2 gap-2">
            {visibleMethods.map((id) => {
              const meta = PAYMENT_METHODS[id]
              const Icon = meta.icon
              const active = method === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMethod(id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-violet-600 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <Icon size={15} style={{ color: active ? undefined : meta.hex }} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
          Notas del separado (opcional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 300))}
          rows={2}
          placeholder="Observaciones internas…"
          className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a29e] focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </div>
    </div>
  )
}

// ── Stepper ───────────────────────────────────────────────────────────────────

const STEPS = ['Cliente', 'Ítems', 'Confirmar'] as const

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const active = i === current
        const done = i < current
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                active
                  ? 'bg-violet-600 text-white'
                  : done
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-[#f5f4f1] text-[#737373]'
              }`}
            >
              {done ? <CheckCircle size={13} /> : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${active ? 'text-[#1a1a1a]' : 'text-[#737373]'}`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRight size={13} className="text-[#a8a29e]" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Modal principal ───────────────────────────────────────────────────────────

export function NewLayawayModal({ prefill, onClose, onCreated }: Props) {
  const { data: storeData } = useStoreConfig()
  const config = useResolvedConfig()
  const storeName = storeData?.name ?? 'G-Mura'
  const enabledMethods = migrateLegacyPaymentMethods(config.payment_methods)
  const defaultDays =
    typeof config.layaway_default_days === 'number'
      ? config.layaway_default_days
      : 90

  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [customer, setCustomer] = useState<Customer | null>(prefill?.customer ?? null)
  const [items, setItems] = useState<DraftItem[]>(prefill?.items ?? [])
  const [expiresAt, setExpiresAt] = useState<string>(
    format(addDays(new Date(), defaultDays), 'yyyy-MM-dd'),
  )
  const [notes, setNotes] = useState('')
  const [amount, setAmount] = useState('')
  const [discount, setDiscount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(
    enabledMethods.includes('cash') ? 'cash' : (enabledMethods[0] ?? 'cash'),
  )
  const [createdLayawayId, setCreatedLayawayId] = useState<string | null>(null)
  const printedAtRef = useRef(new Date())

  const create = useCreateLayaway()
  const createdDetail = useLayawayDetail(createdLayawayId)

  const subtotal = items.reduce((s, it) => s + it.unit_price * it.qty, 0)
  const maxDiscount = useMemo(
    () => calculateMaxDiscount(subtotal, config),
    [subtotal, config],
  )
  const rawDiscount = parseCOP(discount)
  const parsedDiscount = Math.min(rawDiscount, maxDiscount)
  const total = Math.max(0, subtotal - parsedDiscount)
  const requiredInitial = useMemo(
    () => calculateRequiredInitialPayment(total, config),
    [total, config],
  )
  // El descuento es libre: basta con que esté permitido en la config.
  const showDiscount = config.layaway_discount_mode !== 'none'

  // Pre-fill amount con el requerido cuando se llega al paso 3
  useEffect(() => {
    if (step === 2 && amount === '' && requiredInitial > 0) {
      setAmount(String(requiredInitial))
    }
  }, [step, amount, requiredInitial])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !create.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, create.isPending])

  const minDate = format(addDays(new Date(), 1), 'yyyy-MM-dd')

  function handleAddItem(item: DraftItem) {
    setItems((prev) => {
      const existing = prev.find((p) => p.variant_id === item.variant_id)
      if (existing) {
        if (existing.qty >= existing.available) {
          toast.error(
            `Disponible máximo: ${existing.available} para ${existing.name}`,
          )
          return prev
        }
        return prev.map((p) =>
          p.variant_id === item.variant_id ? { ...p, qty: p.qty + 1 } : p,
        )
      }
      return [...prev, item]
    })
  }

  function handleSetQty(variantId: string, qty: number) {
    setItems((prev) => {
      if (qty <= 0) {
        return prev.filter((p) => p.variant_id !== variantId)
      }
      return prev.map((p) =>
        p.variant_id === variantId
          ? { ...p, qty: Math.min(qty, p.available) }
          : p,
      )
    })
  }

  function handleRemove(variantId: string) {
    setItems((prev) => prev.filter((p) => p.variant_id !== variantId))
  }

  const canNext =
    (step === 0 && !!customer && new Date(expiresAt).getTime() > Date.now()) ||
    (step === 1 && items.length > 0) ||
    step === 2

  const parsedAmount = parseCOP(amount)
  const discountOk = rawDiscount <= maxDiscount && rawDiscount >= 0
  const canSubmit =
    step === 2 &&
    parsedAmount >= requiredInitial &&
    parsedAmount <= total &&
    total > 0 &&
    discountOk &&
    !create.isPending

  function handleSubmit() {
    if (!customer) return
    if (!canSubmit) {
      if (rawDiscount > subtotal) {
        toast.error('El descuento no puede superar el valor del separado')
      } else if (parsedAmount < requiredInitial) {
        toast.error(`Abono mínimo requerido: ${fmtCOP(requiredInitial)}`)
      }
      return
    }
    create.mutate(
      {
        customer_id: customer.id,
        items: items.map<NewLayawayItem>((it) => ({
          variant_id: it.variant_id,
          product_id: it.product_id,
          qty: it.qty,
          unit_price: it.unit_price,
        })),
        expires_at: new Date(expiresAt + 'T23:59:59-05:00').toISOString(),
        notes,
        discount: parsedDiscount,
        initial_payment:
          parsedAmount > 0
            ? { amount: parsedAmount, method }
            : undefined,
      },
      {
        onSuccess: (layaway) => {
          setCreatedLayawayId(layaway.id)
        },
      },
    )
  }

  function handlePrintAndFinish() {
    if (!createdLayawayId) return
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup)
      onCreated(createdLayawayId)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
    setTimeout(() => {
      window.removeEventListener('afterprint', cleanup)
      onCreated(createdLayawayId)
    }, 60_000)
  }

  function handleFinishOnly() {
    if (!createdLayawayId) return
    onCreated(createdLayawayId)
  }

  // ── Pantalla post-creación: recibo + acciones ───────────────────────────────
  if (createdLayawayId) {
    return (
      <>
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
        >
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
            <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle size={18} className="text-emerald-700" />
                </div>
                <div>
                  <h2
                    style={{
                      fontFamily: 'Bricolage Grotesque, sans-serif',
                      fontSize: 18,
                      fontWeight: 600,
                      letterSpacing: '-0.025em',
                    }}
                  >
                    Separado creado
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[#737373]">
                    Imprime o entrega el ticket al cliente.
                  </p>
                </div>
              </div>
              <button
                onClick={handleFinishOnly}
                className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
              >
                <X size={14} className="text-[#525252]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#fafaf9] px-6 py-5">
              <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
                Vista previa del ticket
              </p>
              {createdDetail.data ? (
                <div className="mx-auto w-fit rounded-xl border border-[#ebe9e6] bg-white shadow-sm">
                  <LayawayReceipt
                    layaway={createdDetail.data}
                    storeName={storeName}
                    printedAt={printedAtRef.current}
                  />
                </div>
              ) : (
                <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
              )}
            </div>

            <div className="flex gap-3 border-t border-[#f5f4f1] px-6 py-4">
              <button
                onClick={handleFinishOnly}
                className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
              >
                Continuar sin imprimir
              </button>
              <button
                onClick={handlePrintAndFinish}
                disabled={!createdDetail.data}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:opacity-50"
              >
                <Printer size={14} /> Imprimir y continuar
              </button>
            </div>
          </div>
        </div>

        {createdDetail.data && (
          <LayawayReceiptPrint
            layaway={createdDetail.data}
            storeName={storeName}
            printedAt={printedAtRef.current}
          />
        )}
      </>
    )
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !create.isPending && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
              <Bookmark size={18} className="text-violet-600" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                }}
              >
                Nuevo separado
              </h2>
              <div className="mt-1">
                <Stepper current={step} />
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={create.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Cliente
                </label>
                <CustomerStep selected={customer} onSelect={setCustomer} />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Fecha de vencimiento
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
                  <Calendar size={15} className="text-[#737373]" />
                  <input
                    type="date"
                    value={expiresAt}
                    min={minDate}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="h-10 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-[#737373]">
                  Default: hoy + {defaultDays} día{defaultDays !== 1 ? 's' : ''}.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="min-h-[400px]">
              <ItemsStep
                items={items}
                onAdd={handleAddItem}
                onSetQty={handleSetQty}
                onRemove={handleRemove}
              />
            </div>
          )}

          {step === 2 && (
            <ConfirmStep
              subtotal={subtotal}
              discount={discount}
              setDiscount={setDiscount}
              showDiscount={showDiscount}
              total={total}
              required={requiredInitial}
              amount={amount}
              setAmount={setAmount}
              method={method}
              setMethod={setMethod}
              notes={notes}
              setNotes={setNotes}
              enabledMethods={enabledMethods}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={() => {
              if (step === 0) onClose()
              else setStep((s) => Math.max(0, s - 1) as 0 | 1 | 2)
            }}
            disabled={create.isPending}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            <ChevronLeft size={14} />
            {step === 0 ? 'Cancelar' : 'Atrás'}
          </button>

          {step < 2 ? (
            <button
              onClick={() => {
                if (!canNext) return
                setStep((s) => Math.min(2, s + 1) as 0 | 1 | 2)
              }}
              disabled={!canNext}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Siguiente
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wallet size={14} />
              {create.isPending ? 'Creando…' : 'Crear separado'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
