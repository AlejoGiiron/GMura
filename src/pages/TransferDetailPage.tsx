import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Pencil, Truck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import { usePermissions } from '@/hooks/usePermissions'
import { useTransferDetail, type TransferDetail } from '@/hooks/useTransfers'
import {
  useMarkLabelsPrinted,
  useReceiveTransfer,
  useUpdateTransferShipping,
} from '@/hooks/useTransferMutations'
import { TransferStatusBadge, ResolutionBadge } from '@/components/transfers/TransferBadges'
import {
  InlineAlert,
  KeyValueRow,
  RailPanel,
  RpcErrorBlock,
} from '@/components/transfers/TransferPieces'
import BarcodeReprintBlock from '@/components/transfers/BarcodeReprintBlock'
import TransferLabelsModal, {
  type TransferLabelLine,
} from '@/components/transfers/TransferLabelsModal'
import { RevertDispatchModal } from '@/components/transfers/TransferActionModals'
import {
  CONFIRMED_BY_LABEL,
  RESOLUTION_TOKENS,
  confirmedBy,
  formatTransferNumber,
  resolutionKind,
  type ResolutionKind,
} from '@/lib/transfers'

const TABLE_GRID = 'grid grid-cols-[1fr_76px_1fr_152px] items-center gap-3 px-4'

