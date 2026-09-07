import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Search, Store, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import { usePermissions } from '@/hooks/usePermissions'
import { useMyStores } from '@/hooks/useStores'
import { useStoreVariantSearch, type StoreVariantOption } from '@/hooks/useStoreVariantSearch'
import { useTransferDetail, type TransferTarget } from '@/hooks/useTransfers'
import { useSaveTransferDraft } from '@/hooks/useTransferMutations'
import { TransferStatusBadge } from '@/components/transfers/TransferBadges'
import { InlineAlert, KeyValueRow, RailPanel } from '@/components/transfers/TransferPieces'
import TransferLineCard from '@/components/transfers/TransferLineCard'
import DispatchModal from '@/components/transfers/DispatchModal'
import { formatTransferMoney, formatTransferNumber, MAPPING_TOKENS } from '@/lib/transfers'
import {
  availableOf,
  buildItemsPayload,
  firstUndecided,
  groupCandidates,
  resolveInitialDestination,
  summarize,
  type DraftLine,
} from '@/lib/transferBuilder'

// Trae los candidatos del destino para UNA variante, con la misma queryKey que
// useTransferTargets: la tarjeta de línea después los lee de la caché sin
// volver a pedirlos. Se necesita imperativo porque §4.1 decide la
// preselección EN EL MOMENTO de agregar, antes de que la tarjeta se monte.
async function fetchTargets(
  queryClient: ReturnType<typeof useQueryClient>,
  toStoreId: string,
  fromVariantId: string,
): Promise<TransferTarget[]> {
  return queryClient.fetchQuery({
    queryKey: ['transfer-targets', toStoreId, fromVariantId, null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_transfer_targets' as never, {
        p_to_store_id: toStoreId,
        p_from_variant_id: fromVariantId,
        p_query: null,
      } as never)
      if (error) throw error
      return (data ?? []) as unknown as TransferTarget[]
    },
  })
}

