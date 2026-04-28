import { useState, useMemo } from 'react'
import {
  Package,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Search,
  Download,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { format } from 'date-fns'
import { useStockLevels, useStockMovements, useStoreProfiles, MOV_PAGE_SIZE } from '@/hooks/useInventory'
import type { MovementFilters, VariantRow } from '@/hooks/useInventory'
import { useInventoryMutations } from '@/hooks/useInventoryMutations'
import { useCategories } from '@/hooks/useProducts'
import { useDebounce } from '@/hooks/useDebounce'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex, stockState } from '@/lib/products'
import type { StockMovementType } from '@/types/database.types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StockBadge({ qty, minStock }: { qty: number; minStock: number }) {
  const state = stockState(qty, minStock)
  if (state === 'out')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Sin stock
      </span>
    )
  if (state === 'low')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Stock bajo
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-900">
      <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
      Normal
    </span>
  )
}

const MOV_TYPE_LABELS: Record<StockMovementType, string> = {
  sale: 'Venta',
  return: 'Devolución',
  adjustment: 'Ajuste',
  purchase: 'Compra',
}

function MovTypeBadge({ type }: { type: StockMovementType }) {
  const label = MOV_TYPE_LABELS[type]
  const styles: Record<StockMovementType, string> = {
    sale: 'bg-red-100 text-red-800',
    return: 'bg-green-100 text-green-900',
    adjustment: 'bg-blue-100 text-blue-800',
    purchase: 'bg-violet-100 text-violet-800',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[type]}`}
    >
      {label}
    </span>
  )
}

interface SummaryCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  tone?: 'normal' | 'red' | 'yellow'
  mono?: boolean
}

function SummaryCard({ label, value, icon: Icon, tone = 'normal', mono }: SummaryCardProps) {
  const iconStyles = {
    normal: 'bg-violet-50 text-violet-500',
    red: 'bg-red-50 text-red-500',
    yellow: 'bg-amber-50 text-amber-500',
  }
  const valueStyles = {
    normal: '#1a1a1a',
    red: '#b91c1c',
    yellow: '#92400e',
  }
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconStyles[tone]}`}>
          <Icon size={17} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">{label}</p>
      </div>
      <p
        className={`text-[28px] font-semibold tracking-[-0.025em] tabular-nums leading-none ${mono ? 'font-mono text-[22px]' : ''}`}
        style={{
          fontFamily: mono ? undefined : 'Bricolage Grotesque, serif',
          color: valueStyles[tone],
        }}
      >
        {value}
      </p>
    </div>
  )
}

// ─── Adjust Modal ─────────────────────────────────────────────────────────────

const ADJUST_TYPES = [
  'Ingreso de mercancía',
  'Ajuste por conteo',
  'Merma',
  'Otro',
] as const

interface AdjustModalProps {
  open: boolean
  onClose: () => void
}

