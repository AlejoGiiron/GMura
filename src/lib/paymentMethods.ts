import {
  Banknote,
  CreditCard,
  ArrowLeftRight,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'
import type { PaymentMethod } from '@/types/database.types'

export type PaymentColorToken = 'emerald' | 'violet' | 'blue' | 'pink'

export interface PaymentMethodMeta {
  label: string
  color: PaymentColorToken
  hex: string
  icon: LucideIcon
}

export const PAYMENT_METHODS: Record<PaymentMethod, PaymentMethodMeta> = {
  cash: {
    label: 'Efectivo',
    color: 'emerald',
    hex: '#10b981',
    icon: Banknote,
  },
  card: {
    label: 'Tarjeta',
    color: 'violet',
    hex: '#8b5cf6',
    icon: CreditCard,
  },
  transfer: {
    label: 'Transferencia',
    color: 'blue',
    hex: '#3b82f6',
    icon: ArrowLeftRight,
  },
  addi: {
    label: 'Addi',
    color: 'pink',
    hex: '#ec4899',
    icon: Smartphone,
  },
}

export const PAYMENT_METHOD_KEYS = [
  'cash',
  'card',
  'transfer',
  'addi',
] as const

export function getPaymentLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS[method].label
}

export function getPaymentColor(method: PaymentMethod): string {
  return PAYMENT_METHODS[method].hex
}

export function getPaymentIcon(method: PaymentMethod): LucideIcon {
  return PAYMENT_METHODS[method].icon
}

// Migra valores legacy ('nequi') a 'transfer' en arrays de configuración.
export function migrateLegacyPaymentMethods(methods: string[]): PaymentMethod[] {
  const seen = new Set<PaymentMethod>()
  for (const m of methods) {
    const normalized = m === 'nequi' ? 'transfer' : m
    if (PAYMENT_METHOD_KEYS.includes(normalized as PaymentMethod)) {
      seen.add(normalized as PaymentMethod)
    }
  }
  return Array.from(seen)
}