export default function TransferBuilderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { data: myStores = [] } = useMyStores()
  const fromStoreId = getActiveStoreId(profile)

  const canCreateProducts = can('productos.gestionar')
  const save = useSaveTransferDraft()

  const [toStoreId, setToStoreId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [carrier, setCarrier] = useState('')
  const [trackingRef, setTrackingRef] = useState('')
  const [notes, setNotes] = useState('')
  const [transferId, setTransferId] = useState<string | null>(id ?? null)
  const [transferNumber, setTransferNumber] = useState<number | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [loadingCandidates, setLoadingCandidates] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const pendingLinkRef = useRef<HTMLButtonElement>(null)

  const otherStores = myStores.filter((s) => s.store_id !== fromStoreId)
  const fromStoreName = myStores.find((s) => s.store_id === fromStoreId)?.store_name ?? 'tu tienda'
  const destStoreName = myStores.find((s) => s.store_id === toStoreId)?.store_name ?? '—'

  // Destino por defecto: si la organización tiene exactamente dos tiendas, no
  // hay nada que elegir.
  useEffect(() => {
    if (!toStoreId && otherStores.length === 1) setToStoreId(otherStores[0].store_id)
  }, [otherStores, toStoreId])

  // ── Cargar un borrador existente ──────────────────────────────────────────
  const { data: existing } = useTransferDetail(id ?? null)
  const hydrated = useRef(false)
  useEffect(() => {
    if (!existing || hydrated.current) return
    hydrated.current = true
    if (existing.status !== 'draft') {
      navigate(`/traslados/${existing.id}`, { replace: true })
      return
    }
    setToStoreId(existing.to_store_id)
    setTransferNumber(existing.transfer_number)
    setCarrier(existing.carrier ?? '')
    setTrackingRef(existing.tracking_ref ?? '')
    setNotes(existing.notes ?? '')
    // Al cargar un borrador TODAS las líneas arrancan colapsadas, incluso las
    // sin decidir: abrir cuatro selectores de golpe hace la pantalla ilegible.
    setLines(
      existing.items.map((i) => ({
        key: i.id,
        fromVariantId: i.from_variant_id,
        productName: i.product_name,
        brand: i.brand,
        description: i.description,
        size: i.size,
        color: i.color,
        unitPrice: Number(i.unit_price),
        // El borrador no guarda el stock actual: se relee al tocar la línea.
        stockQty: i.qty_sent,
        reservedQty: 0,
        qty: i.qty_sent,
        destAction: i.dest_action,
        toProductId: i.to_product_id,
        toVariantId: i.to_variant_id,
        manuallyChosen: true,
      })),
    )
    setExpandedKey(null)
  }, [existing, navigate])

  // ── Buscador ──────────────────────────────────────────────────────────────
  const excluded = useMemo(() => lines.map((l) => l.fromVariantId), [lines])
  const { data: results = [], isFetching: searching } = useStoreVariantSearch(query, excluded)

  const addLine = useCallback(
    async (v: StoreVariantOption) => {
      if (!toStoreId) {
        toast.error('Elegí primero la tienda destino')
        return
      }
      setLoadingCandidates(true)
      let candidates: TransferTarget[] = []
      try {
        candidates = await fetchTargets(queryClient, toStoreId, v.variant_id)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setLoadingCandidates(false)
      }

      const initial = resolveInitialDestination(groupCandidates(candidates), canCreateProducts)
      const key = `${v.variant_id}-${Date.now()}`
      setLines((prev) => [
        ...prev,
        {
          key,
          fromVariantId: v.variant_id,
          productName: v.product_name,
          brand: v.brand,
          description: v.description,
          size: v.size,
          color: v.color,
          unitPrice: v.unit_price,
          stockQty: v.stock_qty,
          reservedQty: v.reserved_qty,
          qty: 1,
          destAction: initial.destAction,
          toProductId: initial.toProductId,
          toVariantId: initial.toVariantId,
          manuallyChosen: false,
        },
      ])
      // Solo una línea abierta a la vez.
      setExpandedKey(initial.open ? key : null)
      setQuery('')
      searchRef.current?.focus()
    },
    [toStoreId, queryClient, canCreateProducts],
  )

  // ── Cambiar la tienda destino (§4.2) ──────────────────────────────────────
  async function changeDestination(nextStore: string) {
    if (nextStore === toStoreId) return
    const manuales = lines.filter((l) => l.manuallyChosen && l.destAction !== null)
    if (manuales.length > 0) {
      const storeName = otherStores.find((s) => s.store_id === nextStore)?.store_name ?? 'la tienda'
      const okConfirm = window.confirm(
        `Cambiar el destino a ${storeName} vuelve a calcular todos los mapeos. ` +
          `Los que elegiste a mano se pierden. ¿Seguimos?`,
      )
      if (!okConfirm) return
    }

    setToStoreId(nextStore)
    setExpandedKey(null)
    if (lines.length === 0) return

    // Los candidatos de una tienda no significan nada en otra: se recalcula
    // TODO desde cero. Las cantidades y las líneas se conservan — lo que se
    // manda no cambió, cambió a dónde va.
    setLoadingCandidates(true)
    try {
      const recalculated = await Promise.all(
        lines.map(async (l) => {
          const rows = await fetchTargets(queryClient, nextStore, l.fromVariantId)
          const init = resolveInitialDestination(groupCandidates(rows), canCreateProducts)
          return {
            ...l,
            destAction: init.destAction,
            toProductId: init.toProductId,
            toVariantId: init.toVariantId,
            manuallyChosen: false,
          }
        }),
      )
      setLines(recalculated)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingCandidates(false)
    }
  }

  // ── Guardar / despachar ───────────────────────────────────────────────────
  const summary = summarize(lines)
  const pendingIdx = firstUndecided(lines)
  const hasUndecided = pendingIdx >= 0

  async function persist(): Promise<string | null> {
    // §0.1 — con líneas sin decidir se BLOQUEA. Descartarlas en silencio sería
    // peor: el usuario cree que guardó 6 productos y volvió con 4.
    if (hasUndecided) {
      toast.error(
        summary.undecided === 1
          ? 'Hay 1 línea sin destino. Elegí a dónde va antes de guardar el borrador.'
          : `Hay ${summary.undecided} líneas sin destino. Elegí a dónde va cada una antes de guardar el borrador.`,
      )
      goToFirstUndecided()
      return null
    }
    const res = await save.mutateAsync({
      to_store_id: toStoreId,
      items: buildItemsPayload(lines),
      transfer_id: transferId,
      carrier: carrier.trim() || null,
      tracking_ref: trackingRef.trim() || null,
      notes: notes.trim() || null,
    })
    setTransferId(res.id)
    setTransferNumber(res.transfer_number)

    // El estado local se refresca con lo que DEVUELVE la RPC, no con lo que se
    // mandó: save_transfer_draft degrada map_product → map_variant cuando esa
    // talla/color ya existe en el destino, y el borrador tiene que reflejar el
    // dest_action real.
    const items = (res as unknown as { items?: DraftItemFromRpc[] }).items
    if (items?.length) {
      setLines((prev) =>
        prev.map((l) => {
          const srv = items.find((i) => i.from_variant_id === l.fromVariantId)
          return srv
            ? {
                ...l,
                key: srv.id,
                destAction: srv.dest_action,
                toProductId: srv.to_product_id,
                toVariantId: srv.to_variant_id,
              }
            : l
        }),
      )
    }
    return res.id
  }

  function goToFirstUndecided() {
    const idx = firstUndecided(lines)
    if (idx < 0) return
    setExpandedKey(lines[idx].key)
    document.getElementById(`linea-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function handleSave() {
    const savedId = await persist()
    if (savedId) toast.success('Borrador guardado')
  }

  async function handleDispatch() {
    const savedId = await persist()
    if (savedId) setDispatching(true)
  }

  // §4.3 — foco al entrar: el buscador en un envío nuevo; el enlace de
  // pendientes si el borrador cargado tiene líneas sin decidir.
  useEffect(() => {
    if (hasUndecided && lines.length > 0) pendingLinkRef.current?.focus()
    else searchRef.current?.focus()
    // Solo al montar / al terminar de hidratar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing])

  if (otherStores.length === 0) {
    return (
      <div className="p-6">
        <InlineAlert tone="info">
          Necesitás al menos dos tiendas en la organización para trasladar mercancía.
        </InlineAlert>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-[1240px] flex-col bg-[#fafaf9]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/traslados')}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-stone-100 hover:text-neutral-600"
            aria-label="Volver a traslados"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-neutral-900">
                Traslado
              </h1>
              {transferNumber && (
                <span className="font-mono text-[15px] font-semibold text-neutral-500">
                  {formatTransferNumber(transferNumber)}
                </span>
              )}
              <TransferStatusBadge status="draft" />
            </div>
            <p className="text-[12px] text-neutral-500">
              El stock no se ha movido. Podés editar hasta despachar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={lines.length === 0 || save.isPending}
            className="h-[38px] rounded-lg border border-stone-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-neutral-300"
          >
            {save.isPending ? 'Guardando…' : 'Guardar borrador'}
          </button>
          <button
            onClick={handleDispatch}
            disabled={lines.length === 0 || hasUndecided || save.isPending}
            title={hasUndecided ? 'Resolvé las líneas sin destino para poder despachar' : undefined}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          >
            <Truck size={15} />
            Despachar envío
          </button>
        </div>
      </header>

      {/* ── Barra de ruta ──────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <Store size={15} className="text-neutral-400" />
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400">
              Sale de
            </p>
            <p className="text-[13.5px] font-semibold text-neutral-800">{fromStoreName}</p>
          </div>
        </div>
        <ArrowRight size={16} className="text-neutral-300" />
        <div className="flex items-center gap-2">
          <Store size={15} className="text-violet-500" />
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400">
              Llega a
            </p>
            <select
              value={toStoreId}
              onChange={(e) => void changeDestination(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[13.5px] font-semibold text-neutral-800 focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
            >
              <option value="">Elegí la tienda…</option>
              {otherStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Columna de líneas ────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          {/* Buscador */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter agrega el primer resultado.
                if (e.key === 'Enter' && results.length > 0) void addLine(results[0])
                if (e.key === 'Escape') setQuery('')
              }}
              disabled={!toStoreId}
              placeholder={`Buscar producto de ${fromStoreName} para agregar al envío…`}
              className="w-full rounded-lg border border-stone-200 bg-white py-2.5 pl-9 pr-3 text-[13px] placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10 disabled:bg-stone-50"
            />

            {query.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                {searching ? (
                  <p className="px-3 py-2 text-[12.5px] text-neutral-400">Buscando…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-2 text-[12.5px] text-neutral-500">
                    Ningún producto coincide con «{query.trim()}».
                  </p>
                ) : (
                  results.map((v) => (
                    <button
                      key={v.variant_id}
                      onClick={() => void addLine(v)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-neutral-800">
                          {v.product_name}
                          {v.brand && (
                            <span className="ml-1.5 text-[10.5px] font-bold tracking-[0.06em] text-neutral-400">
                              {v.brand}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[12px] text-neutral-500">
                          {[v.description, v.size && `T.${v.size}`, v.color]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <span className="font-mono text-[12.5px] text-neutral-600">
                        {formatTransferMoney(v.unit_price)}
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                          v.available <= 1
                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                            : 'border-stone-200 bg-stone-50 text-neutral-600'
                        }`}
                      >
                        {v.available} disp.
                      </span>
                      {v.reserved_qty > 0 && (
                        <span className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] text-violet-700">
                          {v.reserved_qty} apart.
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Título de la pila */}
          <div className="mb-2.5 mt-4 flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-neutral-800">
              Productos del envío ({lines.length})
            </h2>
            {hasUndecided && (
              <button
                ref={pendingLinkRef}
                onClick={goToFirstUndecided}
                className="text-[12.5px] font-semibold text-red-600 hover:underline"
              >
                Ir a la primera sin decidir
              </button>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
              <p className="text-[14px] font-semibold text-neutral-700">
                Todavía no agregaste productos
              </p>
              <p className="mt-1 text-[12.5px] text-neutral-500">
                Buscá arriba un producto de {fromStoreName} para empezar el envío.
              </p>
            </div>
          ) : (
            <div className={`space-y-[10px] ${loadingCandidates ? 'opacity-60' : ''}`}>
              {lines.map((l, idx) => (
                <TransferLineCard
                  key={l.key}
                  line={l}
                  index={idx}
                  toStoreId={toStoreId}
                  destStoreName={destStoreName}
                  canCreateProducts={canCreateProducts}
                  expanded={expandedKey === l.key}
                  onToggle={() => setExpandedKey(expandedKey === l.key ? null : l.key)}
                  onQtyChange={(n) =>
                    setLines((prev) =>
                      prev.map((x) =>
                        x.key === l.key
                          ? { ...x, qty: Math.max(1, Math.min(n, availableOf(x))) }
                          : x,
                      ),
                    )
                  }
                  onDestinationChange={(v) => {
                    setLines((prev) =>
                      prev.map((x) =>
                        x.key === l.key ? { ...x, ...v, manuallyChosen: true } : x,
                      ),
                    )
                    // Al elegir, la línea se colapsa sola: el usuario ve la
                    // franja cambiar de color y sigue con la siguiente.
                    setExpandedKey(null)
                  }}
                  onRemove={() => {
                    setLines((prev) => prev.filter((x) => x.key !== l.key))
                    if (expandedKey === l.key) setExpandedKey(null)
                  }}
                />
              ))}
            </div>
          )}
        </main>

        {/* ── Rail derecho ─────────────────────────────────────────────────── */}
        <aside className="w-[330px] flex-shrink-0 space-y-3 overflow-y-auto border-l border-stone-200 bg-[#fafaf9] px-4 py-4">
          <RailPanel title="Resumen">
            <KeyValueRow label="Productos" value={summary.products} mono />
            <KeyValueRow label="Unidades" value={summary.units} mono />
            <KeyValueRow
              label="Valor a precio de venta"
              value={formatTransferMoney(summary.value)}
              mono
            />
            <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">
              Precio de venta de {fromStoreName} al momento de despachar. No es el costo.
            </p>
          </RailPanel>

          <RailPanel title="Cómo se mapea en el destino">
            <div className="space-y-1.5">
              {(
                [
                  ['exact', summary.exact],
                  ['newSize', summary.newSize],
                  ['newProduct', summary.newProduct],
                  ['undecided', summary.undecided],
                ] as const
              ).map(([k, n]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span
                    className={`flex items-center gap-2 text-[12.5px] ${
                      n === 0 ? 'text-neutral-300' : 'text-neutral-700'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        n === 0 ? 'bg-neutral-200' : MAPPING_TOKENS[k].dot
                      }`}
                    />
                    {MAPPING_TOKENS[k].label}
                  </span>
                  <span
                    className={`font-mono text-[13px] font-semibold ${
                      n === 0 ? 'text-neutral-300' : 'text-neutral-800'
                    }`}
                  >
                    {n}
                  </span>
                </div>
              ))}
            </div>

            {summary.newProduct > 0 && (
              <div className="mt-2.5">
                <InlineAlert tone="warning">
                  {summary.newProduct === 1
                    ? `1 ficha nueva se creará en ${destStoreName}. Revisá que no exista ya con otro nombre.`
                    : `${summary.newProduct} fichas nuevas se crearán en ${destStoreName}. Revisá que no exista ya con otro nombre.`}
                </InlineAlert>
              </div>
            )}
            {summary.undecided > 0 && (
              <div className="mt-2">
                <InlineAlert tone="danger">
                  {summary.undecided === 1
                    ? '1 línea sin destino. No podés despachar hasta resolverla.'
                    : `${summary.undecided} líneas sin destino. No podés despachar hasta resolverlas.`}
                </InlineAlert>
              </div>
            )}
          </RailPanel>

          <RailPanel title="Datos del envío" subtitle="Opcional">
            <label className="block">
              <span className="text-[11.5px] font-semibold text-neutral-600">
                Transportadora o quién lo lleva
              </span>
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Sin definir"
                className="mt-1 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-[12.5px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
              />
            </label>
            <label className="mt-2 block">
              <span className="text-[11.5px] font-semibold text-neutral-600">Número de guía</span>
              <input
                value={trackingRef}
                onChange={(e) => setTrackingRef(e.target.value)}
                placeholder="Ej. 990234118"
                className="mt-1 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 font-mono text-[12.5px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
              />
            </label>
            <label className="mt-2 block">
              <span className="text-[11.5px] font-semibold text-neutral-600">
                Notas para el destino
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Ej. Van 2 cajas, la chica lleva los bleiser."
                className="mt-1 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-[12.5px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10"
              />
            </label>
          </RailPanel>
        </aside>
      </div>

      {dispatching && transferId && transferNumber && (
        <DispatchModal
          transferId={transferId}
          transferNumber={transferNumber}
          fromStoreName={fromStoreName}
          toStoreName={destStoreName}
          summary={summary}
          carrier={carrier.trim() || null}
          trackingRef={trackingRef.trim() || null}
          onClose={() => setDispatching(false)}
          onDispatched={() => navigate('/traslados')}
        />
      )}
    </div>
  )
}

type DraftItemFromRpc = {
  id: string
  from_variant_id: string
  dest_action: DraftLine['destAction']
  to_product_id: string | null
  to_variant_id: string | null
}
