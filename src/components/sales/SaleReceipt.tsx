import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import type { PaymentMethod } from '@/types/database.types'

const SALE_PRINT_CONTAINER_ID = 'gmura-sale-receipt-print'
const SALE_PRINT_STYLE_ID = 'gmura-sale-receipt-print-style'

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface SaleReceiptItem {
  variant_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  qty: number
  // unit_price = precio FINAL vendido; list_price = catálogo (para el tachado).
  unit_price: number
  list_price: number
}

export interface SaleReceiptCustomer {
  full_name: string
  phone: string | null
}

export interface SaleReceiptData {
  order_number: number
  created_at: string | Date
  subtotal: number
  discount: number
  surcharge: number
  total: number
  payment_method: PaymentMethod
  cash_received: number | null
  items: SaleReceiptItem[]
  customer: SaleReceiptCustomer | null
}

export interface SaleReceiptProps {
  sale: SaleReceiptData
  storeName: string
  printedAt: Date
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(d)
}

// ── Subcomponentes visuales ───────────────────────────────────────────────────

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function SaleReceipt({ sale, storeName, printedAt }: SaleReceiptProps) {
  const monoLight: React.CSSProperties = { color: '#525252' }
  const sectionStyle: React.CSSProperties = { margin: '6px 0' }
  const change =
    sale.cash_received != null && sale.cash_received > sale.total
      ? sale.cash_received - sale.total
      : 0

  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        color: '#1a1a1a',
        background: '#fff',
        padding: '4mm',
        width: '80mm',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
          G-MURA
        </div>
        <div style={{ fontSize: 11, ...monoLight }}>{storeName}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
          VENTA #{sale.order_number}
        </div>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Fecha:</span>
          <span>{fmtDateTime(sale.created_at)}</span>
        </Line>
        {sale.customer && (
          <>
            <Line>
              <span style={monoLight}>Cliente:</span>
              <span style={{ fontWeight: 600 }}>{sale.customer.full_name}</span>
            </Line>
            {sale.customer.phone && (
              <Line>
                <span style={monoLight}>Tel:</span>
                <span>{sale.customer.phone}</span>
              </Line>
            )}
          </>
        )}
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ÍTEMS</div>
        {sale.items.map((it) => (
          <div key={it.variant_id} style={{ marginBottom: 2 }}>
            {it.brand && (
              <div
                style={{
                  ...monoLight,
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {it.brand}
              </div>
            )}
            <div>{it.product_name}</div>
            {(it.size || it.color) && (
              <div style={monoLight}>
                {[it.size ? `T:${it.size}` : null, it.color ? `C:${it.color}` : null]
                  .filter(Boolean)
                  .join(' ')}
              </div>
            )}
            {it.list_price > it.unit_price && (
              <div style={{ ...monoLight, fontSize: 9 }}>
                Antes:{' '}
                <span style={{ textDecoration: 'line-through' }}>
                  {fmtCOP(it.list_price)}
                </span>
              </div>
            )}
            <Line>
              <span style={monoLight}>
                {' '}
                {it.qty} × {fmtCOP(it.unit_price)}
              </span>
              <span>{fmtCOP(it.qty * it.unit_price)}</span>
            </Line>
          </div>
        ))}
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Subtotal:</span>
          <span>{fmtCOP(sale.subtotal)}</span>
        </Line>
        {sale.discount > 0 && (
          <Line>
            <span style={monoLight}>Descuento:</span>
            <span>-{fmtCOP(sale.discount)}</span>
          </Line>
        )}
        {sale.surcharge > 0 && (
          <Line>
            <span style={monoLight}>Recargo Addi:</span>
            <span>+{fmtCOP(sale.surcharge)}</span>
          </Line>
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Total:</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {fmtCOP(sale.total)}
          </span>
        </Line>
        <Line>
          <span style={monoLight}>Pago:</span>
          <span>{PAYMENT_METHODS[sale.payment_method].label}</span>
        </Line>
        {sale.cash_received != null && (
          <Line>
            <span style={monoLight}>Recibido:</span>
            <span>{fmtCOP(sale.cash_received)}</span>
          </Line>
        )}
        {change > 0 && (
          <Line>
            <span style={monoLight}>Cambio:</span>
            <span>{fmtCOP(change)}</span>
          </Line>
        )}
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={{ textAlign: 'center', marginTop: 6 }}>
        <div style={{ fontWeight: 600 }}>¡Gracias por tu compra!</div>
        <div style={{ ...monoLight, marginTop: 2 }}>
          Conserva este recibo para devoluciones.
        </div>
      </div>

      <div style={{ textAlign: 'center', ...monoLight, marginTop: 6 }}>
        Impreso: {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

// ── Contenedor para impresión (oculto en pantalla) ────────────────────────────

export function SaleReceiptPrint(props: SaleReceiptProps) {
  useReceiptPrintStyle(SALE_PRINT_STYLE_ID, SALE_PRINT_CONTAINER_ID)
  return (
    <div
      id={SALE_PRINT_CONTAINER_ID}
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <SaleReceipt {...props} />
    </div>
  )
}
