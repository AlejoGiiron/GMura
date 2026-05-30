export interface StoreColorConfig {
  name: string
  hex: string
}

export interface LabelFields {
  sku: boolean
  name: boolean
  size_color: boolean
  price: boolean
}

export type LabelFormat = '38x25' | '50x30' | '58x40'

export interface SizeTypeConfig {
  id: string
  label: string
  sizes: string[]
}

export type LayawayInitialPaymentMode = 'none' | 'fixed' | 'percent'
export type LayawayDiscountMode = 'none' | 'fixed'

export interface StoreConfig {
  timezone: string
  currency: string
  size_types: SizeTypeConfig[]
  colors: StoreColorConfig[]
  brands: string[]
  return_days_limit: number
  adjustment_reasons: string[]
  payment_methods: string[]
  expense_reasons: string[]
  payment_qr_url: string | null
  label_format: LabelFormat
  label_fields: LabelFields
  layaway_initial_payment_mode: LayawayInitialPaymentMode
  layaway_initial_payment_value: number
  layaway_default_days: number
  layaway_discount_mode: LayawayDiscountMode
  layaway_discount_value: number
}
