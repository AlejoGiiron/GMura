import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'
import { usePermissions } from '@/hooks/usePermissions'
import { useMyStores } from '@/hooks/useStores'
import {
  useTransferList,
  useTransferStatusCounts,
  type TransferDirection,
  type TransferListRow,
  type TransferStatusFilter,
} from '@/hooks/useTransfers'
import { TransferStatusBadge, ConfirmedByChip } from '@/components/transfers/TransferBadges'
import { RpcErrorBlock } from '@/components/transfers/TransferPieces'
import {
  CancelDraftModal,
  RevertDispatchModal,
} from '@/components/transfers/TransferActionModals'
import {
  confirmedBy,
  formatTransferMoney,
  formatTransferNumber,
} from '@/lib/transfers'

// Grilla de 7 columnas del handoff §1.1. Encabezado y filas comparten la
// constante para que no se desalineen (la lección de SalesHistoryPage).
const ROW_GRID =
  'grid grid-cols-[108px_1fr_128px_92px_132px_1fr_128px] items-center gap-3 px-5'

const STATUS_FILTERS: { key: TransferStatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'draft', label: 'Borrador' },
  { key: 'in_transit', label: 'En tránsito' },
  { key: 'received', label: 'Recibido' },
  { key: 'cancelled', label: 'Cancelado' },
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export default function TransfersPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { data: myStores = [] } = useMyStores()

  const [direction, setDirection] = useState<TransferDirection>('incoming')
  const [status, setStatus] = useState<TransferStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<TransferListRow | null>(null)
  const [reverting, setReverting] = useState<TransferListRow | null>(null)

  const canManage = can('traslados.gestionar')

  const { data, isLoading, isFetching, error, refetch } = useTransferList({
    direction,
    status,
    page: 0,
  })
  const { data: counts } = useTransferStatusCounts(direction)
  const { data: incomingCounts } = useTransferStatusCounts('incoming')
  const pendingIncoming = incomingCounts?.in_transit ?? 0

  const activeStoreName =
    myStores.find((s) => s.is_current)?.store_name ?? 'tu tienda'

  // Búsqueda local a la página: sin debounce (handoff §1.1).
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all
    return all.filter((r) => {
      const other = direction === 'outgoing' ? r.to_store_name : r.from_store_name
      return (
        formatTransferNumber(r.transfer_number).toLowerCase().includes(q) ||
        other.toLowerCase().includes(q)
      )
    })
  }, [data?.rows, search, direction])

  function switchTab(dir: TransferDirection) {
    setDirection(dir)
    // Borrador solo existe en Mis envíos: un borrador ajeno no existe para mí.
    if (dir === 'incoming' && status === 'draft') setStatus('all')
    setMenuFor(null)
  }

  const visibleFilters = STATUS_FILTERS.filter(
    (f) => !(f.key === 'draft' && direction === 'incoming'),
  )

  return (
    <div className="flex h-full min-w-[1240px] flex-col bg-[#fafaf9]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-neutral-900">
            Traslados
          </h1>
          <p className="text-[12px] text-neutral-500">
            Tienda {activeStoreName} · mercancía que entra y sale
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => navigate('/traslados/nuevo')}
            disabled={myStores.length < 2}
            title={
              myStores.length < 2
                ? 'Necesitás al menos dos tiendas para trasladar mercancía'
                : undefined
            }
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          >
            <Plus size={15} />
            Nuevo traslado
          </button>
        )}
      </header>

      {/* ── Barra de pendientes ────────────────────────────────────────────── */}
      {direction === 'outgoing' && pendingIncoming > 0 && (
        <div className="flex flex-shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-2.5">
          <p className="flex items-center gap-2 text-[12.5px] text-amber-800">
            <AlertTriangle size={14} className="text-amber-600" />
            Tenés <strong className="font-mono">{pendingIncoming}</strong> traslados por recibir.
            Si no los confirmás, la mercancía no entra al stock de {activeStoreName}.
          </p>
          <button
            onClick={() => switchTab('incoming')}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-amber-800 hover:underline"
          >
            Ver por recibir <ArrowRight size={13} />
          </button>
        </div>
      )}

      {/* ── Pestañas ───────────────────────────────────────────────────────── */}
      <nav className="flex flex-shrink-0 gap-1 border-b border-stone-200 bg-white px-6">
        {(
          [
            { key: 'outgoing' as const, label: 'Mis envíos', hint: 'los que mando' },
            { key: 'incoming' as const, label: 'Por recibir', hint: 'los que me mandan' },
          ]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            aria-current={direction === tab.key ? 'page' : undefined}
            title={tab.hint}
            className={`relative flex items-center gap-2 px-3 py-3 text-[13px] font-semibold transition-colors ${
              direction === tab.key
                ? 'text-violet-700'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {tab.label}
            {tab.key === 'incoming' && pendingIncoming > 0 && (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 font-mono text-[10px] font-semibold text-white">
                {pendingIncoming}
              </span>
            )}
            {direction === tab.key && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-violet-600" />
            )}
          </button>
        ))}
      </nav>

      {/* ── Filtros ────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-6 py-2.5">
        <div className="flex items-center gap-1.5">
          {visibleFilters.map((f) => {
            const n = counts?.[f.key] ?? 0
            const active = status === f.key
            return (
              <button
                key={f.key}
                onClick={() => setStatus(f.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  active
                    ? 'border-neutral-800 bg-neutral-800 text-white'
                    : 'border-stone-200 bg-white text-neutral-600 hover:bg-stone-50'
                }`}
              >
                {f.label}
                <span className={`font-mono text-[11px] ${active ? 'text-white/70' : 'text-neutral-400'}`}>
                  {n}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número o tienda…"
            className="w-full rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-[12.5px] text-neutral-700 placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
          />
        </div>
      </div>

      {/* ── Tabla ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <div
            className={`${ROW_GRID} border-b border-stone-200 bg-stone-50 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400`}
          >
            <span>Número</span>
            <span>{direction === 'outgoing' ? 'Destino' : 'Origen'}</span>
            <span>Estado</span>
            <span className="text-right">Unidades</span>
            <span className="text-right">Valor venta</span>
            <span>Envío / recepción</span>
            <span />
          </div>

          {error ? (
            <div className="p-5">
              <RpcErrorBlock message={(error as Error).message} onRetry={() => void refetch()} />
            </div>
          ) : isLoading ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <EmptyState
              direction={direction}
              filtered={status !== 'all' || search.trim().length > 0}
              canManage={canManage}
              onNew={() => navigate('/traslados/nuevo')}
            />
          ) : (
            <div className={isFetching ? 'pointer-events-none opacity-50 transition-opacity' : ''}>
              {rows.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  direction={direction}
                  canManage={canManage}
                  menuOpen={menuFor === r.id}
                  onToggleMenu={() => setMenuFor(menuFor === r.id ? null : r.id)}
                  onOpen={() => navigate(`/traslados/${r.id}`)}
                  onEdit={() => navigate(`/traslados/${r.id}/editar`)}
                  onCancel={() => {
                    setCancelling(r)
                    setMenuFor(null)
                  }}
                  onRevert={() => {
                    setReverting(r)
                    setMenuFor(null)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {cancelling && (
        <CancelDraftModal
          transferId={cancelling.id}
          transferNumber={cancelling.transfer_number}
          onClose={() => setCancelling(null)}
        />
      )}
      {reverting && (
        <RevertDispatchModal
          transferId={reverting.id}
          transferNumber={reverting.transfer_number}
          units={reverting.total_qty}
          fromStoreName={reverting.from_store_name}
          onClose={() => setReverting(null)}
        />
      )}
    </div>
  )
}

// ─── Fila ─────────────────────────────────────────────────────────────────────

function Row({
  row,
  direction,
  canManage,
  menuOpen,
  onToggleMenu,
  onOpen,
  onEdit,
  onCancel,
  onRevert,
}: {
  row: TransferListRow
  direction: TransferDirection
  canManage: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onOpen: () => void
  onEdit: () => void
  onCancel: () => void
  onRevert: () => void
}) {
  const otherStore = direction === 'outgoing' ? row.to_store_name : row.from_store_name
  const who = confirmedBy(row.received_by_store_id, row.to_store_id, row.from_store_id)

  // Acciones del menú "···" (handoff §0.3): son de excepción, nunca primarias.
  const canCancelDraft = canManage && row.status === 'draft' && row.is_outgoing
  const canRevert = canManage && row.status === 'in_transit' && row.is_outgoing
  const hasMenu = canCancelDraft || canRevert

  return (
    <div className={`${ROW_GRID} border-b border-stone-100 py-3 last:border-b-0 hover:bg-stone-50/60`}>
      <div>
        <p className="font-mono text-[13px] font-semibold text-neutral-800">
          {formatTransferNumber(row.transfer_number)}
        </p>
        <p className="text-[11px] text-neutral-400">
          {fmtDate(row.dispatched_at ?? row.created_at)}
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-neutral-800">{otherStore}</p>
        <p className="truncate text-[11.5px] text-neutral-500">
          {row.item_count} productos
          {row.new_products_count > 0 && (
            <> · {row.new_products_count} fichas nuevas</>
          )}
        </p>
      </div>

      <TransferStatusBadge status={row.status} />

      <span className="text-right font-mono text-[13px] font-semibold text-neutral-800">
        {row.total_qty}
      </span>

      <span className="text-right font-mono text-[13px] text-neutral-700">
        {formatTransferMoney(row.total_value)}
      </span>

      {/* Columna de auditoría: el contraste gris/ámbar es el punto de la columna. */}
      <div className="min-w-0">
        {row.status === 'received' && who ? (
          <>
            <ConfirmedByChip who={who} storeName={row.received_by_store_name ?? '—'} />
            <p className="mt-0.5 text-[11px] text-neutral-400">{fmtDate(row.received_at)}</p>
          </>
        ) : (
          <p className="truncate text-[12px] text-neutral-500">
            {row.carrier || row.tracking_ref ? (
              <>
                {row.carrier ?? '—'}
                {row.tracking_ref && (
                  <span className="ml-1.5 font-mono text-neutral-400">{row.tracking_ref}</span>
                )}
              </>
            ) : (
              'Sin definir'
            )}
          </p>
        )}
      </div>

      <div className="relative flex items-center justify-end gap-1.5">
        {row.status === 'in_transit' && !row.is_outgoing && canManage ? (
          <button
            onClick={onOpen}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-violet-700"
          >
            Recibir
          </button>
        ) : row.status === 'draft' && row.is_outgoing && canManage ? (
          <button
            onClick={onEdit}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-stone-50"
          >
            Seguir editando
          </button>
        ) : (
          <button
            onClick={onOpen}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-stone-50"
          >
            Ver
          </button>
        )}

        {hasMenu && (
          <>
            <button
              onClick={onToggleMenu}
              aria-label="Más acciones"
              aria-expanded={menuOpen}
              className="rounded-lg border border-stone-200 bg-white p-1.5 text-neutral-500 hover:bg-stone-50"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                {canCancelDraft && (
                  <button
                    onClick={onCancel}
                    className="block w-full px-3 py-2 text-left text-[12.5px] text-neutral-700 hover:bg-stone-50"
                  >
                    Descartar borrador
                  </button>
                )}
                {canRevert && (
                  <button
                    onClick={onRevert}
                    className="block w-full px-3 py-2 text-left text-[12.5px] text-red-600 hover:bg-red-50"
                  >
                    Revertir despacho
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Estados ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`${ROW_GRID} border-b border-stone-100 py-4 last:border-b-0`}>
          {Array.from({ length: 7 }).map((__, j) => (
            <div key={j} className="h-3.5 animate-pulse rounded bg-stone-100" />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  direction,
  filtered,
  canManage,
  onNew,
}: {
  direction: TransferDirection
  filtered: boolean
  canManage: boolean
  onNew: () => void
}) {
  // Nunca ofrecer "crear" como única salida cuando el problema es el filtro.
  if (filtered) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Inbox size={30} className="text-neutral-300" />
        <p className="mt-3 text-[14px] font-semibold text-neutral-700">
          No hay traslados con este filtro
        </p>
        <p className="mt-1 text-[12.5px] text-neutral-500">
          Probá con otro estado o creá un traslado nuevo.
        </p>
      </div>
    )
  }

  const isIncoming = direction === 'incoming'
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Inbox size={30} className="text-neutral-300" />
      <p className="mt-3 text-[14px] font-semibold text-neutral-700">
        {isIncoming ? 'No tenés traslados por recibir' : 'Todavía no mandaste ningún traslado'}
      </p>
      <p className="mt-1 text-[12.5px] text-neutral-500">
        {isIncoming
          ? 'Cuando otra tienda te mande mercancía, aparece acá.'
          : 'Armá un envío para mover mercancía a otra tienda.'}
      </p>
      {!isIncoming && canManage && (
        <button
          onClick={onNew}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700"
        >
          <Plus size={15} />
          Nuevo traslado
        </button>
      )}
    </div>
  )
}