function AdjustModal({ open, onClose }: AdjustModalProps) {
  const [variantSearch, setVariantSearch] = useState('')
  const [selectedVariant, setSelectedVariant] = useState<VariantRow | null>(null)
  const [tipo, setTipo] = useState<string>('Ingreso de mercancía')
  const [qty, setQty] = useState<string>('')
  const [motivo, setMotivo] = useState('')

  const debouncedSearch = useDebounce(variantSearch)
  const { data: allVariants = [] } = useStockLevels()
  const { adjustStock } = useInventoryMutations()

  const searchResults = useMemo(() => {
    if (!debouncedSearch.trim()) return []
    const q = debouncedSearch.toLowerCase()
    return allVariants
      .filter(
        (v) =>
          v.products.name.toLowerCase().includes(q) ||
          v.sku?.toLowerCase().includes(q) ||
          v.barcode?.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [allVariants, debouncedSearch])

  function reset() {
    setVariantSearch('')
    setSelectedVariant(null)
    setTipo('Ingreso de mercancía')
    setQty('')
    setMotivo('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit() {
    if (!selectedVariant || !motivo.trim()) return
    const qtyNum = Number(qty)
    if (qtyNum === 0) return

    const notes = tipo !== 'Otro' ? `[${tipo}] ${motivo.trim()}` : motivo.trim()

    adjustStock.mutate(
      { variantId: selectedVariant.id, qty: qtyNum, type: 'adjustment', notes },
      { onSuccess: handleClose },
    )
  }

  if (!open) return null

  const qtyNum = Number(qty)
  const canSubmit =
    !!selectedVariant && motivo.trim().length > 0 && qty !== '' && qtyNum !== 0

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      <div
        className="w-[540px] max-h-[90vh] overflow-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-6">
          <div>
            <h2
              className="tracking-[-0.025em]"
              style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 22, fontWeight: 600, color: '#1a1a1a' }}
            >
              Ajuste manual de stock
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Registra una entrada, salida o corrección de inventario.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="px-7 py-6 space-y-5">
          {/* Variant search */}
          {!selectedVariant ? (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                Buscar variante
              </label>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8a29e]"
                />
                <input
                  autoFocus
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_#8b5cf61a]"
                  placeholder="Nombre del producto, SKU o código de barras..."
                  value={variantSearch}
                  onChange={(e) => setVariantSearch(e.target.value)}
                />
              </div>
              {searchResults.length > 0 && (
                <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-[#ebe9e6] bg-white shadow-sm">
                  {searchResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVariant(v)
                        setVariantSearch('')
                      }}
                      className="flex w-full items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 text-left last:border-0 hover:bg-[#f8f7f5]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-[#1a1a1a]">
                          {v.products.name}
                        </p>
                        <p className="text-xs text-[#737373]">
                          {[v.size && `T.${v.size}`, v.color]
                            .filter(Boolean)
                            .join(' · ')}
                          {v.sku ? ` · ${v.sku}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-[#525252]">
                        {v.stock_qty} uds
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Selected variant card */
            <div className="flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3">
              <div className="flex items-center gap-3">
                {selectedVariant.color && (
                  <span
                    className="h-5 w-5 shrink-0 rounded-full"
                    style={{
                      background: getColorHex(selectedVariant.color),
                      boxShadow: '0 0 0 1.5px #d6d3d1',
                    }}
                  />
                )}
                <div>
                  <p className="text-sm font-semibold text-[#1a1a1a]">
                    {selectedVariant.products.name}
                  </p>
                  <p className="text-xs text-[#737373]">
                    {[selectedVariant.size && `Talla ${selectedVariant.size}`, selectedVariant.color]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[.05em] text-[#a8a29e]">Stock actual</p>
                  <p
                    className="text-[22px] font-bold tabular-nums leading-none"
                    style={{ fontFamily: 'Bricolage Grotesque, serif', color: '#1a1a1a' }}
                  >
                    {selectedVariant.stock_qty}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedVariant(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white border border-[#ebe9e6] hover:bg-[#f5f4f1]"
                >
                  <X size={12} className="text-[#525252]" />
                </button>
              </div>
            </div>
          )}

          {/* Form fields */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Tipo de ajuste
            </label>
            <select
              className="h-10 w-full appearance-none rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_#8b5cf61a]"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {ADJUST_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Cantidad{' '}
              <span className="normal-case font-normal text-[#a8a29e]">
                (positivo = entrada · negativo = salida)
              </span>
            </label>
            <input
              type="number"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 font-mono text-sm outline-none transition-[border-color,box-shadow] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_#8b5cf61a]"
              placeholder="Ej: 10 o -5"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {selectedVariant && qty !== '' && qtyNum !== 0 && (
              <p className="mt-1 text-xs text-[#737373]">
                Stock resultante:{' '}
                <span
                  className="font-semibold font-mono"
                  style={{ color: selectedVariant.stock_qty + qtyNum < 0 ? '#b91c1c' : '#166534' }}
                >
                  {selectedVariant.stock_qty + qtyNum}
                </span>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Motivo <span className="text-red-400 font-bold">*</span>
            </label>
            <textarea
              className="w-full resize-y rounded-lg border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#8b5cf6] focus:shadow-[0_0_0_4px_#8b5cf61a]"
              rows={3}
              placeholder="Describe el motivo del ajuste..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
          <button
            onClick={handleClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || adjustStock.isPending}
            className="h-10 flex-1 rounded-lg bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adjustStock.isPending ? 'Guardando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'stock' | 'movimientos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Inventario' },
  { id: 'movimientos', label: 'Movimientos' },
]

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')
  const [showAdjustModal, setShowAdjustModal] = useState(false)

  // Stock tab filters
  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'out' | 'low' | 'ok'>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)

  // Movements tab filters
  const [movFilters, setMovFilters] = useState<MovementFilters>({
    type: 'all',
    dateFrom: '',
    dateTo: '',
  })
  const [movPage, setMovPage] = useState(0)

  // Data
  const { data: allVariants = [], isLoading: loadingStock } = useStockLevels()
  const { data: movData, isLoading: loadingMov } = useStockMovements(movFilters, movPage)
  const { data: profiles = [] } = useStoreProfiles()
  const { data: categories = [] } = useCategories()

  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.full_name])),
    [profiles],
  )

  // Derived summary stats (always from full unfiltered data)
  const outOfStock = allVariants.filter((v) => v.stock_qty === 0).length
  const lowStock = allVariants.filter(
    (v) => v.stock_qty > 0 && v.stock_qty <= v.min_stock,
  ).length
  const totalValue = allVariants.reduce(
    (sum, v) => sum + v.stock_qty * (v.cost_price ?? 0),
    0,
  )

  // Unique brands from data
  const brands = useMemo(() => {
    const seen = new Set<string>()
    allVariants.forEach((v) => {
      if (v.products.brand) seen.add(v.products.brand)
    })
    return [...seen].sort()
  }, [allVariants])

  // Filtered variants for table
  const filtered = useMemo(() => {
    return allVariants.filter((v) => {
      if (categoryFilter && v.products.category_id !== categoryFilter) return false
      if (brandFilter && v.products.brand !== brandFilter) return false
      if (statusFilter !== 'all') {
        if (stockState(v.stock_qty, v.min_stock) !== statusFilter) return false
      }
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        const matchName = v.products.name.toLowerCase().includes(q)
        const matchSku = v.sku?.toLowerCase().includes(q)
        const matchBarcode = v.barcode?.toLowerCase().includes(q)
        if (!matchName && !matchSku && !matchBarcode) return false
      }
      return true
    })
  }, [allVariants, categoryFilter, brandFilter, statusFilter, debouncedSearch])

  // Excel export
  async function exportExcel() {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    const ws = wb.addWorksheet('Inventario')

    ws.columns = [
      { header: 'Producto', key: 'product', width: 32 },
      { header: 'Marca', key: 'brand', width: 18 },
      { header: 'Talla', key: 'size', width: 10 },
      { header: 'Color', key: 'color', width: 16 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Código de barras', key: 'barcode', width: 22 },
      { header: 'Stock actual', key: 'stock_qty', width: 14 },
      { header: 'Stock mínimo', key: 'min_stock', width: 14 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Precio costo', key: 'cost_price', width: 18 },
      { header: 'Precio venta', key: 'price', width: 18 },
    ]

    // Style header row
    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F4F1' },
    }

    allVariants.forEach((v) => {
      const state = stockState(v.stock_qty, v.min_stock)
      const row = ws.addRow({
        product: v.products.name,
        brand: v.products.brand ?? '',
        size: v.size ?? '',
        color: v.color ?? '',
        sku: v.sku ?? '',
        barcode: v.barcode ?? '',
        stock_qty: v.stock_qty,
        min_stock: v.min_stock,
        status: state === 'out' ? 'Sin stock' : state === 'low' ? 'Stock bajo' : 'Normal',
        cost_price: v.cost_price ?? 0,
        price: v.price,
      })

      if (state === 'out') {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        })
      } else if (state === 'low') {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
        })
      }
    })

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gmura_inventario_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Pagination
  const movRows = movData?.rows ?? []
  const movTotal = movData?.total ?? 0
  const totalPages = Math.ceil(movTotal / MOV_PAGE_SIZE)

  const inputClass =
    'h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:shadow-[0_0_0_3px_#8b5cf61a] transition-[border-color,box-shadow]'

  return (
    <>
      {/* Page header */}
      <div
        className="flex items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <div className="flex items-center gap-5">
          <h1
            className="tracking-[-0.02em]"
            style={{ fontFamily: 'Bricolage Grotesque, serif', fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}
          >
            Inventario
          </h1>
          {/* Tabs */}
          <div className="flex items-center gap-0.5 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white text-[#1a1a1a] shadow-sm'
                    : 'text-[#737373] hover:text-[#525252]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowAdjustModal(true)}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#8b5cf6] px-4 text-[13.5px] font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95"
        >
          <Plus size={15} />
          Ajuste manual
        </button>
      </div>

      <div className="p-6 space-y-5" style={{ background: '#f8f7f5', minHeight: 'calc(100vh - 64px - 64px)' }}>
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard
            label="Total variantes"
            value={allVariants.length}
            icon={Package}
          />
          <SummaryCard
            label="Sin stock"
            value={outOfStock}
            icon={AlertCircle}
            tone={outOfStock > 0 ? 'red' : 'normal'}
          />
          <SummaryCard
            label="Stock bajo"
            value={lowStock}
            icon={AlertTriangle}
            tone={lowStock > 0 ? 'yellow' : 'normal'}
          />
          <SummaryCard
            label="Valor total inventario"
            value={fmtCOP(totalValue)}
            icon={TrendingUp}
            mono
          />
        </div>

        {/* ── Stock tab ─────────────────────────────────────────────────────── */}
        {tab === 'stock' && (
          <div className="overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
              <select
                className={inputClass}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                className={inputClass}
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              >
                <option value="">Todas las marcas</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>

              <select
                className={inputClass}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'out' | 'low' | 'ok')
                }
              >
                <option value="all">Todos los estados</option>
                <option value="out">Sin stock</option>
                <option value="low">Stock bajo</option>
                <option value="ok">Normal</option>
              </select>

              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8a29e]"
                />
                <input
                  className={`${inputClass} w-full pl-9`}
                  placeholder="Nombre, SKU o código de barras…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button
                onClick={exportExcel}
                className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
              >
                <Download size={14} />
                Exportar Excel
              </button>
            </div>

            {/* Table */}
            {loadingStock ? (
              <div className="space-y-px p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <Package size={22} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    {allVariants.length === 0
                      ? 'No hay variantes registradas'
                      : 'Sin resultados para los filtros aplicados'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {allVariants.length === 0
                      ? 'Crea productos y variantes en el módulo de Productos.'
                      : 'Intenta con otros filtros o limpia la búsqueda.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ebe9e6', background: '#fafaf9' }}>
                      {[
                        'Producto',
                        'Marca',
                        'Talla',
                        'Color',
                        'SKU',
                        'Código de barras',
                        'Stock',
                        'Mín.',
                        'Estado',
                      ].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((v) => {
                      const state = stockState(v.stock_qty, v.min_stock)
                      const rowBg =
                        state === 'out'
                          ? '#fff5f5'
                          : state === 'low'
                            ? '#fffbeb'
                            : 'transparent'
                      return (
                        <tr
                          key={v.id}
                          style={{ borderBottom: '1px solid #f5f4f1', background: rowBg }}
                        >
                          <td className="px-4 py-2.5">
                            <span className="text-sm font-medium text-[#1a1a1a]">
                              {v.products.name}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-[#525252]">
                            {v.products.brand ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {v.size ? (
                              <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-2 text-xs font-semibold tabular-nums">
                                {v.size}
                              </span>
                            ) : (
                              <span className="text-[#a8a29e]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {v.color ? (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{
                                    background: getColorHex(v.color),
                                    boxShadow: '0 0 0 1px #d6d3d1',
                                  }}
                                />
                                <span className="text-sm capitalize text-[#525252]">{v.color}</span>
                              </div>
                            ) : (
                              <span className="text-[#a8a29e]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[#525252]">
                            {v.sku ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[#525252]">
                            {v.barcode ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold text-[#1a1a1a]">
                            {v.stock_qty}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm text-[#737373]">
                            {v.min_stock}
                          </td>
                          <td className="px-4 py-2.5">
                            <StockBadge qty={v.stock_qty} minStock={v.min_stock} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer count */}
            {filtered.length > 0 && (
              <div className="border-t border-[#f5f4f1] px-5 py-3">
                <p className="text-xs text-[#a8a29e]">
                  {filtered.length} de {allVariants.length} variantes
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Movimientos tab ───────────────────────────────────────────────── */}
        {tab === 'movimientos' && (
          <div className="overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
              <select
                className={inputClass}
                value={movFilters.type}
                onChange={(e) => {
                  setMovFilters((f) => ({
                    ...f,
                    type: e.target.value as StockMovementType | 'all',
                  }))
                  setMovPage(0)
                }}
              >
                <option value="all">Todos los tipos</option>
                <option value="sale">Venta</option>
                <option value="return">Devolución</option>
                <option value="adjustment">Ajuste</option>
                <option value="purchase">Compra</option>
              </select>

              <div className="flex items-center gap-2">
                <label className="text-xs text-[#737373]">Desde</label>
                <input
                  type="date"
                  className={inputClass}
                  value={movFilters.dateFrom}
                  onChange={(e) => {
                    setMovFilters((f) => ({ ...f, dateFrom: e.target.value }))
                    setMovPage(0)
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-[#737373]">Hasta</label>
                <input
                  type="date"
                  className={inputClass}
                  value={movFilters.dateTo}
                  onChange={(e) => {
                    setMovFilters((f) => ({ ...f, dateTo: e.target.value }))
                    setMovPage(0)
                  }}
                />
              </div>

              {(movFilters.type !== 'all' || movFilters.dateFrom || movFilters.dateTo) && (
                <button
                  onClick={() => {
                    setMovFilters({ type: 'all', dateFrom: '', dateTo: '' })
                    setMovPage(0)
                  }}
                  className="flex items-center gap-1.5 text-xs text-[#8b5cf6] hover:underline"
                >
                  <X size={11} /> Limpiar filtros
                </button>
              )}
            </div>

            {/* Table */}
            {loadingMov ? (
              <div className="space-y-px p-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : movRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <TrendingUp size={22} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Sin movimientos registrados</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Los movimientos se crean al vender, devolver o ajustar stock.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #ebe9e6', background: '#fafaf9' }}>
                      {['Fecha / hora', 'Tipo', 'Producto', 'Talla', 'Color', 'Cantidad', 'Usuario', 'Referencia'].map(
                        (h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {movRows.map((m) => (
                      <tr
                        key={m.id}
                        style={{ borderBottom: '1px solid #f5f4f1' }}
                        className="hover:bg-[#fafaf9]"
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#737373]">
                          {fmtDateTime(m.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <MovTypeBadge type={m.type} />
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#1a1a1a]">
                          {m.variants?.products?.name ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {m.variants?.size ? (
                            <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-1.5 text-xs font-semibold">
                              {m.variants.size}
                            </span>
                          ) : (
                            <span className="text-[#a8a29e]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {m.variants?.color ? (
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-3 w-3 rounded-full"
                                style={{
                                  background: getColorHex(m.variants.color),
                                  boxShadow: '0 0 0 1px #d6d3d1',
                                }}
                              />
                              <span className="text-xs capitalize text-[#525252]">
                                {m.variants.color}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[#a8a29e]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="font-mono text-sm font-semibold"
                            style={{ color: m.qty >= 0 ? '#166534' : '#b91c1c' }}
                          >
                            {m.qty >= 0 ? '+' : ''}
                            {m.qty}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-[#525252]">
                          {profileMap[m.created_by] ?? (
                            <span className="font-mono text-xs text-[#a8a29e]">
                              {m.created_by.slice(0, 8)}…
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {m.reference_id ? (
                            <span className="font-mono text-xs text-[#737373]">
                              {m.reference_id.slice(0, 8)}…
                            </span>
                          ) : m.notes ? (
                            <span className="max-w-[180px] truncate block text-xs text-[#737373]" title={m.notes}>
                              {m.notes}
                            </span>
                          ) : (
                            <span className="text-[#a8a29e]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {movTotal > MOV_PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-[#f5f4f1] px-5 py-3">
                <p className="text-xs text-[#a8a29e]">
                  {movPage * MOV_PAGE_SIZE + 1}–
                  {Math.min((movPage + 1) * MOV_PAGE_SIZE, movTotal)} de {movTotal} movimientos
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMovPage((p) => p - 1)}
                    disabled={movPage === 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-[#737373]">
                    {movPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setMovPage((p) => p + 1)}
                    disabled={movPage >= totalPages - 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AdjustModal open={showAdjustModal} onClose={() => setShowAdjustModal(false)} />
    </>
  )
}
