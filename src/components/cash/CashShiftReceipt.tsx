import { useEffect } from 'react'
import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'

export const SHIFT_PRINT_CONTAINER_ID = 'gmura-shift-receipt-print'
const SHIFT_PRINT_STYLE_ID = 'gmura-shift-receipt-print-style'

export interface SalesByMethodRow {
  method: PaymentMethod
  count: number
  total: number
}

export interface CashShiftReceiptProps {
  shift: CashShift
  expenses: CashExpense[]
  salesByMethod: SalesByMethodRow[]
  totalSales: number
  cashSales: number
  totalExpenses: number
  expectedCash: number
  orderCount: number
  avgTicket: number
  countedCash: number
  difference: number
  storeName: string
  userName: string
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

function fmtHHmm(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function fmtDuration(opened: string, closed: string | Date): string {
  const a = new Date(opened).getTime()
  const b = (closed instanceof Date ? closed : new Date(closed)).getTime()
  const totalMin = Math.max(0, Math.round((b - a) / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// ── Hook para inyectar @media print una sola vez ──────────────────────────────

export function useShiftReceiptPrintStyle() {
  useEffect(() => {
    if (document.getElementById(SHIFT_PRINT_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = SHIFT_PRINT_STYLE_ID
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #${SHIFT_PRINT_CONTAINER_ID},
        #${SHIFT_PRINT_CONTAINER_ID} * { visibility: visible !important; }
        #${SHIFT_PRINT_CONTAINER_ID} {
          display: block !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 80mm !important;
          padding: 4mm !important;
          margin: 0 !important;
          box-sizing: border-box !important;
          background: #fff !important;
          color: #000 !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
          font-size: 11px !important;
          line-height: 1.4 !important;
        }
        @page { margin: 0; size: 80mm auto; }
      }
    `
    document.head.appendChild(style)
    return () => {
      document.getElementById(SHIFT_PRINT_STYLE_ID)?.remove()
    }
  }, [])
}

// ── Subcomponentes visuales ───────────────────────────────────────────────────

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

function Line({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between' }}>{children}</div>
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CashShiftReceipt(props: CashShiftReceiptProps) {
  const {
    shift,
    expenses,
    salesByMethod,
    totalSales,
    totalExpenses,
    expectedCash,
    orderCount,
    avgTicket,
    countedCash,
    difference,
    storeName,
    userName,
    printedAt,
  } = props

  const closedAt = shift.closed_at ? new Date(shift.closed_at) : printedAt
  const duration = fmtDuration(shift.opened_at, closedAt)

  let badgeText = 'CUADRADO'
  let badgeColor = '#525252'
  if (difference > 0) {
    badgeText = 'SOBRANTE'
    badgeColor = '#059669'
  } else if (difference < 0) {
    badgeText = 'FALTANTE'
    badgeColor = '#dc2626'
  }

  const sectionStyle: React.CSSProperties = { margin: '6px 0' }
  const monoLight: React.CSSProperties = { color: '#525252' }

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
      {/* Encabezado */}
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
          G-MURA
        </div>
        <div style={{ fontSize: 11, ...monoLight }}>{storeName}</div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
          Cuadre de caja
        </div>
      </div>

      <div style={{ ...monoLight }}>{DIVIDER}</div>

      {/* Metadatos del turno */}
      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Cajero:</span>
          <span style={{ fontWeight: 600 }}>{userName}</span>
        </Line>
        <Line>
          <span style={monoLight}>Apertura:</span>
          <span>{fmtDateTime(shift.opened_at)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Cierre:</span>
          <span>{fmtDateTime(closedAt)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Duración:</span>
          <span>{duration}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Ventas por método */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>VENTAS POR MÉTODO</div>
        {salesByMethod.length === 0 ? (
          <div style={{ ...monoLight, fontStyle: 'italic' }}>
            Sin ventas registradas
          </div>
        ) : (
          salesByMethod.map((row) => (
            <Line key={row.method}>
              <span style={monoLight}>
                {PAYMENT_METHODS[row.method].label}:
              </span>
              <span>
                {fmtCOP(row.total)}{' '}
                <span style={monoLight}>({row.count})</span>
              </span>
            </Line>
          ))
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Total ventas:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(totalSales)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Órdenes:</span>
          <span>{orderCount}</span>
        </Line>
        <Line>
          <span style={monoLight}>Ticket prom:</span>
          <span>{fmtCOP(Math.round(avgTicket))}</span>
        </Line>
      </div>

      {/* Egresos */}
      {expenses.length > 0 && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>EGRESOS</div>
            {expenses.map((e) => (
              <Line key={e.id}>
                <span style={monoLight}>
                  [{fmtHHmm(e.created_at)}] {e.reason}:
                </span>
                <span>{fmtCOP(Number(e.amount))}</span>
              </Line>
            ))}
            <div style={monoLight}>{SUBDIV}</div>
            <Line>
              <span style={{ fontWeight: 700 }}>Total egresos:</span>
              <span style={{ fontWeight: 700 }}>{fmtCOP(totalExpenses)}</span>
            </Line>
          </div>
        </>
      )}

      <div style={monoLight}>{DIVIDER}</div>

      {/* Cuadre de efectivo */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>CUADRE DE EFECTIVO</div>
        <Line>
          <span style={monoLight}>Apertura:</span>
          <span>{fmtCOP(shift.opening_amount)}</span>
        </Line>
        <Line>
          <span style={monoLight}>+ Ventas efec:</span>
          <span>{fmtCOP(props.cashSales)}</span>
        </Line>
        {totalExpenses > 0 && (
          <Line>
            <span style={monoLight}>- Egresos:</span>
            <span>-{fmtCOP(totalExpenses)}</span>
          </Line>
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Esperado:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(expectedCash)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Contado:</span>
          <span>{fmtCOP(countedCash)}</span>
        </Line>
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Diferencia:</span>
          <span style={{ fontWeight: 700, color: badgeColor }}>
            {difference >= 0 ? `+${fmtCOP(difference)}` : fmtCOP(difference)}
          </span>
        </Line>
        <div
          style={{
            textAlign: 'center',
            marginTop: 4,
            fontWeight: 700,
            letterSpacing: 1,
            color: badgeColor,
            border: `1px dashed ${badgeColor}`,
            padding: '2px 0',
          }}
        >
          {badgeText}
        </div>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={{ textAlign: 'center', ...monoLight, marginTop: 4 }}>
        Impreso: {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

// ── Contenedor para impresión (oculto en pantalla) ────────────────────────────

export function CashShiftReceiptPrint(props: CashShiftReceiptProps) {
  useShiftReceiptPrintStyle()
  return (
    <div
      id={SHIFT_PRINT_CONTAINER_ID}
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <CashShiftReceipt {...props} />
    </div>
  )
}
