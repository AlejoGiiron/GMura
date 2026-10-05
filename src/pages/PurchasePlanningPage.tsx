import { Fragment, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Archive,
  Banknote,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Layers,
  Package,
  Store as StoreIcon,
} from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useActiveStoreId } from '@/hooks/useActiveStoreId'
import { useMyStores } from '@/hooks/useStores'
import { useSalesByCategory } from '@/hooks/usePlanningReports'
import { DateRangeFilter, type DateRangeValue } from '@/components/ui/DateRangeFilter'
import { resolveDateRange, type DateRangePreset } from '@/lib/dateRange'
import {
  buildCategoryReport,
  categoryDisplayLabel,
  sizeDisplayLabel,
  type CategoryLine,
  type CategoryReport,
  type StoreRef,
} from '@/lib/categoryReport'
import {
  addSheet,
  addTotalRow,
  createWorkbook,
  downloadWorkbook,
  fileSlug,
  type ExcelColumn,
  type ExcelRowValues,
} from '@/lib/excel'

// Planificación de compras — fase 0: ventas por categoría × talla.
// Sección propia (no dentro de ReportsPage): es la base de los informes de
// temporada (ABC y reposición llegan en las fases siguientes).

// Para planificar se mira una ventana larga: 90 días por defecto.
const PLANNING_PRESETS: DateRangePreset[] = ['last30', 'last90', 'month', 'prev-month', 'custom']
const DEFAULT_PRESET: DateRangePreset = 'last90'

/** 'all' = consolidado de todas las tiendas del usuario. */
type Scope = 'all' | string

const fmtInt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`

// ── Small components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, mono = false, hint }: {
  label: string
  value: string
  icon: React.ElementType
  mono?: boolean
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-500">
          <Icon size={18} />
        </div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">{label}</p>
      </div>
      <p
        className={`leading-none tracking-[-0.025em] tabular-nums text-[#1a1a1a] ${
          mono ? 'font-mono text-[20px] font-semibold' : 'text-[26px] font-bold'
        }`}
        style={{ fontFamily: mono ? undefined : "'Bricolage Grotesque', sans-serif" }}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-[11px] text-[#a8a29e]">{hint}</p>}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-px p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  )
}

function ScopeSelector({ stores, scope, onChange }: {
  stores: StoreRef[]
  scope: Scope
  onChange: (s: Scope) => void
}) {
  const options: { value: Scope; label: string }[] = [
    ...(stores.length > 1 ? [{ value: 'all', label: 'Consolidado' }] : []),
    ...stores.map((s) => ({ value: s.id, label: s.name })),
  ]
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[#ebe9e6] bg-white p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
            scope === o.value ? 'bg-violet-500 text-white' : 'text-[#525252] hover:bg-[#f8f7f5]'
          }`}
        >
          {o.value === 'all' ? <Layers size={13} /> : <StoreIcon size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SourceBadge({ line }: { line: CategoryLine }) {
  if (line.source === 'category' && !line.fromTransfer) return null
  const text =
    line.source === 'inferred' ? 'Inferido por talla'
    : line.source === 'none' ? 'Sin categoría'
    : 'Por traslado'
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
      {text}
      {line.fromTransfer && line.source !== 'category' ? ' · traslado' : ''}
    </span>
  )
}

