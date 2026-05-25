export type UserRole = 'admin' | 'seller'
export type OrderStatus = 'completed' | 'cancelled' | 'returned'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'addi'
export type StockMovementType = 'sale' | 'return' | 'adjustment' | 'purchase'
export type ReturnType = 'return' | 'exchange'
export type ReturnStatus = 'pending' | 'completed'
export type ReturnAction = 'refund' | 'exchange'
export type LayawayStatus = 'active' | 'completed' | 'cancelled' | 'expired'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  store_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Store {
  id: string
  name: string
  address: string | null
  phone: string | null
  logo_url: string | null
  config: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  name: string
  color: string | null
  sort_order: number
  store_id: string
  is_active: boolean
  updated_at: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  brand: string | null
  image_url: string | null
  store_id: string
  category_id: string | null
  size_type: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Variant {
  id: string
  product_id: string
  store_id: string
  size: string | null
  color: string | null
  sku: string | null
  barcode: string | null
  price: number
  cost_price: number | null
  stock_qty: number
  reserved_qty: number
  min_stock: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  document_id: string | null
  store_id: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  store_id: string
  customer_id: string | null
  created_by: string
  status: OrderStatus
  subtotal: number
  discount: number
  total: number
  payment_method: PaymentMethod
  cash_received: number | null
  order_number: number
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
  created_at: string
}

export interface StockMovement {
  id: string
  variant_id: string
  store_id: string
  type: StockMovementType
  qty: number
  reference_id: string | null
  notes: string | null
  created_by: string
  created_at: string
}

export interface Return {
  id: string
  original_order_id: string
  store_id: string
  created_by: string
  type: ReturnType
  status: ReturnStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ReturnItem {
  id: string
  return_id: string
  variant_id: string
  qty: number
  unit_price: number
  action: ReturnAction
}

export interface CashShift {
  id: string
  store_id: string
  opened_by: string
  closed_by: string | null
  opening_amount: number
  closing_amount: number | null
  opened_at: string
  closed_at: string | null
  updated_at: string
}

export interface CashExpense {
  id: string
  shift_id: string
  store_id: string
  amount: number
  reason: string
  notes: string | null
  created_by: string
  created_at: string
}

export interface Layaway {
  id: string
  layaway_number: number
  store_id: string
  customer_id: string
  created_by: string
  status: LayawayStatus
  total: number
  paid_amount: number
  expires_at: string
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  converted_order_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface LayawayItem {
  id: string
  layaway_id: string
  variant_id: string
  product_id: string
  qty: number
  unit_price: number
}

export interface LayawayPayment {
  id: string
  layaway_id: string
  store_id: string
  amount: number
  payment_method: PaymentMethod
  created_by: string
  notes: string | null
  created_at: string
}

// ── Views ─────────────────────────────────────────────────────────────────────

export interface DailySalesSummary {
  store_id: string
  sale_date: string          // 'YYYY-MM-DD'
  payment_method: PaymentMethod
  order_count: number
  items_sold: number
  subtotal_sum: number
  discount_sum: number
  total_sum: number
  avg_ticket: number
}

export interface ProductPerformance {
  variant_id: string
  product_id: string
  product_name: string
  brand: string | null
  category_name: string | null
  size: string | null
  color: string | null
  sku: string | null
  barcode: string | null
  store_id: string
  units_sold: number
  revenue: number
  return_units: number
  net_units: number
  net_revenue: number
}

export interface InventoryStatus {
  variant_id: string
  product_id: string
  product_name: string
  brand: string | null
  category_name: string | null
  size: string | null
  color: string | null
  sku: string | null
  barcode: string | null
  store_id: string
  stock_qty: number
  min_stock: number
  price: number
  cost_price: number | null
  stock_value: number
  stock_state: 'out' | 'low' | 'ok'
}

export interface ReturnsSummary {
  store_id: string
  return_date: string        // 'YYYY-MM-DD'
  return_type: ReturnType
  return_count: number
  items_returned: number
  refund_amount: number
}

// ── Database schema ───────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at'> & { created_at?: string }
        Update: Partial<Omit<Profile, 'id'>>
      }
      stores: {
        Row: Store
        Insert: Omit<Store, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Store, 'id'>>
      }
      categories: {
        Row: Category
        Insert: Omit<Category, 'id'> & { id?: string }
        Update: Partial<Omit<Category, 'id'>>
      }
      products: {
        Row: Product
        Insert: Omit<Product, 'id' | 'created_at' | 'image_url'> & {
          id?: string
          created_at?: string
          image_url?: string | null
        }
        Update: Partial<Omit<Product, 'id'>>
      }
      variants: {
        Row: Variant
        Insert: Omit<Variant, 'id' | 'created_at' | 'is_active'> & {
          id?: string
          created_at?: string
          is_active?: boolean
        }
        Update: Partial<Omit<Variant, 'id'>>
      }
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Customer, 'id'>>
      }
      orders: {
        Row: Order
        Insert: Omit<Order, 'id' | 'created_at' | 'order_number'> & {
          id?: string
          created_at?: string
          order_number?: number
        }
        Update: Partial<Omit<Order, 'id'>>
      }
      order_items: {
        Row: OrderItem
        Insert: Omit<OrderItem, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<OrderItem, 'id'>>
      }
      stock_movements: {
        Row: StockMovement
        Insert: Omit<StockMovement, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<StockMovement, 'id'>>
      }
      returns: {
        Row: Return
        Insert: Omit<Return, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Return, 'id'>>
      }
      return_items: {
        Row: ReturnItem
        Insert: Omit<ReturnItem, 'id'> & { id?: string }
        Update: Partial<Omit<ReturnItem, 'id'>>
      }
      cash_shifts: {
        Row: CashShift
        Insert: Omit<CashShift, 'id' | 'opened_at'> & { id?: string; opened_at?: string }
        Update: Partial<Omit<CashShift, 'id'>>
      }
      cash_expenses: {
        Row: CashExpense
        Insert: Omit<CashExpense, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<CashExpense, 'id'>>
      }
      layaways: {
        Row: Layaway
        Insert: Omit<
          Layaway,
          | 'id'
          | 'layaway_number'
          | 'status'
          | 'paid_amount'
          | 'completed_at'
          | 'cancelled_at'
          | 'cancellation_reason'
          | 'converted_order_id'
          | 'created_at'
          | 'updated_at'
        > & {
          id?: string
          layaway_number?: number
          status?: LayawayStatus
          paid_amount?: number
          completed_at?: string | null
          cancelled_at?: string | null
          cancellation_reason?: string | null
          converted_order_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Layaway, 'id'>>
      }
      layaway_items: {
        Row: LayawayItem
        Insert: Omit<LayawayItem, 'id'> & { id?: string }
        Update: Partial<Omit<LayawayItem, 'id'>>
      }
      layaway_payments: {
        Row: LayawayPayment
        Insert: Omit<LayawayPayment, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<LayawayPayment, 'id'>>
      }
    }
    Views: {
      daily_sales_summary: { Row: DailySalesSummary }
      product_performance:  { Row: ProductPerformance }
      inventory_status:     { Row: InventoryStatus }
      returns_summary:      { Row: ReturnsSummary }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