// `/traslados/:id` matchea cualquier cosa, incluido `/traslados/nuevo` tecleado
// a mano (la pantalla de armado llega en la 5b). Sin este guard la query iría a
// Postgres con un uuid inválido y devolvería un error crudo de sintaxis.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export default function TransferDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { can } = usePermissions()
  const storeId = getActiveStoreId(profile)

  const validId = UUID_RE.test(id)
  const { data, isLoading, error, refetch } = useTransferDetail(validId ? id : null)
  const receive = useReceiveTransfer()
  const markPrinted = useMarkLabelsPrinted()

  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelsViewOnly, setLabelsViewOnly] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [editingShipping, setEditingShipping] = useState(false)

  const receiveBtnRef = useRef<HTMLButtonElement>(null)
  const printBtnRef = useRef<HTMLDivElement>(null)

  const canManage = can('traslados.gestionar')
  // El estado de impresión vive en la BD (043b), no en el navegador: quien
  // imprime en el mostrador y quien revisa en la oficina ven lo mismo.
  const printed = !!data?.labels_printed_at
  const isIncoming = data ? data.to_store_id === storeId : false
  const isOutgoing = data ? data.from_store_id === storeId : false
  const units = useMemo(
    () => (data?.items ?? []).reduce((a, i) => a + i.qty_sent, 0),
    [data?.items],
  )
  const newProducts = useMemo(
    () => (data?.items ?? []).filter((i) => i.dest_action === 'create_product').length,
    [data?.items],
  )

  // §4.3 — foco al entrar: sin imprimir → el botón de etiquetas; ya impreso y
  // sin confirmar → Confirmar recepción.
  useEffect(() => {
    if (!data || data.status !== 'in_transit' || !isIncoming) return
    if (!printed) printBtnRef.current?.querySelector('button')?.focus()
    else receiveBtnRef.current?.focus()
  }, [data, printed, isIncoming])

  if (!validId) {
    return (
      <div className="p-6 text-[13px] text-neutral-500">
        Ese traslado no existe o no pertenece a tus tiendas.
      </div>
    )
  }
  if (isLoading) return <DetailSkeleton />
  if (error) {
    return (
      <div className="p-6">
        <RpcErrorBlock message={(error as Error).message} onRetry={() => void refetch()} />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="p-6 text-[13px] text-neutral-500">
        Ese traslado no existe o no pertenece a tus tiendas.
      </div>
    )
  }

  const who = confirmedBy(data.received_by_store_id, data.to_store_id, data.from_store_id)
  const showLabels = data.status === 'received' || (data.status === 'in_transit' && isIncoming)
  const labelLines: TransferLabelLine[] = data.items.map((i) => ({
    transferItemId: i.id,
    productName: i.product_name,
    brand: i.brand,
    size: i.size,
    color: i.color,
    price: Number(i.unit_price),
    qty: i.qty_sent,
    barcode: i.to_barcode,
  }))
  // Las etiquetas solo existen una vez resuelto el destino (al recibir).
  const labelsReady = data.items.every((i) => !!i.to_barcode)

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
              <span className="font-mono text-[15px] font-semibold text-neutral-500">
                {formatTransferNumber(data.transfer_number)}
              </span>
              <TransferStatusBadge status={data.status} />
            </div>
            <p className="text-[12px] text-neutral-500">
              {data.from_store_name} → {data.to_store_name}
              {data.dispatched_at && <> · despachado {fmtDateTime(data.dispatched_at)}</>}
            </p>
          </div>
        </div>

        {data.status === 'in_transit' && isIncoming && canManage && (
          <button
            ref={receiveBtnRef}
            onClick={() => receive.mutate(data.id)}
            disabled={receive.isPending}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            <CheckCircle2 size={15} />
            {receive.isPending ? 'Confirmando…' : 'Confirmar recepción'}
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Columna principal ────────────────────────────────────────────── */}
        <main className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <StatusBanner
            detail={data}
            units={units}
            who={who}
            confirmedStoreName={
              data.received_by_store_id === data.to_store_id
                ? data.to_store_name
                : data.received_by_store_id === data.from_store_id
                  ? data.from_store_name
                  : '—'
            }
          />

          {receive.isError && (
            <RpcErrorBlock message={(receive.error as Error).message} />
          )}

          {/* El bloque de etiquetas: PERSISTENTE, no un toast (§1.4). */}
          {showLabels && labelsReady && (
            <div ref={printBtnRef}>
              <BarcodeReprintBlock
                count={units}
                fromStoreName={data.from_store_name}
                toStoreName={data.to_store_name}
                printed={printed}
                onPrint={() => {
                  setLabelsViewOnly(false)
                  setLabelsOpen(true)
                }}
                onViewCodes={() => {
                  setLabelsViewOnly(true)
                  setLabelsOpen(true)
                }}
              />
            </div>
          )}

          {/* ── Qué llegó ──────────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <header className="flex items-baseline justify-between border-b border-stone-200 px-4 py-3">
              <h2 className="text-[14px] font-semibold text-neutral-800">
                Qué llegó ({data.items.length} productos ·{' '}
                <span className="font-mono">{units}</span> unidades)
              </h2>
              <span className="text-[11.5px] text-neutral-400">
                Se confirma completo, sin conteo unidad por unidad
              </span>
            </header>

            <div
              className={`${TABLE_GRID} border-b border-stone-200 bg-stone-50 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400`}
            >
              <span>Producto que mandaron</span>
              <span className="text-center">Cant.</span>
              <span>Dónde quedó en {data.to_store_name}</span>
              <span>Cómo se resolvió</span>
            </div>

            {data.items.map((i) => {
              const kind: ResolutionKind | null = i.dest_resolution
                ? resolutionKind(i.dest_action, i.dest_resolution)
                : null
              return (
                <div
                  key={i.id}
                  className={`${TABLE_GRID} border-b border-stone-100 py-3 last:border-b-0`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-neutral-800">
                      {i.product_name}
                      {i.brand && (
                        <span className="ml-1.5 text-[10.5px] font-bold tracking-[0.06em] text-neutral-400">
                          {i.brand}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[12px] text-neutral-500">
                      {i.description && <>{i.description} · </>}T.{i.size ?? '—'} ·{' '}
                      {i.color ?? '—'}
                    </p>
                  </div>

                  <span className="text-center font-mono text-[14px] font-semibold text-neutral-800">
                    {i.qty_sent}
                  </span>

                  <div className="min-w-0">
                    {i.to_variant_id ? (
                      <>
                        <p className="truncate text-[12.5px] text-neutral-700">
                          {i.product_name}
                          {i.brand && <> · {i.brand}</>}
                          {i.description && <> · {i.description}</>}
                        </p>
                        {i.to_barcode && (
                          <p className="flex items-center gap-1.5 text-[11.5px]">
                            <span className="font-mono text-neutral-500">{i.to_barcode}</span>
                            <span className={printed ? 'text-green-600' : 'text-red-600'}>
                              {printed ? 'impreso' : 'sin imprimir'}
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[12px] italic text-neutral-400">
                        Se resuelve al confirmar la recepción
                      </p>
                    )}
                  </div>

                  <div>{kind ? <ResolutionBadge kind={kind} short /> : <span />}</div>
                </div>
              )
            })}
          </section>

          {data.status === 'received' && newProducts > 0 && (
            <InlineAlert tone="warning">
              {newProducts === 1
                ? `Se creó 1 ficha nueva en el catálogo de ${data.to_store_name}. Revisá que no exista ya con otro nombre para no duplicar.`
                : `Se crearon ${newProducts} fichas nuevas en el catálogo de ${data.to_store_name}. Revisá que no exista ya con otro nombre para no duplicar.`}
            </InlineAlert>
          )}
        </main>

        {/* ── Rail derecho ─────────────────────────────────────────────────── */}
        <aside className="w-[330px] flex-shrink-0 space-y-3 overflow-y-auto border-l border-stone-200 bg-[#fafaf9] px-4 py-5">
          <ShippingPanel
            detail={data}
            editable={isOutgoing && canManage && data.status === 'in_transit'}
            editing={editingShipping}
            onEdit={() => setEditingShipping(true)}
            onDone={() => setEditingShipping(false)}
          />

          {data.notes && (
            <RailPanel title={`Notas de ${data.from_store_name}`}>
              <p className="text-[12.5px] leading-snug text-neutral-700">{data.notes}</p>
            </RailPanel>
          )}

          {data.status === 'received' && (
            <RailPanel title="Cómo se resolvió cada línea">
              <ResolutionBreakdown detail={data} />
            </RailPanel>
          )}

          {data.status === 'in_transit' && isIncoming && canManage && (
            <div className="space-y-2">
              <button
                onClick={() => receive.mutate(data.id)}
                disabled={receive.isPending}
                className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-[14px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                <CheckCircle2 size={16} />
                {receive.isPending ? 'Confirmando…' : 'Confirmar recepción'}
              </button>
              <p className="text-center text-[11.5px] text-neutral-400">
                Si falta mercancía, avisá a {data.from_store_name} antes de confirmar.
              </p>
            </div>
          )}

          {data.status === 'received' && who && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3">
              <p className="text-[12.5px] leading-snug text-green-800">
                Confirmado por{' '}
                <strong>
                  {data.received_by_store_id === data.to_store_id
                    ? data.to_store_name
                    : data.from_store_name}
                </strong>{' '}
                ({CONFIRMED_BY_LABEL[who]}). Queda registrado quién y desde qué tienda.
              </p>
            </div>
          )}

          {data.status === 'in_transit' && isOutgoing && canManage && (
            <button
              onClick={() => setReverting(true)}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-red-600 hover:bg-red-50"
            >
              Revertir despacho
            </button>
          )}
        </aside>
      </div>

      {labelsOpen && (
        <TransferLabelsModal
          lines={labelLines}
          toStoreName={data.to_store_name}
          viewOnly={labelsViewOnly}
          onPrinted={() => markPrinted.mutate(data.id)}
          onClose={() => setLabelsOpen(false)}
        />
      )}
      {reverting && (
        <RevertDispatchModal
          transferId={data.id}
          transferNumber={data.transfer_number}
          units={units}
          fromStoreName={data.from_store_name}
          onClose={() => setReverting(false)}
        />
      )}
    </div>
  )
}

