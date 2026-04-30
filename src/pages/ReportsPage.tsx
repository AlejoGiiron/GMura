import { useState, useMemo } from 'react'
import {
  startOfDay, endOfDay, startOfWeek, startOfMonth, endOfMonth,
  subMonths, subDays, parseISO, format, differenceInDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import {
  Banknote, ShoppingCart, Tag, Package, RotateCcw, Archive,
  TrendingUp, TrendingDown, Download, ArrowUpRight,
  ChevronLeft, ChevronRight, BarChart2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fmtCOP } from '@/lib/formatters'
import { useReports, useInventoryReport } from '@/hooks/useReports'
import type { DailySalesSummary, PaymentMethod, ProductPerformance } from '@/types/database.types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  cash:     '#10b981',
  card:     '#8b5cf6',
  transfer: '#3b82f6',
  nequi:    '#ec4899',
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash:     'Efectivo',
  card:     'Tarjeta',
  transfer: 'Transferencia',
  nequi:    'Nequi',
}

const PERIOD_OPTIONS = [
  { id: 'today',      label: 'Hoy' },
  { id: 'week',       label: 'Esta semana' },
  { id: 'month',      label: 'Este mes' },
  { id: 'prev-month', label: 'Mes anterior' },
  { id: 'custom',     label: 'Personalizado' },
] as const

type Period = typeof PERIOD_OPTIONS[number]['id']

const VAR_PAGE_SIZE = 20

// ── Types ─────────────────────────────────────────────────────────────────────

type DailyBarRow = {
  label:    string
  rawDate:  string
  cash:     number
  card:     number
  transfer: number
  nequi:    number
}

type PaymentSlice  = { name: string; value: number; color: string }
type ReturnsRow    = { label: string; rawDate: string; count: number }
type TopProductRow = { name: string; units: number }

type SortKey = 'units_sold' | 'net_revenue' | 'return_units' | 'return_rate'
type SortDir = 'asc' | 'desc'

type ProductWithRate = ProductPerformance & { return_rate: number }
type CardTone        = 'normal' | 'red' | 'yellow' | 'green'

interface TooltipItem { name: string; value: number; color: string }
interface ChartTooltipProps {
  active?:  boolean
  payload?: TooltipItem[]
  label?:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(a: number, b: number): number | null {
  return b > 0 ? ((a - b) / b) * 100 : null
}

function fmtLabel(iso: string): string {
  try { return format(parseISO(iso + 'T00:00:00'), 'd MMM', { locale: es }) }
  catch { return iso }
}

function fmtYAxis(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return fmtCOP(v)
}

function pivotDailySales(rows: DailySalesSummary[]): DailyBarRow[] {
  const map = new Map<string, DailyBarRow>()
  for (const r of rows) {
    const entry = map.get(r.sale_date) ?? {
      label: fmtLabel(r.sale_date), rawDate: r.sale_date,
      cash: 0, card: 0, transfer: 0, nequi: 0,
    }
    entry[r.payment_method] = (entry[r.payment_method] ?? 0) + Number(r.total_sum)
    map.set(r.sale_date, entry)
  }
  return [...map.values()].sort((a, b) => a.rawDate.localeCompare(b.rawDate))
}

function getSortValue(p: ProductWithRate, key: SortKey): number {
  switch (key) {
    case 'units_sold':   return p.units_sold
    case 'net_revenue':  return Number(p.net_revenue)
    case 'return_units': return p.return_units
    case 'return_rate':  return p.return_rate
  }
}

// ── Small components ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-9 w-9 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-2.5 w-24 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-7 w-36 animate-pulse rounded bg-slate-100" />
    </div>
  )
}

function SkeletonChart({ height = 260 }: { height?: number }) {
  return <div className="animate-pulse rounded-xl bg-slate-100" style={{ height }} />
}

