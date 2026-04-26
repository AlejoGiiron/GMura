export type UserRole = 'admin' | 'seller'
export type OrderStatus = 'completed' | 'cancelled' | 'returned'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'nequi'
export type StockMovementType = 'sale' | 'return' | 'adjustment' | 'purchase'
export type ReturnType = 'return' | 'exchange'
export type ReturnStatus = 'pending' | 'completed'
export type ReturnAction = 'refund' | 'exchange'

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
  store_id: string
  category_id: string | null
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
  min_stock: number
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
        Insert: Omit<Product, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Product, 'id'>>
      }
      variants: {
        Row: Variant
        Insert: Omit<Variant, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Variant, 'id'>>
      }
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Customer, 'id'>>
      }
      orders: {
        Row: Order
        Insert: Omit<Order, 'id' | 'created_at'> & { id?: string; created_at?: string }
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