// ─── Banner de estado ─────────────────────────────────────────────────────────

function StatusBanner({
  detail,
  units,
  who,
  confirmedStoreName,
}: {
  detail: TransferDetail
  units: number
  who: ReturnType<typeof confirmedBy>
  confirmedStoreName: string
}) {
  if (detail.status === 'in_transit') {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <Truck size={18} className="mt-[2px] flex-shrink-0 text-amber-600" />
          <div>
            <h3 className="text-[14px] font-semibold text-amber-800">
              Esta mercancía está en tránsito
            </h3>
            <p className="mt-1 text-[12.5px] leading-snug text-amber-800">
              Las <span className="font-mono font-semibold">{units}</span> unidades ya salieron
              de {detail.from_store_name} y no se pueden vender en ninguna de las dos tiendas. Al
              confirmar, entran al stock de {detail.to_store_name} y quedan disponibles.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (detail.status === 'received') {
    return (
      <section className="rounded-xl border border-green-200 bg-green-50 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 size={18} className="mt-[2px] flex-shrink-0 text-green-600" />
          <div>
            <h3 className="text-[14px] font-semibold text-green-800">Recepción confirmada</h3>
            <p className="mt-1 text-[12.5px] leading-snug text-green-800">
              <span className="font-mono font-semibold">{units}</span> unidades entraron al stock
              de {detail.to_store_name}.
              {who && (
                <>
                  {' '}
                  Confirmado por {confirmedStoreName} ({CONFIRMED_BY_LABEL[who]}){' '}
                  {fmtDateTime(detail.received_at)}.
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (detail.status === 'cancelled') {
    return (
      <section className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3.5">
        <h3 className="text-[14px] font-semibold text-neutral-700">Traslado cancelado</h3>
        <p className="mt-1 text-[12.5px] leading-snug text-neutral-600">
          {detail.cancel_reason ?? 'Sin motivo registrado.'} ·{' '}
          {fmtDateTime(detail.cancelled_at)}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white px-4 py-3.5">
      <p className="text-[12.5px] text-neutral-600">
        El stock no se ha movido. Podés editar hasta despachar.
      </p>
    </section>
  )
}

// ─── Panel de datos del envío ─────────────────────────────────────────────────

function ShippingPanel({
  detail,
  editable,
  editing,
  onEdit,
  onDone,
}: {
  detail: TransferDetail
  editable: boolean
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const update = useUpdateTransferShipping()
  const [carrier, setCarrier] = useState(detail.carrier ?? '')
  const [tracking, setTracking] = useState(detail.tracking_ref ?? '')
  const [notes, setNotes] = useState(detail.notes ?? '')

  if (editing) {
    return (
      <RailPanel title="Datos del envío">
        <div className="space-y-2.5">
          <Field label="Transportadora o quién lo lleva" value={carrier} onChange={setCarrier} placeholder="Sin definir" />
          <Field label="Número de guía" value={tracking} onChange={setTracking} placeholder="Ej. 990234118" mono />
          <label className="block">
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
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onDone}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-neutral-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              onClick={() =>
                update.mutate(
                  {
                    transferId: detail.id,
                    carrier: carrier.trim() || null,
                    trackingRef: tracking.trim() || null,
                    notes: notes.trim() || null,
                  },
                  { onSuccess: onDone },
                )
              }
              disabled={update.isPending}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-violet-700 disabled:bg-neutral-300"
            >
              {update.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </RailPanel>
    )
  }

  return (
    <RailPanel title="Datos del envío">
      <KeyValueRow label="Sale de" value={detail.from_store_name} />
      <KeyValueRow label="Llega a" value={detail.to_store_name} />
      <KeyValueRow label="Despachado" value={fmtDateTime(detail.dispatched_at)} />
      <KeyValueRow label="Transportadora" value={detail.carrier ?? 'Sin definir'} />
      <KeyValueRow label="Guía" value={detail.tracking_ref ?? '—'} mono />
      {editable && (
        <button
          onClick={onEdit}
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-violet-700 hover:underline"
        >
          <Pencil size={12} />
          Editar datos del envío
        </button>
      )}
    </RailPanel>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-semibold text-neutral-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-[12.5px] focus:border-violet-400 focus:outline-none focus:ring-[3px] focus:ring-violet-500/10 ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}

// ─── Desglose de resoluciones ─────────────────────────────────────────────────

function ResolutionBreakdown({ detail }: { detail: TransferDetail }) {
  const counts = new Map<ResolutionKind, number>()
  for (const i of detail.items) {
    if (!i.dest_resolution) continue
    const k = resolutionKind(i.dest_action, i.dest_resolution)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const order: ResolutionKind[] = ['linked', 'sizeCreated', 'newProduct', 'twin']

  return (
    <div className="space-y-1.5">
      {order.map((k) => {
        const n = counts.get(k) ?? 0
        const t = RESOLUTION_TOKENS[k]
        return (
          <div key={k} className="flex items-center justify-between gap-2">
            <span
              className={`flex items-center gap-2 text-[12.5px] ${
                n === 0 ? 'text-neutral-300' : 'text-neutral-700'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${n === 0 ? 'bg-neutral-200' : t.dot}`} />
              {t.label}
            </span>
            <span
              className={`font-mono text-[13px] font-semibold ${
                n === 0 ? 'text-neutral-300' : 'text-neutral-800'
              }`}
            >
              {n}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex h-full min-w-[1240px] flex-col bg-[#fafaf9]">
      <div className="h-16 flex-shrink-0 border-b border-stone-200 bg-white" />
      <div className="flex flex-1 gap-4 px-6 py-5">
        <div className="flex-1 space-y-4">
          <div className="h-20 animate-pulse rounded-xl bg-stone-100" />
          {/* El bloque de etiquetas NUNCA se omite del skeleton: es lo que la
              persona vino a hacer (§1.4). */}
          <div className="h-28 animate-pulse rounded-xl bg-stone-100" />
          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-stone-100" />
            ))}
          </div>
        </div>
        <div className="w-[330px] space-y-3">
          <div className="h-40 animate-pulse rounded-xl bg-stone-100" />
          <div className="h-24 animate-pulse rounded-xl bg-stone-100" />
        </div>
      </div>
    </div>
  )
}