function SectionCard({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
      <div className="border-b border-[#f5f4f1] px-5 py-4">
        <h2 className="text-[13px] font-semibold text-[#1a1a1a]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[#a8a29e]">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <BarChart2 size={20} className="text-slate-300" />
      </div>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

function KpiCard({ label, value, icon: Icon, tone = 'normal', mono = false, change }: {
  label:   string
  value:   string | number
  icon:    React.ElementType
  tone?:   CardTone
  mono?:   boolean
  change?: number | null
}) {
  const iconStyles: Record<CardTone, string> = {
    normal: 'bg-violet-50 text-violet-500',
    red:    'bg-red-50 text-red-500',
    yellow: 'bg-amber-50 text-amber-500',
    green:  'bg-emerald-50 text-emerald-500',
  }
  const valueTones: Record<CardTone, string> = {
    normal: '#1a1a1a', red: '#dc2626', yellow: '#d97706', green: '#059669',
  }
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconStyles[tone]}`}>
            <Icon size={18} />
          </div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">{label}</p>
        </div>
        {change != null && (
          <span className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
            change >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
          }`}>
            {change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <p
        className={`leading-none tracking-[-0.025em] tabular-nums ${
          mono ? 'font-mono text-[20px] font-semibold' : 'text-[26px] font-bold'
        }`}
        style={{ fontFamily: mono ? undefined : "'Bricolage Grotesque', sans-serif", color: valueTones[tone] }}
      >
        {value}
      </p>
    </div>
  )
}

function CopTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const sum = payload.reduce((s, p) => s + p.value, 0)
  return (
    <div className="rounded-xl border border-[#ebe9e6] bg-white px-3 py-2.5 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-[#525252]">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="text-xs text-[#737373]">{p.name}:</span>
          <span className="font-mono text-xs font-semibold text-[#1a1a1a]">{fmtCOP(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1.5 border-t border-[#f5f4f1] pt-1.5">
          <span className="font-mono text-xs font-bold text-[#1a1a1a]">Total: {fmtCOP(sum)}</span>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const navigate = useNavigate()

  // Period state
  const [period,     setPeriod]     = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const { from, to } = useMemo((): { from: Date; to: Date } => {
    const now = new Date()
    switch (period) {
      case 'today':      return { from: startOfDay(now), to: endOfDay(now) }
      case 'week':       return { from: startOfWeek(now, { weekStartsOn: 1 }), to: now }
      case 'month':      return { from: startOfMonth(now), to: now }
      case 'prev-month': {
        const prev = subMonths(now, 1)
        return { from: startOfMonth(prev), to: endOfMonth(prev) }
      }
      case 'custom':
        if (customFrom && customTo) return { from: parseISO(customFrom), to: parseISO(customTo) }
        return { from: startOfMonth(now), to: now }
    }
  }, [period, customFrom, customTo])

  const { prevFrom, prevTo } = useMemo(() => {
    const dur = differenceInDays(to, from)
    return { prevFrom: subDays(from, dur + 1), prevTo: subDays(from, 1) }
  }, [from, to])

  // Data
  const { dailySales, productPerformance, returnsSummary, isLoading } = useReports({ from, to })
  const { dailySales: prevSales } = useReports({ from: prevFrom, to: prevTo })
  const { data: invReport, isLoading: invLoading } = useInventoryReport()

  // Variants table state
  const [sortKey, setSortKey] = useState<SortKey>('units_sold')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [varPage, setVarPage] = useState(0)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
    setVarPage(0)
  }

  // ── Derived data ────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalSales  = dailySales.reduce((s, r) => s + Number(r.total_sum),   0)
    const totalOrders = dailySales.reduce((s, r) => s + r.order_count,         0)
    const avgTicket   = totalOrders > 0 ? totalSales / totalOrders : 0
    const itemsSold   = dailySales.reduce((s, r) => s + r.items_sold,          0)
    const itemsRet    = returnsSummary.reduce((s, r) => s + r.items_returned,  0)
    const returnRate  = itemsSold > 0 ? (itemsRet / itemsSold) * 100 : 0

    const prevTotal  = prevSales.reduce((s, r) => s + Number(r.total_sum), 0)
    const prevOrders = prevSales.reduce((s, r) => s + r.order_count,       0)
    const prevAvg    = prevOrders > 0 ? prevTotal / prevOrders : 0
    const prevItems  = prevSales.reduce((s, r) => s + r.items_sold,        0)

    return {
      totalSales, totalOrders, avgTicket, itemsSold, returnRate,
      salesChange:  pct(totalSales,  prevTotal),
      ordersChange: pct(totalOrders, prevOrders),
      ticketChange: pct(avgTicket,   prevAvg),
      itemsChange:  pct(itemsSold,   prevItems),
    }
  }, [dailySales, prevSales, returnsSummary])

  const dailyBarData = useMemo(() => pivotDailySales(dailySales), [dailySales])

  const paymentPieData = useMemo((): PaymentSlice[] => {
    const totals: Partial<Record<PaymentMethod, number>> = {}
    for (const r of dailySales)
      totals[r.payment_method] = (totals[r.payment_method] ?? 0) + Number(r.total_sum)
    return (Object.keys(PAYMENT_COLORS) as PaymentMethod[])
      .map((pm) => ({ name: PAYMENT_LABELS[pm], value: totals[pm] ?? 0, color: PAYMENT_COLORS[pm] }))
      .filter((d) => d.value > 0)
  }, [dailySales])

  const topProductsData = useMemo((): TopProductRow[] =>
    productPerformance.slice(0, 10).map((p) => ({
      name:  [p.product_name, p.size && `T.${p.size}`, p.color].filter(Boolean).join(' '),
      units: p.units_sold,
    })).reverse(),
    [productPerformance],
  )

  const returnsChartData = useMemo((): ReturnsRow[] => {
    const map = new Map<string, ReturnsRow>()
    for (const r of returnsSummary) {
      const entry = map.get(r.return_date) ?? { label: fmtLabel(r.return_date), rawDate: r.return_date, count: 0 }
      entry.count += r.return_count
      map.set(r.return_date, entry)
    }
    return [...map.values()].sort((a, b) => a.rawDate.localeCompare(b.rawDate))
  }, [returnsSummary])

  const sortedVariants = useMemo((): ProductWithRate[] =>
    [...productPerformance]
      .map((p) => ({ ...p, return_rate: p.units_sold > 0 ? (p.return_units / p.units_sold) * 100 : 0 }))
      .sort((a, b) => (sortDir === 'desc' ? -1 : 1) * (getSortValue(a, sortKey) - getSortValue(b, sortKey))),
    [productPerformance, sortKey, sortDir],
  )

  const pagedVariants = sortedVariants.slice(varPage * VAR_PAGE_SIZE, (varPage + 1) * VAR_PAGE_SIZE)
  const totalVarPages = Math.ceil(sortedVariants.length / VAR_PAGE_SIZE)

  const top10ByValue = useMemo(() =>
    [...(invReport?.items ?? [])]
      .sort((a, b) => Number(b.stock_value) - Number(a.stock_value))
      .slice(0, 10),
    [invReport],
  )

  // ── Excel export ────────────────────────────────────────────────────────────

  async function exportExcel() {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    wb.creator = 'G-Mura'

    const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF5F4F1' } }
    const BOLD = { bold: true, size: 11 }

    function styleHeader(ws: import('exceljs').Worksheet) {
      const r = ws.getRow(1); r.font = BOLD; r.fill = HEADER_FILL; r.commit()
    }

    // Hoja 1 — Ventas
    const ws1 = wb.addWorksheet('Ventas')
    ws1.columns = [
      { header: 'Fecha',     key: 'fecha',     width: 14 },
      { header: 'Método',    key: 'metodo',    width: 16 },
      { header: 'Órdenes',   key: 'ordenes',   width: 10 },
      { header: 'Unidades',  key: 'unidades',  width: 12 },
      { header: 'Subtotal',  key: 'subtotal',  width: 18 },
      { header: 'Descuento', key: 'descuento', width: 18 },
      { header: 'Total',     key: 'total',     width: 18 },
    ]
    styleHeader(ws1)
    let tOrd = 0, tUni = 0, tSub = 0, tDes = 0, tTot = 0
    for (const r of dailySales) {
      ws1.addRow({
        fecha: r.sale_date, metodo: PAYMENT_LABELS[r.payment_method],
        ordenes: r.order_count, unidades: r.items_sold,
        subtotal: Number(r.subtotal_sum), descuento: Number(r.discount_sum), total: Number(r.total_sum),
      })
      tOrd += r.order_count; tUni += r.items_sold
      tSub += Number(r.subtotal_sum); tDes += Number(r.discount_sum); tTot += Number(r.total_sum)
    }
    const tot1 = ws1.addRow({ fecha: 'TOTAL', metodo: '', ordenes: tOrd, unidades: tUni, subtotal: tSub, descuento: tDes, total: tTot })
    tot1.font = BOLD

    // Hoja 2 — Productos
    const ws2 = wb.addWorksheet('Productos')
    ws2.columns = [
      { header: 'Producto',          key: 'product',      width: 30 },
      { header: 'Marca',             key: 'brand',        width: 18 },
      { header: 'Categoría',         key: 'category',     width: 18 },
      { header: 'Talla',             key: 'size',         width: 10 },
      { header: 'Color',             key: 'color',        width: 14 },
      { header: 'SKU',               key: 'sku',          width: 16 },
      { header: 'Unidades vendidas', key: 'units_sold',   width: 18 },
      { header: 'Revenue bruto',     key: 'revenue',      width: 18 },
      { header: 'Devoluciones',      key: 'return_units', width: 16 },
      { header: 'Revenue neto',      key: 'net_revenue',  width: 18 },
    ]
    styleHeader(ws2)
    for (const p of productPerformance) {
      ws2.addRow({
        product: p.product_name, brand: p.brand ?? '', category: p.category_name ?? '',
        size: p.size ?? '', color: p.color ?? '', sku: p.sku ?? '',
        units_sold: p.units_sold, revenue: Number(p.revenue),
        return_units: p.return_units, net_revenue: Number(p.net_revenue),
      })
    }

    // Hoja 3 — Inventario
    const ws3 = wb.addWorksheet('Inventario')
    ws3.columns = [
      { header: 'Producto',         key: 'product',     width: 30 },
      { header: 'Talla',            key: 'size',        width: 10 },
      { header: 'Color',            key: 'color',       width: 14 },
      { header: 'SKU',              key: 'sku',         width: 16 },
      { header: 'Stock',            key: 'stock_qty',   width: 10 },
      { header: 'Stock mínimo',     key: 'min_stock',   width: 14 },
      { header: 'Precio venta',     key: 'price',       width: 16 },
      { header: 'Costo unitario',   key: 'cost_price',  width: 16 },
      { header: 'Valor inventario', key: 'stock_value', width: 18 },
      { header: 'Estado',           key: 'estado',      width: 14 },
    ]
    styleHeader(ws3)
    for (const item of invReport?.items ?? []) {
      const label = item.stock_state === 'out' ? 'Sin stock' : item.stock_state === 'low' ? 'Stock bajo' : 'Normal'
      const row = ws3.addRow({
        product: item.product_name, size: item.size ?? '', color: item.color ?? '',
        sku: item.sku ?? '', stock_qty: item.stock_qty, min_stock: item.min_stock,
        price: Number(item.price),
        cost_price: item.cost_price != null ? Number(item.cost_price) : '',
        stock_value: Number(item.stock_value), estado: label,
      })
      const fill =
        item.stock_state === 'out'
          ? { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFEE2E2' } }
          : item.stock_state === 'low'
            ? { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFEF3C7' } }
            : null
      if (fill) row.eachCell((cell) => { cell.fill = fill })
    }

    // Hoja 4 — Devoluciones
    const ws4 = wb.addWorksheet('Devoluciones')
    ws4.columns = [
      { header: 'Fecha',             key: 'fecha',  width: 14 },
      { header: 'Tipo',              key: 'tipo',   width: 14 },
      { header: 'Cantidad',          key: 'count',  width: 12 },
      { header: 'Ítems devueltos',   key: 'items',  width: 16 },
      { header: 'Monto reembolsado', key: 'refund', width: 20 },
    ]
    styleHeader(ws4)
    for (const r of returnsSummary) {
      ws4.addRow({
        fecha: r.return_date,
        tipo:  r.return_type === 'return' ? 'Devolución' : 'Cambio',
        count: r.return_count, items: r.items_returned, refund: Number(r.refund_amount),
      })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gmura_reporte_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Shared styles ────────────────────────────────────────────────────────────

  const inputCls =
    'h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm text-[#525252] outline-none ' +
    'focus:border-[#8b5cf6] focus:shadow-[0_0_0_3px_#8b5cf61a] transition-[border-color,box-shadow]'

  const thCls =
    'whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Page header */}
      <div
        className="flex items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <h1
          className="tracking-[-0.02em]"
          style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}
        >
          Reportes
        </h1>
        <button
          onClick={exportExcel}
          className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
        >
          <Download size={14} />
          Exportar Excel
        </button>
      </div>

      {/* Body */}
      <div className="space-y-6 p-6" style={{ background: '#f8f7f5', minHeight: 'calc(100vh - 64px)' }}>

        {/* ── Period selector ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-[#ebe9e6] bg-white p-1.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPeriod(opt.id)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  period === opt.id ? 'bg-[#8b5cf6] text-white shadow-sm' : 'text-[#737373] hover:text-[#525252]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#737373]">Desde</label>
              <input type="date" className={inputCls} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <label className="text-xs text-[#737373]">Hasta</label>
              <input type="date" className={inputCls} value={customTo}   onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}

          <p className="ml-auto text-xs text-[#a8a29e]">
            {format(from, 'd MMM yyyy', { locale: es })} – {format(to, 'd MMM yyyy', { locale: es })}
          </p>
        </div>

        {/* ── KPI cards ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : (
              <>
                <KpiCard label="Ventas totales"     value={fmtCOP(kpis.totalSales)}            icon={Banknote}    mono change={kpis.salesChange} />
                <KpiCard label="Número de órdenes"  value={kpis.totalOrders}                   icon={ShoppingCart}      change={kpis.ordersChange} />
                <KpiCard label="Ticket promedio"    value={fmtCOP(kpis.avgTicket)}             icon={Tag}         mono change={kpis.ticketChange} />
                <KpiCard label="Unidades vendidas"  value={kpis.itemsSold}                     icon={Package}           change={kpis.itemsChange} />
                <KpiCard
                  label="Tasa de devolución"
                  value={`${kpis.returnRate.toFixed(1)}%`}
                  icon={RotateCcw}
                  tone={kpis.returnRate > 10 ? 'red' : kpis.returnRate > 5 ? 'yellow' : 'normal'}
                />
                <KpiCard label="Valor inventario"   value={fmtCOP(invReport?.totalValue ?? 0)} icon={Archive}     mono />
              </>
            )}
        </div>

        {/* ── Row 1: Daily sales + Payment pie ────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          <div className="lg:col-span-2">
            <SectionCard title="Ventas diarias por método de pago">
              {isLoading ? (
                <SkeletonChart height={260} />
              ) : dailyBarData.length === 0 ? (
                <EmptyChart message="Sin ventas en el período seleccionado" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyBarData} barSize={16} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f5f4f1" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtYAxis} tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} width={68} />
                    <Tooltip content={<CopTooltip />} />
                    <Legend iconType="circle" iconSize={8}
                      formatter={(v: string) => <span style={{ fontSize: 11, color: '#737373' }}>{v}</span>} />
                    <Bar dataKey="cash"     name="Efectivo"       stackId="a" fill={PAYMENT_COLORS.cash}     radius={[0,0,0,0]} />
                    <Bar dataKey="transfer" name="Transferencia"   stackId="a" fill={PAYMENT_COLORS.transfer} radius={[0,0,0,0]} />
                    <Bar dataKey="nequi"    name="Nequi"           stackId="a" fill={PAYMENT_COLORS.nequi}    radius={[0,0,0,0]} />
                    <Bar dataKey="card"     name="Tarjeta"         stackId="a" fill={PAYMENT_COLORS.card}     radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Distribución por método">
            {isLoading ? (
              <SkeletonChart height={260} />
            ) : paymentPieData.length === 0 ? (
              <EmptyChart message="Sin datos de pago" />
            ) : (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={paymentPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2} dataKey="value">
                      {paymentPieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmtCOP(Number(v ?? 0))]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {paymentPieData.map((d) => {
                    const total = paymentPieData.reduce((s, p) => s + p.value, 0)
                    const p = total > 0 ? (d.value / total) * 100 : 0
                    return (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                          <span className="text-xs text-[#525252]">{d.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="block font-mono text-xs font-semibold text-[#1a1a1a]">{fmtCOP(d.value)}</span>
                          <span className="text-[10px] text-[#a8a29e]">{p.toFixed(1)}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Row 2: Top products + Returns ───────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          <SectionCard title="Top 10 variantes más vendidas">
            {isLoading ? (
              <SkeletonChart height={320} />
            ) : topProductsData.length === 0 ? (
              <EmptyChart message="Sin ventas en el período" />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topProductsData} layout="vertical" barSize={11} margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f4f1" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#525252' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v) => [Number(v ?? 0), 'Unidades']}
                    contentStyle={{ border: '1px solid #ebe9e6', borderRadius: 12, fontSize: 12 }}
                  />
                  <Bar dataKey="units" name="Unidades" fill="#8b5cf6" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          <SectionCard title="Devoluciones por día">
            {isLoading ? (
              <SkeletonChart height={320} />
            ) : returnsChartData.length === 0 ? (
              <EmptyChart message="Sin devoluciones en el período" />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={returnsChartData}>
                  <defs>
                    <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f4f1" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip
                    formatter={(v) => [Number(v ?? 0), 'Devoluciones']}
                    contentStyle={{ border: '1px solid #ebe9e6', borderRadius: 12, fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} fill="url(#retGrad)"
                    dot={{ r: 3, fill: '#ef4444', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#ef4444', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        {/* ── Variants performance table ───────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
          <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
            <h2 className="text-[13px] font-semibold text-[#1a1a1a]">Variantes por desempeño</h2>
            <span className="text-xs text-[#a8a29e]">{sortedVariants.length} variantes</span>
          </div>

          {isLoading ? (
            <div className="space-y-px p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : sortedVariants.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Package size={20} className="text-slate-300" />
              </div>
              <p className="text-sm text-slate-400">Sin ventas en el período seleccionado</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#ebe9e6] bg-[#fafaf9]">
                      {([
                        { label: 'Producto',      key: null                        },
                        { label: 'Marca',         key: null                        },
                        { label: 'Talla',         key: null                        },
                        { label: 'Color',         key: null                        },
                        { label: 'Uds. vendidas', key: 'units_sold'   as SortKey   },
                        { label: 'Revenue neto',  key: 'net_revenue'  as SortKey   },
                        { label: 'Devoluciones',  key: 'return_units' as SortKey   },
                        { label: '% dev.',        key: 'return_rate'  as SortKey   },
                      ] as const).map(({ label, key }) => (
                        <th
                          key={label}
                          onClick={() => key && toggleSort(key)}
                          className={`${thCls} ${key ? 'cursor-pointer select-none hover:text-[#525252]' : ''}`}
                        >
                          {label}
                          {key === sortKey && (
                            <span className="ml-1 text-[#8b5cf6]">{sortDir === 'desc' ? '↓' : '↑'}</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedVariants.map((p) => (
                      <tr key={p.variant_id} className="border-b border-[#f5f4f1] last:border-0 hover:bg-[#fafaf9]">
                        <td className="px-4 py-3 text-sm font-medium text-[#1a1a1a]">{p.product_name}</td>
                        <td className="px-4 py-3 text-sm text-[#525252]">{p.brand ?? <span className="text-[#a8a29e]">—</span>}</td>
                        <td className="px-4 py-3">
                          {p.size
                            ? <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-2 text-xs font-semibold">{p.size}</span>
                            : <span className="text-[#a8a29e]">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm capitalize text-[#525252]">{p.color ?? <span className="text-[#a8a29e]">—</span>}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">{p.units_sold}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">{fmtCOP(Number(p.net_revenue))}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#737373]">{p.return_units}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-mono text-xs font-semibold ${
                            p.return_rate > 10 ? 'text-red-500' : p.return_rate > 5 ? 'text-amber-500' : 'text-emerald-600'
                          }`}>
                            {p.return_rate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalVarPages > 1 && (
                <div className="flex items-center justify-between border-t border-[#f5f4f1] px-5 py-3">
                  <p className="text-xs text-[#a8a29e]">
                    {varPage * VAR_PAGE_SIZE + 1}–{Math.min((varPage + 1) * VAR_PAGE_SIZE, sortedVariants.length)} de {sortedVariants.length}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setVarPage((p) => p - 1)} disabled={varPage === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-[#737373]">{varPage + 1} / {totalVarPages}</span>
                    <button onClick={() => setVarPage((p) => p + 1)} disabled={varPage >= totalVarPages - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Inventory section ────────────────────────────────────────────── */}
        <div className="space-y-4">
          <h2
            className="tracking-[-0.02em]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 18, fontWeight: 600, color: '#1a1a1a' }}
          >
            Resumen de inventario
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {invLoading ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />) : (
              <>
                <KpiCard label="Valor total inventario" value={fmtCOP(invReport?.totalValue ?? 0)} icon={Archive} mono />

                {/* Out of stock */}
                <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
                      <Package size={18} />
                    </div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">Variantes sin stock</p>
                  </div>
                  <div className="flex items-end justify-between">
                    <p
                      className="text-[26px] font-bold leading-none tabular-nums tracking-[-0.025em]"
                      style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: (invReport?.outOfStockCount ?? 0) > 0 ? '#dc2626' : '#1a1a1a' }}
                    >
                      {invReport?.outOfStockCount ?? 0}
                    </p>
                    <button onClick={() => navigate('/inventario')} className="flex items-center gap-1 text-xs font-medium text-[#8b5cf6] hover:underline">
                      Ver <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>

                {/* Low stock */}
                <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                      <Package size={18} />
                    </div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">Variantes stock bajo</p>
                  </div>
                  <div className="flex items-end justify-between">
                    <p
                      className="text-[26px] font-bold leading-none tabular-nums tracking-[-0.025em]"
                      style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: (invReport?.lowStockCount ?? 0) > 0 ? '#d97706' : '#1a1a1a' }}
                    >
                      {invReport?.lowStockCount ?? 0}
                    </p>
                    <button onClick={() => navigate('/inventario')} className="flex items-center gap-1 text-xs font-medium text-[#8b5cf6] hover:underline">
                      Ver <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <SectionCard
            title="Top 10 — mayor valor inmovilizado"
            subtitle="Variantes con mayor capital en inventario (stock × costo unitario)"
          >
            {invLoading ? (
              <div className="space-y-px">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : top10ByValue.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Sin variantes activas con costo registrado</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#ebe9e6] bg-[#fafaf9]">
                      {['Producto', 'Talla', 'Color', 'Stock', 'Costo unitario', 'Valor total'].map((h) => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top10ByValue.map((item) => (
                      <tr key={item.variant_id} className="border-b border-[#f5f4f1] last:border-0 hover:bg-[#fafaf9]">
                        <td className="px-4 py-3 text-sm font-medium text-[#1a1a1a]">{item.product_name}</td>
                        <td className="px-4 py-3">
                          {item.size
                            ? <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-2 text-xs font-semibold">{item.size}</span>
                            : <span className="text-[#a8a29e]">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm capitalize text-[#525252]">{item.color ?? <span className="text-[#a8a29e]">—</span>}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">{item.stock_qty}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#525252]">
                          {item.cost_price != null ? fmtCOP(Number(item.cost_price)) : <span className="text-[#a8a29e]">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-[#1a1a1a]">
                          {fmtCOP(Number(item.stock_value))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

      </div>
    </>
  )
}
