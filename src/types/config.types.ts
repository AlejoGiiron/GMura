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

export interface StoreConfig {
  timezone: string
  currency: string
  sizes: string[]
  colors: StoreColorConfig[]
  brands: string[]
  return_days_limit: number
  adjustment_reasons: string[]
  payment_methods: string[]
  expense_reasons: string[]
  payment_qr_url: string | null
  label_format: LabelFormat
  label_fields: LabelFields
}
