import { AlertTriangle } from 'lucide-react'
import type { TransferStatus } from '@/types/database.types'
import {
  TRANSFER_STATUS_TOKENS,
  MAPPING_TOKENS,
  RESOLUTION_TOKENS,
  CONFIRMED_BY_LABEL,
  type MappingType,
  type ResolutionKind,
  type ConfirmedBy,
} from '@/lib/transfers'

// ─────────────────────────────────────────────────────────────────────────────
// Badges del módulo. Único punto donde se consumen los tokens de color de
// §2.1/§2.2/§2.3 — los hex no se repiten en ninguna pantalla.
// ─────────────────────────────────────────────────────────────────────────────

const BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap'

/** §2.2 — estado del traslado. Lista, header de detalle. */
export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const t = TRANSFER_STATUS_TOKENS[status]
  return (
    <span className={`${BASE} ${t.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  )
}

/** §2.1 — tipo de mapeo elegido (pantalla 2 y desgloses). */
export function MappingBadge({ type, short }: { type: MappingType; short?: boolean }) {
  const t = MAPPING_TOKENS[type]
  return (
    <span className={`${BASE} ${t.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {short ? t.short : t.label}
    </span>
  )
}

/** §2.3 — cómo se resolvió una línea al recibir. */
export function ResolutionBadge({ kind, short }: { kind: ResolutionKind; short?: boolean }) {
  const t = RESOLUTION_TOKENS[kind]
  return (
    <span className={`${BASE} ${t.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {short ? t.short : t.label}
    </span>
  )
}

/**
 * §1.1 — el chip de auditoría de la columna "Envío / recepción".
 *
 * El contraste ES el punto de la columna: el caso normal (confirmó el destino)
 * va en gris y se lee de pasada; la excepción (confirmó el origen) va en ámbar
 * con ícono de alerta, para que salte al ojo si después falta mercancía.
 */
export function ConfirmedByChip({ who, storeName }: { who: ConfirmedBy; storeName: string }) {
  const isException = who !== 'destination'
  return (
    <span
      className={`${BASE} ${
        isException
          ? 'bg-amber-100 text-amber-700 border-amber-300'
          : 'bg-stone-100 text-neutral-600 border-neutral-200'
      }`}
      title={
        isException
          ? 'Lo confirmó una tienda distinta al destino. Queda registrado quién y desde dónde.'
          : undefined
      }
    >
      {isException && <AlertTriangle size={12} />}
      Confirmó {storeName} ({CONFIRMED_BY_LABEL[who]})
    </span>
  )
}