/** Curva de tallas de una categoría (fila expandida). */
function SizeCurve({ line, stores, consolidated }: {
  line: CategoryLine
  stores: StoreRef[]
  consolidated: boolean
}) {
  const max = Math.max(1, ...line.sizes.map((s) => s.unitsNet))
  return (
    <div className="bg-[#fafaf9] px-6 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Curva de tallas
      </p>
      <div className="space-y-1.5">
        {line.sizes.map((s) => (
          <div key={s.size ?? '—'} className="flex items-center gap-3 text-sm">
            <span className="inline-flex h-6 w-16 shrink-0 items-center justify-center rounded-[5px] bg-white px-2 text-xs font-semibold text-[#1a1a1a] ring-1 ring-[#ebe9e6]">
              {sizeDisplayLabel(s.size)}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#f0eeeb]">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{ width: `${(Math.max(0, s.unitsNet) / max) * 100}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-xs font-semibold tabular-nums">
              {fmtInt.format(s.unitsNet)}
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-[#737373]">
              {fmtPct(s.share)}
            </span>
            {consolidated && stores.map((st) => (
              <span key={st.id} className="hidden w-16 shrink-0 text-right font-mono text-xs tabular-nums text-[#a8a29e] lg:inline" title={st.name}>
                {fmtInt.format(s.byStore[st.id]?.unitsNet ?? 0)}
              </span>
            ))}
            <span className="w-24 shrink-0 text-right text-xs text-[#737373]">
              <span className="font-mono tabular-nums">{fmtInt.format(s.available)}</span> disp.
            </span>
          </div>
        ))}
      </div>
      {consolidated && (
        <p className="mt-3 hidden text-[11px] text-[#a8a29e] lg:block">
          Columnas grises: unidades netas por tienda ({stores.map((s) => s.name).join(' · ')}).
        </p>
      )}
    </div>
  )
}

// ── Excel ─────────────────────────────────────────────────────────────────────

async function exportCategoryExcel(
  report: CategoryReport,
  consolidated: boolean,
  scopeName: string,
  dateFrom: string,
  dateTo: string,
): Promise<void> {
  const wb = await createWorkbook()
  const storeCols: ExcelColumn[] = consolidated
    ? report.stores.map((s, i) => ({ header: `Netas ${s.name}`, key: `store_${i}`, width: 18 }))
    : []
  const storeValues = (byStore: CategoryLine['byStore']): ExcelRowValues =>
    consolidated
      ? Object.fromEntries(report.stores.map((s, i) => [`store_${i}`, byStore[s.id]?.unitsNet ?? 0]))
      : {}

  // Hoja 1 — Por categoría
  const ws1 = addSheet(wb, 'Por categoría', [
    { header: 'Categoría', key: 'cat', width: 34 },
    { header: 'Nombres unidos', key: 'names', width: 26 },
    ...storeCols,
    { header: 'Vendidas', key: 'sold', width: 11 },
    { header: 'Devueltas', key: 'returned', width: 11 },
    { header: 'Netas', key: 'net', width: 10 },
    { header: 'De regalo', key: 'gift', width: 11 },
    { header: '% unidades', key: 'share', width: 12, percent: true },
    { header: 'Ventas netas', key: 'amount', width: 16, money: true },
    { header: '$ por unidad', key: 'ppu', width: 14, money: true },
    { header: 'Disponible hoy', key: 'avail', width: 15 },
    { header: 'Cobertura (días)', key: 'cover', width: 16 },
  ])
  for (const c of report.categories) {
    ws1.addRow({
      cat: categoryDisplayLabel(c),
      names: c.names.join(', '),
      ...storeValues(c.byStore),
      sold: c.unitsSold,
      returned: c.unitsReturned,
      net: c.unitsNet,
      gift: c.giftUnits,
      share: c.share,
      amount: c.amountNet,
      ppu: c.pricePerUnit,
      avail: c.available,
      cover: c.coverageDays,
    })
  }
  const storeTotals: ExcelRowValues = consolidated
    ? Object.fromEntries(report.stores.map((s, i) => [
        `store_${i}`,
        report.categories.reduce((sum, c) => sum + (c.byStore[s.id]?.unitsNet ?? 0), 0),
      ]))
    : {}
  addTotalRow(ws1, {
    cat: 'TOTAL',
    ...storeTotals,
    sold: report.totals.unitsSold,
    returned: report.totals.unitsReturned,
    net: report.totals.unitsNet,
    gift: report.totals.giftUnits,
    amount: report.totals.amountNet,
    avail: report.totals.available,
  })

  // Hoja 2 — Curva de tallas
  const ws2 = addSheet(wb, 'Curva de tallas', [
    { header: 'Categoría', key: 'cat', width: 34 },
    { header: 'Talla', key: 'size', width: 10 },
    ...storeCols,
    { header: 'Netas', key: 'net', width: 10 },
    { header: '% de la categoría', key: 'share', width: 17, percent: true },
    { header: 'Ventas netas', key: 'amount', width: 16, money: true },
    { header: 'Disponible hoy', key: 'avail', width: 15 },
  ])
  for (const c of report.categories) {
    for (const s of c.sizes) {
      ws2.addRow({
        cat: categoryDisplayLabel(c),
        size: sizeDisplayLabel(s.size),
        ...storeValues(s.byStore),
        net: s.unitsNet,
        share: s.share,
        amount: s.amountNet,
        avail: s.available,
      })
    }
  }

  // Hoja 3 — Cómo leerlo (el Excel viaja solo; sin esto las cifras se malinterpretan)
  const ws3 = addSheet(wb, 'Cómo leerlo', [{ header: 'Nota', key: 'nota', width: 110 }])
  for (const nota of [
    `Período: ${dateFrom} a ${dateTo} (${report.days} días). Alcance: ${scopeName}.`,
    'Netas = vendidas − devueltas. Las devoluciones cuentan en la fecha en que se hicieron.',
    'Incluye ventas directas, separados entregados, fiados y los ítems nuevos de un cambio. Las ventas anuladas no cuentan.',
    'Los regalos cuentan como unidad (salió mercancía) pero $0 en ventas.',
    'Los separados ACTIVOS no son venta todavía: su mercancía ya está descontada del "Disponible hoy".',
    'Cobertura = días que alcanza el disponible de hoy vendiendo al ritmo del período.',
    'Categorías unidas entre tiendas (lista fija, no cambia sola): BERMUDA = BERMUDA H., BLUSA = BLUSAS, BUSO = BUSOS. Ver la columna "Nombres unidos".',
    '"Inferido por talla": productos sin categoría con talla de pantalón de dama u hombre.',
  ]) ws3.addRow({ nota })

  await downloadWorkbook(
    wb,
    `planificacion-categorias-${fileSlug(scopeName)}-${dateFrom}_${dateTo}.xlsx`,
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchasePlanningPage() {
  const activeStoreId = useActiveStoreId()
  const { data: myStores = [], isLoading: storesLoading } = useMyStores()

  const stores = useMemo<StoreRef[]>(
    () => myStores.map((s) => ({ id: s.store_id, name: s.store_name })),
    [myStores],
  )

  // null = el usuario todavía no eligió: consolidado si tiene varias tiendas,
  // si no su tienda activa.
  const [pickedScope, setPickedScope] = useState<Scope | null>(null)
  const scope: Scope = pickedScope ?? (stores.length > 1 ? 'all' : activeStoreId)
  const consolidated = scope === 'all'
  // Hasta saber cuántas tiendas tiene no se consulta: evita pedir primero la
  // tienda activa y enseguida el consolidado.
  const storeIds = storesLoading ? [] : consolidated ? stores.map((s) => s.id) : scope ? [scope] : []
  const scopeName = consolidated
    ? 'Consolidado'
    : stores.find((s) => s.id === scope)?.name ?? 'Tienda'

  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET)
  const [range, setRange] = useState(() => resolveDateRange(DEFAULT_PRESET))
  const handleDateChange = (next: DateRangeValue) => {
    setPreset(next.preset)
    setRange({ dateFrom: next.dateFrom, dateTo: next.dateTo })
  }

  const { data: rows, isLoading, isError } = useSalesByCategory({
    storeIds,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  })

  const report = useMemo(
    () => (rows ? buildCategoryReport(rows, range.dateFrom, range.dateTo) : null),
    [rows, range.dateFrom, range.dateTo],
  )
  // Columnas por tienda: las que pidió el informe, aunque alguna no tenga filas.
  const reportStores = consolidated ? stores : stores.filter((s) => s.id === scope)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    if (!report || report.categories.length === 0) {
      toast.error('No hay datos para exportar')
      return
    }
    setExporting(true)
    try {
      await exportCategoryExcel(
        { ...report, stores: reportStores },
        consolidated,
        scopeName,
        range.dateFrom,
        range.dateTo,
      )
    } catch {
      toast.error('No se pudo generar el Excel')
    } finally {
      setExporting(false)
    }
  }

  const thCls =
    'whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]'
  const thNum = `${thCls} text-right`
  const loading = storesLoading || isLoading

  return (
    <>
      {/* Page header */}
      <div
        className="flex items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <div>
          <h1
            className="tracking-[-0.02em]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}
          >
            Planificación de compras
          </h1>
          <p className="text-xs text-[#a8a29e]">Ventas por categoría y curva de tallas</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || !report || report.categories.length === 0}
          className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5] disabled:opacity-50"
        >
          <Download size={14} />
          {exporting ? 'Generando…' : 'Exportar Excel'}
        </button>
      </div>

      {/* Body */}
      <div className="space-y-6 p-6" style={{ background: '#f8f7f5', minHeight: 'calc(100vh - 64px)' }}>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {stores.length > 0 && (
            <ScopeSelector stores={stores} scope={scope} onChange={setPickedScope} />
          )}
          <DateRangeFilter
            preset={preset}
            dateFrom={range.dateFrom}
            dateTo={range.dateTo}
            presets={PLANNING_PRESETS}
            onChange={handleDateChange}
          />
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Unidades netas"
            value={report ? fmtInt.format(report.totals.unitsNet) : '—'}
            icon={Package}
            hint={report && report.totals.unitsReturned > 0
              ? `${fmtInt.format(report.totals.unitsSold)} vendidas − ${fmtInt.format(report.totals.unitsReturned)} devueltas`
              : undefined}
          />
          <KpiCard label="Ventas netas" value={report ? fmtCOP(report.totals.amountNet) : '—'} icon={Banknote} mono />
          <KpiCard
            label="Disponible hoy"
            value={report ? fmtInt.format(report.totals.available) : '—'}
            icon={Archive}
            hint={report && report.totals.reserved > 0
              ? `Sin contar ${fmtInt.format(report.totals.reserved)} reservadas en separados`
              : undefined}
          />
          <KpiCard
            label="Días del período"
            value={report ? fmtInt.format(report.days) : '—'}
            icon={Layers}
            hint={`${range.dateFrom || '…'} a ${range.dateTo || '…'}`}
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
          <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
            <div>
              <h2 className="text-[13px] font-semibold text-[#1a1a1a]">Ventas por categoría</h2>
              <p className="mt-0.5 text-xs text-[#a8a29e]">Tocá una categoría para ver su curva de tallas</p>
            </div>
            {report && <span className="text-xs text-[#a8a29e]">{report.categories.length} categorías</span>}
          </div>

          {loading ? (
            <SkeletonRows />
          ) : isError ? (
            <p className="py-12 text-center text-sm text-slate-400">No se pudo cargar el informe</p>
          ) : !report || report.categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Package size={20} className="text-slate-300" />
              </div>
              <p className="text-sm text-slate-400">Sin ventas ni stock en el período seleccionado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#ebe9e6] bg-[#fafaf9]">
                    <th className={thCls}>Categoría</th>
                    {consolidated && reportStores.map((s) => (
                      <th key={s.id} className={`${thNum} max-w-[120px] truncate`} title={s.name}>{s.name}</th>
                    ))}
                    <th className={thNum}>Unid. netas</th>
                    <th className={thNum}>%</th>
                    <th className={thNum}>Ventas netas</th>
                    <th className={thNum}>$ / unidad</th>
                    <th className={thNum}>Disponible</th>
                    <th className={thNum} title="Días que alcanza el disponible al ritmo de venta del período">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((c) => {
                    const open = expanded.has(c.id)
                    return (
                      <Fragment key={c.id}>
                        <tr
                          onClick={() => toggle(c.id)}
                          className="cursor-pointer border-b border-[#f5f4f1] hover:bg-[#fafaf9]"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center">
                              {open
                                ? <ChevronDown size={14} className="mr-2 shrink-0 text-violet-500" />
                                : <ChevronRight size={14} className="mr-2 shrink-0 text-[#a8a29e]" />}
                              <span className="text-sm font-medium text-[#1a1a1a]">{c.label}</span>
                              <SourceBadge line={c} />
                            </div>
                            {(c.names.length > 1 || c.giftUnits > 0) && (
                              <p className="ml-6 mt-0.5 text-[11px] text-[#a8a29e]">
                                {c.names.length > 1 && `Une: ${c.names.join(', ')}`}
                                {c.names.length > 1 && c.giftUnits > 0 && ' · '}
                                {c.giftUnits > 0 && `${fmtInt.format(c.giftUnits)} de regalo`}
                              </p>
                            )}
                          </td>
                          {consolidated && reportStores.map((s) => (
                            <td key={s.id} className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#737373]">
                              {fmtInt.format(c.byStore[s.id]?.unitsNet ?? 0)}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">
                            {fmtInt.format(c.unitsNet)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-[#737373]">
                            {fmtPct(c.share)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                            {fmtCOP(c.amountNet)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#737373]">
                            {c.pricePerUnit != null ? fmtCOP(c.pricePerUnit) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                            {fmtInt.format(c.available)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                            {c.coverageDays != null
                              ? <span className={c.coverageDays < 30 ? 'font-semibold text-red-600' : c.coverageDays < 60 ? 'text-amber-600' : 'text-[#525252]'}>
                                  {fmtInt.format(c.coverageDays)} d
                                </span>
                              : <span className="text-[#a8a29e]">sin ventas</span>}
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-[#f5f4f1]">
                            <td colSpan={7 + (consolidated ? reportStores.length : 0)} className="p-0">
                              <SizeCurve line={c} stores={reportStores} consolidated={consolidated} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#ebe9e6] bg-[#fafaf9]">
                    <td className="px-4 py-3 text-sm font-semibold text-[#1a1a1a]">Total</td>
                    {consolidated && reportStores.map((s) => (
                      <td key={s.id} className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-[#737373]">
                        {fmtInt.format(report.categories.reduce((sum, c) => sum + (c.byStore[s.id]?.unitsNet ?? 0), 0))}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">{fmtInt.format(report.totals.unitsNet)}</td>
                    <td />
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">{fmtCOP(report.totals.amountNet)}</td>
                    <td />
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums">{fmtInt.format(report.totals.available)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* How to read it */}
        <div className="flex gap-3 rounded-xl border border-[#ebe9e6] bg-white px-5 py-4 text-xs leading-relaxed text-[#737373]">
          <Info size={16} className="mt-0.5 shrink-0 text-violet-500" />
          <div className="space-y-1">
            <p>
              <span className="font-semibold text-[#525252]">Unidades netas</span> = vendidas − devueltas (la devolución
              cuenta el día que se hizo). Incluye ventas directas, separados entregados, fiados y cambios; los regalos
              suman unidades pero $0.
            </p>
            <p>
              <span className="font-semibold text-[#525252]">Disponible</span> = stock de hoy sin lo reservado en
              separados activos. <span className="font-semibold text-[#525252]">Cobertura</span> = días que alcanza
              ese disponible vendiendo al ritmo del período.
            </p>
            <p>
              En el consolidado se unen categorías equivalentes entre tiendas, según una lista fija (BERMUDA =
              BERMUDA H., BLUSA = BLUSAS, BUSO = BUSOS). Las filas "inferido por talla" son productos sin categoría con talla de
              pantalón de dama u hombre.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
