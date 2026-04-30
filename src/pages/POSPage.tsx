import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import {
  ShoppingCart,
  Search,
  X,
  Plus,
  Minus,
  User,
  Tag,
  Banknote,
  CreditCard,
  Smartphone,
  ArrowLeftRight,
  Printer,
  CheckCircle,
  ChevronDown,
  Camera,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useCartStore, cartTotals } from '@/stores/cartStore'
import type { CartItem, Discount } from '@/stores/cartStore'
import {
  usePOSSearch,
  usePOSProducts,
  findVariantByBarcode,
} from '@/hooks/usePOSSearch'
import type { POSProduct, POSVariant } from '@/hooks/usePOSSearch'
import { useBarcode } from '@/hooks/useBarcode'
import BarcodeScanner from '@/components/pos/BarcodeScanner'
import { useCreateOrder } from '@/hooks/useCreateOrder'
import { useCategories } from '@/hooks/useProducts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import { useDebounce } from '@/hooks/useDebounce'
import { useCreateCustomer } from '@/hooks/useCustomerMutations'
import type { Customer, PaymentMethod, Order } from '@/types/database.types'

// ── Customer search hook ─────────────────────────────────────────────────────

function useCustomerSearch(query: string) {
  const { profile } = useAuth()
  const storeId = profile?.store_id ?? ''
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['customer-search', storeId, dq],
    queryFn: async (): Promise<Customer[]> => {
      if (dq.length < 2) return []
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('store_id' as never, storeId)
        .or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%` as never)
        .limit(8)
      if (error) throw error
      return (data ?? []) as Customer[]
    },
    enabled: !!storeId && dq.length >= 2,
    staleTime: 10_000,
  })
}

// ── Variant Picker Modal ─────────────────────────────────────────────────────

interface VariantPickerProps {
  product: POSProduct
  onAdd: (variant: POSVariant) => void
  onClose: () => void
}

function VariantPickerModal({ product, onAdd, onClose }: VariantPickerProps) {
  const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))] as string[]
  const colors = [...new Set(product.variants.map((v) => v.color).filter(Boolean))] as string[]

  const [selectedSize, setSelectedSize] = useState<string | null>(sizes[0] ?? null)
  const [selectedColor, setSelectedColor] = useState<string | null>(colors[0] ?? null)

  const matched = product.variants.find(
    (v) =>
      (sizes.length === 0 || v.size === selectedSize) &&
      (colors.length === 0 || v.color === selectedColor),
  )
  const stockQty = matched?.stock_qty ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Agregar al carrito
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{product.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        {sizes.length > 0 && (
          <div className="mb-4">
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
                    className={`min-w-[40px] rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
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
          <div className="mb-5">
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
                    className={`h-8 w-8 rounded-full transition-all ${!avail ? 'cursor-not-allowed opacity-30' : ''}`}
                    style={{
                      background: getColorHex(c),
                      outline:
                        selectedColor === c ? '2px solid #8b5cf6' : '2px solid transparent',
                      outlineOffset: 2,
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.12)',
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <span
            className={`text-sm font-medium ${
              stockQty > 2
                ? 'text-green-600'
                : stockQty > 0
                  ? 'text-orange-500'
                  : 'text-red-500'
            }`}
          >
            {stockQty > 0
              ? `${stockQty} disponible${stockQty !== 1 ? 's' : ''}`
              : 'Sin stock'}
          </span>
          {matched && (
            <span className="font-mono text-base font-semibold text-slate-900">
              {fmtCOP(matched.price)}
            </span>
          )}
        </div>

        <button
          disabled={!matched || stockQty === 0}
          onClick={() => matched && onAdd(matched)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 hover:bg-violet-700"
        >
          <Plus size={16} /> Agregar al carrito
        </button>
      </div>
    </div>
  )
}

// ── Payment Modal ─────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: ReactNode }[] = [
  { id: 'cash', label: 'Efectivo', icon: <Banknote size={18} /> },
  { id: 'card', label: 'Tarjeta', icon: <CreditCard size={18} /> },
  { id: 'transfer', label: 'Transferencia', icon: <ArrowLeftRight size={18} /> },
  { id: 'nequi', label: 'Nequi', icon: <Smartphone size={18} /> },
]

interface PaymentModalProps {
  total: number
  onConfirm: (method: PaymentMethod, cashReceived?: number) => void
  onClose: () => void
  isPending: boolean
}

function PaymentModal({ total, onConfirm, onClose, isPending }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')

  const cashAmt = parseFloat(cashReceived) || 0
  const change = cashAmt - total
  const canConfirm = method !== 'cash' || cashAmt >= total

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Cobrar venta
            </p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-slate-900">
              {fmtCOP(total)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Método de pago
        </p>
        <div className="mb-5 grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                method === m.id
                  ? 'border-violet-600 bg-violet-50 text-violet-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              ¿Con cuánto paga?
            </label>
            <input
              autoFocus
              type="number"
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-lg font-semibold outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            {cashAmt >= total && (
              <p className="mt-2 text-sm text-green-600">
                Cambio:{' '}
                <span className="font-semibold">{fmtCOP(change)}</span>
              </p>
            )}
          </div>
        )}

        <button
          disabled={!canConfirm || isPending}
          onClick={() => onConfirm(method, method === 'cash' ? cashAmt : undefined)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 hover:bg-violet-700"
        >
          {isPending ? (
            'Procesando…'
          ) : (
            <>
              <CheckCircle size={16} /> Confirmar pago
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Ticket Modal ──────────────────────────────────────────────────────────────

interface TicketModalProps {
  order: Order
  items: CartItem[]
  discount: Discount
  onClose: () => void
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  nequi: 'Nequi',
}

function TicketModal({ order, items, discount, onClose }: TicketModalProps) {
  const { subtotal, discountAmt } = cartTotals(items, discount)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 text-center">
          <p className="text-lg font-bold text-slate-900">G-Mura</p>
          <p className="text-xs text-slate-500">
            {new Date(order.created_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Venta #{order.id.slice(-6).toUpperCase()}
          </p>
        </div>

        <div className="mb-3 border-t border-dashed border-slate-200 pt-3 text-sm">
          {items.map((item) => (
            <div key={item.variant_id} className="mb-1.5 flex justify-between gap-2">
              <span className="text-slate-700">
                {item.name}
                {item.size ? ` T.${item.size}` : ''}
                {item.color ? ` ${item.color}` : ''} × {item.qty}
              </span>
              <span className="shrink-0 font-mono text-slate-900">
                {fmtCOP(item.unit_price * item.qty)}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-dashed border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span className="font-mono">{fmtCOP(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Descuento</span>
              <span className="font-mono">-{fmtCOP(discountAmt)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-900">
            <span>Total</span>
            <span className="font-mono">{fmtCOP(order.total)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>{METHOD_LABEL[order.payment_method]}</span>
            {order.cash_received != null && (
              <span className="font-mono">{fmtCOP(order.cash_received)}</span>
            )}
          </div>
          {order.cash_received != null && order.cash_received > order.total && (
            <div className="flex justify-between text-slate-700">
              <span>Cambio</span>
              <span className="font-mono">
                {fmtCOP(order.cash_received - order.total)}
              </span>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">¡Gracias por tu compra!</p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer size={14} /> Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"
          >
            Nueva venta
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Product Card ──────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: POSProduct
  onClick: () => void
}

function ProductCard({ product, onClick }: ProductCardProps) {
  const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))] as string[]
  const minPrice = Math.min(...product.variants.map((v) => v.price))
  const totalStock = product.variants.reduce((s, v) => s + v.stock_qty, 0)

  return (
    <button
      onClick={onClick}
      className="group w-full rounded-xl border border-slate-100 bg-white text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="relative aspect-square overflow-hidden rounded-t-xl bg-slate-100">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <Tag size={28} />
          </div>
        )}
        {totalStock === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
              Agotado
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        {product.brand && (
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {product.brand}
          </p>
        )}
        <p className="line-clamp-2 text-sm font-medium leading-tight text-slate-900">
          {product.name}
        </p>
        <p className="mt-1.5 font-mono text-sm font-bold text-slate-900">
          {fmtCOP(minPrice)}
        </p>
        {sizes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {sizes.slice(0, 5).map((s) => (
              <span
                key={s}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

// ── Customer helpers ──────────────────────────────────────────────────────────

function customerInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

// ── Quick create modal ────────────────────────────────────────────────────────

interface QuickCreateModalProps {
  prefillName: string
  onCreated: (c: Customer) => void
  onClose: () => void
}

function QuickCreateModal({ prefillName, onCreated, onClose }: QuickCreateModalProps) {
  const [name, setName] = useState(prefillName)
  const [phone, setPhone] = useState('')
  const [nameErr, setNameErr] = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const createCustomer = useCreateCustomer()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSave = () => {
    let ok = true
    if (name.trim().length < 2) { setNameErr('Mínimo 2 caracteres'); ok = false }
    if (phone.trim().length < 7) { setPhoneErr('Teléfono inválido'); ok = false }
    if (!ok) return

    createCustomer.mutate(
      { full_name: name.trim(), phone: phone.trim(), email: '', document_id: '', notes: '' },
      {
        onSuccess: (c) => {
          onCreated(c)
          onClose()
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-semibold text-slate-900">Crear cliente rápido</p>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setNameErr('') }}
              placeholder="Nombre completo *"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            {nameErr && <p className="mt-1 text-[11px] text-red-500">{nameErr}</p>}
          </div>
          <div>
            <input
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneErr('') }}
              placeholder="Teléfono *"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            {phoneErr && <p className="mt-1 text-[11px] text-red-500">{phoneErr}</p>}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={createCustomer.isPending}
            className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-violet-700"
          >
            {createCustomer.isPending ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Customer Search Input ─────────────────────────────────────────────────────

interface CustomerSearchInputProps {
  selected: Customer | null
  onSelect: (c: Customer | null) => void
}

function CustomerSearchInput({ selected, onSelect }: CustomerSearchInputProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const { data: results = [] } = useCustomerSearch(query)
  const containerRef = useRef<HTMLDivElement>(null)
  const dq = useDebounce(query.trim(), 300)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (c: Customer) => {
    onSelect(c)
    setOpen(false)
    setQuery('')
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
        >
          {customerInitials(selected.full_name)}
        </div>
        <span className="flex-1 font-medium text-slate-800">{selected.full_name}</span>
        {selected.phone && (
          <span className="text-xs text-slate-400">{selected.phone}</span>
        )}
        <button
          onClick={() => {
            onSelect(null)
            setQuery('')
          }}
          className="text-slate-400 hover:text-slate-700"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  const showNoResults = open && dq.length >= 2 && results.length === 0

  return (
    <>
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <User size={14} className="shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar cliente o teléfono…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        {open && (results.length > 0 || showNoResults) && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }}
                >
                  {customerInitials(c.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">
                    {c.full_name}
                  </span>
                  {c.phone && (
                    <span className="text-xs text-slate-400">{c.phone}</span>
                  )}
                </div>
              </button>
            ))}
            {showNoResults && (
              <button
                onClick={() => { setOpen(false); setShowQuickCreate(true) }}
                className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-violet-600 hover:bg-violet-50"
              >
                <Plus size={14} className="shrink-0" />
                Crear cliente rápido &ldquo;{dq}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>

      {showQuickCreate && (
        <QuickCreateModal
          prefillName={query}
          onCreated={handleSelect}
          onClose={() => setShowQuickCreate(false)}
        />
      )}
    </>
  )
}

// ── Cart Panel ────────────────────────────────────────────────────────────────

function CartPanel({ onCheckout }: { onCheckout: () => void }) {
  const store = useCartStore()
  const { items, discount, customer_id } = store
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const { subtotal, discountAmt, total } = cartTotals(items, discount)

  const handleSelectCustomer = useCallback(
    (c: Customer | null) => {
      setSelectedCustomer(c)
      store.setCustomer(c?.id ?? null)
    },
    [store],
  )

  useEffect(() => {
    if (!customer_id) setSelectedCustomer(null)
  }, [customer_id])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-semibold text-slate-900">Carrito</p>
          <p className="text-xs text-slate-400">
            {items.length} {items.length === 1 ? 'artículo' : 'artículos'}
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={store.clear}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Vaciar
          </button>
        )}
      </div>

      {/* Customer */}
      <div className="border-b border-slate-100 px-5 py-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Cliente
        </p>
        <CustomerSearchInput selected={selectedCustomer} onSelect={handleSelectCustomer} />
      </div>

      {/* Items */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <ShoppingCart size={24} className="text-slate-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Carrito vacío</p>
              <p className="mt-1 text-xs text-slate-400">
                Escanea o haz clic en un producto para empezar.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {items.map((item) => (
              <div key={item.variant_id} className="flex items-center gap-3 px-5 py-3">
                <div
                  className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
                  style={{
                    background: item.color ? getColorHex(item.color) : '#e2e8f0',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-400">
                    {[item.size ? `T.${item.size}` : null, item.color]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    · {fmtCOP(item.unit_price)} c/u
                  </p>
                </div>
                <div className="flex h-7 items-center overflow-hidden rounded-lg border border-slate-200">
                  <button
                    onClick={() => store.setQty(item.variant_id, item.qty - 1)}
                    className="flex h-full w-7 items-center justify-center text-slate-500 hover:bg-slate-50"
                  >
                    <Minus size={11} />
                  </button>
                  <span className="w-6 text-center text-xs font-semibold tabular-nums">
                    {item.qty}
                  </span>
                  <button
                    onClick={() => store.setQty(item.variant_id, item.qty + 1)}
                    disabled={item.qty >= item.stock_qty}
                    className="flex h-full w-7 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={11} />
                  </button>
                </div>
                <span className="w-20 text-right font-mono text-sm font-semibold text-slate-800">
                  {fmtCOP(item.unit_price * item.qty)}
                </span>
                <button
                  onClick={() => store.removeItem(item.variant_id)}
                  className="text-slate-300 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="border-t border-slate-200 bg-slate-50 px-5 pb-5 pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <Tag size={13} /> Descuento
          </div>
          <div className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5">
            <button
              onClick={() =>
                store.setDiscount({
                  ...discount,
                  type: discount.type === 'percent' ? 'fixed' : 'percent',
                })
              }
              className="flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              {discount.type === 'percent' ? '%' : '$'}
              <ChevronDown size={10} />
            </button>
            <span className="mx-1 text-slate-200">|</span>
            <input
              type="number"
              min={0}
              value={discount.value === 0 ? '' : discount.value}
              onChange={(e) =>
                store.setDiscount({ ...discount, value: Math.max(0, Number(e.target.value) || 0) })
              }
              placeholder="0"
              className="w-16 bg-transparent text-right text-sm font-semibold outline-none"
            />
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span className="font-mono">{fmtCOP(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-green-600">
              <span>
                Descuento{discount.type === 'percent' ? ` (${discount.value}%)` : ''}
              </span>
              <span className="font-mono">-{fmtCOP(discountAmt)}</span>
            </div>
          )}
        </div>

        <div className="my-3 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-3">
          <span className="text-sm font-semibold text-slate-700">Total</span>
          <span className="font-mono text-2xl font-bold tracking-tight text-slate-900">
            {fmtCOP(total)}
          </span>
        </div>

        <button
          disabled={items.length === 0}
          onClick={onCheckout}
          className="w-full rounded-xl bg-violet-600 py-3.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(139,92,246,0.35)] transition-all disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none hover:bg-violet-700"
        >
          Cobrar · {fmtCOP(total)}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type CompletedSale = { order: Order; items: CartItem[]; discount: Discount }

export default function POSPage() {
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [pickerProduct, setPickerProduct] = useState<POSProduct | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data: searchResults = [], isLoading } = usePOSSearch(query)
  const { data: allProducts = [] } = usePOSProducts()
  const { data: categories = [] } = useCategories()
  const { items, discount, customer_id, addItem, clear } = useCartStore()
  const createOrder = useCreateOrder()

  // Focus search on mount + Ctrl/Cmd+K
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Barcode scan handler — usado por escáner USB y cámara
  const handleScan = useCallback(
    (code: string) => {
      setQuery('')
      setShowCamera(false)

      const match = findVariantByBarcode(allProducts, code)
      if (!match) {
        toast.error(`Código no encontrado: ${code}`)
        return
      }
      if (match.variant.stock_qty === 0) {
        toast.error(`Sin stock: ${match.product.name}`)
        return
      }

      addItem({
        variant_id: match.variant.id,
        product_id: match.product.id,
        name: match.product.name,
        size: match.variant.size,
        color: match.variant.color,
        unit_price: match.variant.price,
        stock_qty: match.variant.stock_qty,
      })

      const detail = [
        match.variant.size && `talla ${match.variant.size}`,
        match.variant.color,
      ]
        .filter(Boolean)
        .join(' ')
      toast.success(
        `Añadido: ${match.product.name}${detail ? ` — ${detail}` : ''}`,
      )
    },
    [allProducts, addItem],
  )

  const { isCameraActive, startCamera, stopCamera, handleKeyDown: barcodeKeyDown } =
    useBarcode(handleScan)

  // Combina detección de escáner USB con búsqueda manual por Enter
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const consumed = barcodeKeyDown(e)
      if (consumed) {
        setQuery('')
        return
      }
      // Enter manual — intenta coincidir con barcode en la búsqueda actual
      if (e.key !== 'Enter' || !query.trim()) return
      const match = findVariantByBarcode(searchResults, query.trim())
      if (!match) return
      if (match.variant.stock_qty === 0) {
        toast.error(`Sin stock: ${match.product.name}`)
        setQuery('')
        return
      }
      addItem({
        variant_id: match.variant.id,
        product_id: match.product.id,
        name: match.product.name,
        size: match.variant.size,
        color: match.variant.color,
        unit_price: match.variant.price,
        stock_qty: match.variant.stock_qty,
      })
      setQuery('')
      toast.success(`Añadido: ${match.product.name}`)
    },
    [barcodeKeyDown, query, searchResults, addItem],
  )

  const displayed = useMemo(() => {
    if (activeCat === 'all') return searchResults
    return searchResults.filter((p) => p.category?.id === activeCat)
  }, [searchResults, activeCat])

  const handleAddVariant = (product: POSProduct, variant: POSVariant) => {
    addItem({
      variant_id: variant.id,
      product_id: product.id,
      name: product.name,
      size: variant.size,
      color: variant.color,
      unit_price: variant.price,
      stock_qty: variant.stock_qty,
    })
    setPickerProduct(null)
    toast.success(`${product.name} agregado`)
  }

  const handleConfirmPayment = (method: PaymentMethod, cashReceived?: number) => {
    const snapshot = { items: [...items], discount: { ...discount } }
    createOrder.mutate(
      { items, discount, customer_id, payment_method: method, cash_received: cashReceived },
      {
        onSuccess: (order) => {
          setShowPayment(false)
          setCompletedSale({ order, ...snapshot })
        },
      },
    )
  }

  const handleTicketClose = useCallback(() => {
    setCompletedSale(null)
    clear()
    searchRef.current?.focus()
  }, [clear])

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Left — Products */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {/* Search bar */}
        <div className="px-6 pt-5">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
            <Search size={18} className="shrink-0 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Escanear código o buscar producto, marca, SKU…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={15} />
              </button>
            )}
            <button
              onClick={() => setShowCamera(true)}
              title="Escanear con cámara"
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                isCameraActive
                  ? 'border-violet-300 bg-violet-50 text-violet-500'
                  : 'border-slate-200 bg-white text-slate-400 hover:text-violet-500'
              }`}
            >
              <Camera size={14} />
            </button>
            <kbd className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto px-6 py-4" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setActiveCat('all')}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              activeCat === 'all'
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                activeCat === cat.id
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
              <Search size={28} className="text-slate-300" />
              <p className="text-sm">Sin resultados</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {displayed.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onClick={() => setPickerProduct(product)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Right — Cart */}
      <section className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <CartPanel onCheckout={() => setShowPayment(true)} />
      </section>

      {/* Modals */}
      {pickerProduct && (
        <VariantPickerModal
          product={pickerProduct}
          onAdd={(v) => handleAddVariant(pickerProduct, v)}
          onClose={() => setPickerProduct(null)}
        />
      )}

      {showPayment && (
        <PaymentModal
          total={cartTotals(items, discount).total}
          onConfirm={handleConfirmPayment}
          onClose={() => setShowPayment(false)}
          isPending={createOrder.isPending}
        />
      )}

      {completedSale && (
        <TicketModal
          order={completedSale.order}
          items={completedSale.items}
          discount={completedSale.discount}
          onClose={handleTicketClose}
        />
      )}

      {showCamera && (
        <BarcodeScanner
          startCamera={startCamera}
          stopCamera={stopCamera}
          onClose={() => {
            stopCamera()
            setShowCamera(false)
          }}
        />
      )}
    </div>
  )
}
