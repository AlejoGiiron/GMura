import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import type { LayawayDetail } from '@/hooks/useLayaways'

const LAYAWAY_PRINT_CONTAINER_ID = 'gmura-layaway-receipt-print'
const LAYAWAY_PRINT_STYLE_ID = 'gmura-layaway-receipt-print-style'

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

export interface LayawayReceiptProps {
  layaway: LayawayDetail
  storeName: string
  printedAt: Date
}

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

function fmtDateOnly(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(d)
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

export function LayawayReceipt({
  layaway,
  storeName,
  printedAt,
}: LayawayReceiptProps) {
  const monoLight: React.CSSProperties = { color: '#525252' }
  const sectionStyle: React.CSSProperties = { margin: '6px 0' }
  const balance = layaway.balance_pending

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
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
          SEPARADO #{layaway.layaway_number}
        </div>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Metadatos */}
      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Cliente:</span>
          <span style={{ fontWeight: 600 }}>{layaway.customer_name}</span>
        </Line>
        {layaway.customer_phone && (
          <Line>
            <span style={monoLight}>Tel:</span>
            <span>{layaway.customer_phone}</span>
          </Line>
        )}
        <Line>
          <span style={monoLight}>Fecha:</span>
          <span>{fmtDateTime(layaway.created_at)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Vence:</span>
          <span>{fmtDateTime(layaway.expires_at)}</span>
        </Line>
        {layaway.created_by_name && (
          <Line>
            <span style={monoLight}>Creado por:</span>
            <span>{layaway.created_by_name}</span>
          </Line>
        )}
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Ítems */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ÍTEMS</div>
        {layaway.items.map((it) => (
          <div key={it.id} style={{ marginBottom: 2 }}>
            <div>{it.product_name}</div>
            <div style={monoLight}>
              {[
                it.size ? `T:${it.size}` : null,
                it.color ? `C:${it.color}` : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </div>
            <Line>
              <span style={monoLight}>
                {' '}
                {it.qty} × {fmtCOP(it.unit_price)}
              </span>
              <span>{fmtCOP(it.qty * it.unit_price)}</span>
            </Line>
          </div>
        ))}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Total:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(layaway.total)}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Abonos */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ABONOS</div>
        {layaway.payments.length === 0 ? (
          <div style={{ ...monoLight, fontStyle: 'italic' }}>Sin abonos</div>
        ) : (
          layaway.payments.map((p) => (
            <Line key={p.id}>
              <span style={monoLight}>
                {PAYMENT_METHODS[p.payment_method].label}
              </span>
              <span>{fmtCOP(p.amount)}</span>
            </Line>
          ))
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span>Pagado:</span>
          <span>{fmtCOP(layaway.paid_amount)}</span>
        </Line>
        <Line>
          <span style={{ fontWeight: 700 }}>Saldo:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(balance)}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {balance > 0 && (
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <div style={monoLight}>Cobra antes de:</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            {fmtDateOnly(layaway.expires_at)}
          </div>
        </div>
      )}

      <div style={monoLight}>{DIVIDER}</div>

      <div style={{ marginTop: 4 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>IMPORTANTE</div>
        <div style={monoLight}>
          - Los abonos no se reembolsan al cancelar.
        </div>
        <div style={monoLight}>
          - Si pasa la fecha de vencimiento sin completar, el separado expira.
        </div>
      </div>

      <div style={{ textAlign: 'center', ...monoLight, marginTop: 6 }}>
        Impreso: {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

export function LayawayReceiptPrint(props: LayawayReceiptProps) {
  useReceiptPrintStyle(LAYAWAY_PRINT_STYLE_ID, LAYAWAY_PRINT_CONTAINER_ID)
  return (
    <div
      id={LAYAWAY_PRINT_CONTAINER_ID}
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <LayawayReceipt {...props} />
    </div>
  )
}
