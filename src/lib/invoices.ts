import {
  Clock,
  CircleDashed,
  CheckCircle2,
  Ban,
  type LucideIcon,
} from 'lucide-react'
import type { InvoiceStatus } from '@/types/database.types'

export interface InvoiceStatusMeta {
  label: string
  // Clases Tailwind para el badge (bg + texto + borde).
  classes: string
  icon: LucideIcon
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, InvoiceStatusMeta> = {
  pending: {
    label: 'Pendiente',
    classes: 'bg-stone-100 border border-stone-200 text-stone-600',
    icon: CircleDashed,
  },
  partial: {
    label: 'Parcial',
    classes: 'bg-amber-50 border border-amber-200 text-amber-700',
    icon: Clock,
  },
  paid: {
    label: 'Pagada',
    classes: 'bg-emerald-50 border border-emerald-200 text-emerald-700',
    icon: CheckCircle2,
  },
  cancelled: {
    label: 'Cancelada',
    classes: 'bg-red-50 border border-red-200 text-red-700 line-through',
    icon: Ban,
  },
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagada',
  cancelled: 'Cancelada',
}

// Medianoche local de un date string 'YYYY-MM-DD' (sin desfases de zona).
function parseDateOnly(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function todayMidnight(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// Días vencidos (> 0) de una factura aún por pagar. null si no aplica:
// pagada/cancelada, sin fecha de vencimiento, o todavía no vencida.
export function daysOverdue(
  dueDate: string | null,
  status: InvoiceStatus,
): number | null {
  if (!dueDate) return null
  if (status === 'paid' || status === 'cancelled') return null
  const diff = todayMidnight().getTime() - parseDateOnly(dueDate).getTime()
  const days = Math.floor(diff / 86_400_000)
  return days > 0 ? days : null
}

// Días que faltan para el vencimiento (>= 0). null si ya venció o sin fecha.
export function daysUntilDue(dueDate: string | null): number | null {
  if (!dueDate) return null
  const diff = parseDateOnly(dueDate).getTime() - todayMidnight().getTime()
  const days = Math.ceil(diff / 86_400_000)
  return days >= 0 ? days : null
}

// Suma days a una fecha 'YYYY-MM-DD' y devuelve otra 'YYYY-MM-DD'.
export function addDaysToDate(date: string, days: number): string {
  const base = parseDateOnly(date)
  base.setDate(base.getDate() + days)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Fecha de hoy en formato 'YYYY-MM-DD' (zona local del navegador).
export function todayDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Formatea un date string 'YYYY-MM-DD' a "5 may 2026" en es-CO / Bogotá.
export function fmtInvoiceDate(date: string | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parseDateOnly(date))
}
