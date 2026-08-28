import type { ReactNode } from 'react'
import { AlertTriangle, Info, TriangleAlert } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Piezas menores del módulo (handoff §3.9).
// ─────────────────────────────────────────────────────────────────────────────

/** Panel del rail derecho, con encabezado en versalitas (§2.4). */
export function RailPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white px-3.5 py-3">
      <header className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-neutral-400">
          {title}
        </h3>
        {subtitle && (
          <span className="text-[10.5px] font-medium text-neutral-400">{subtitle}</span>
        )}
      </header>
      {children}
    </section>
  )
}

/** Fila etiqueta/valor de los resúmenes y del rail. Todo número va en mono. */
export function KeyValueRow({
  label,
  value,
  mono,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <span className="text-[12.5px] text-neutral-500">{label}</span>
      <span
        className={`text-right text-[13px] font-semibold text-neutral-800 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

const ALERT_TONES = {
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: 'text-amber-600',
    Icon: TriangleAlert,
  },
  danger: {
    box: 'border-red-200 bg-red-50 text-red-700',
    icon: 'text-red-600',
    Icon: AlertTriangle,
  },
  info: {
    box: 'border-sky-200 bg-sky-50 text-sky-800',
    icon: 'text-sky-600',
    Icon: Info,
  },
} as const

/** Aviso con ícono y texto. Los tres tonos del handoff. */
export function InlineAlert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof ALERT_TONES
  children: ReactNode
}) {
  const t = ALERT_TONES[tone]
  const Icon = t.Icon
  return (
    <div className={`flex items-start gap-2 rounded-[10px] border px-3 py-2.5 ${t.box}`}>
      <Icon size={15} className={`mt-[1px] flex-shrink-0 ${t.icon}`} />
      <div className="text-[12.5px] leading-snug">{children}</div>
    </div>
  )
}

/**
 * Bloque de error de una mutación. Muestra el mensaje de la RPC TAL CUAL: ya
 * viene redactado en español y con el detalle útil ("disponible 1, requerido 2").
 * La UI no lo reformatea ni le agrega prefijos tipo "Error:" (handoff §5).
 */
export function RpcErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
      <AlertTriangle size={15} className="mt-[1px] flex-shrink-0 text-red-600" />
      <div className="flex-1 text-[12.5px] leading-snug text-red-700">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex-shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-50"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}
