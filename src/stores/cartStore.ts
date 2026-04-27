import { create } from 'zustand'

export interface CartItem {
  variant_id: string
  product_id: string
  name: string
  size: string | null
  color: string | null
  unit_price: number
  qty: number
  stock_qty: number
}

export interface Discount {
  type: 'percent' | 'fixed'
  value: number
}

interface CartStore {
  items: CartItem[]
  discount: Discount
  customer_id: string | null
  addItem: (item: Omit<CartItem, 'qty'>) => void
  removeItem: (variant_id: string) => void
  setQty: (variant_id: string, qty: number) => void
  setDiscount: (discount: Discount) => void
  setCustomer: (id: string | null) => void
  clear: () => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  discount: { type: 'percent', value: 0 },
  customer_id: null,

  addItem: (newItem) =>
    set((s) => {
      const existing = s.items.find((i) => i.variant_id === newItem.variant_id)
      if (existing) {
        const next = Math.min(existing.qty + 1, newItem.stock_qty)
        return {
          items: s.items.map((i) =>
            i.variant_id === newItem.variant_id ? { ...i, qty: next } : i,
          ),
        }
      }
      if (newItem.stock_qty <= 0) return s
      return { items: [...s.items, { ...newItem, qty: 1 }] }
    }),

  removeItem: (variant_id) =>
    set((s) => ({ items: s.items.filter((i) => i.variant_id !== variant_id) })),

  setQty: (variant_id, qty) =>
    set((s) => {
      if (qty <= 0) return { items: s.items.filter((i) => i.variant_id !== variant_id) }
      return {
        items: s.items.map((i) =>
          i.variant_id === variant_id ? { ...i, qty: Math.min(qty, i.stock_qty) } : i,
        ),
      }
    }),

  setDiscount: (discount) => set({ discount }),
  setCustomer: (id) => set({ customer_id: id }),
  clear: () => set({ items: [], discount: { type: 'percent', value: 0 }, customer_id: null }),
}))

export function cartTotals(items: CartItem[], discount: Discount) {
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.qty, 0)
  const discountAmt =
    discount.type === 'percent'
      ? Math.round(subtotal * (discount.value / 100))
      : Math.min(discount.value, subtotal)
  const total = Math.max(0, subtotal - discountAmt)
  return { subtotal, discountAmt, total }
}
