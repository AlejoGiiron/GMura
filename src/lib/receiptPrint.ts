import { useEffect } from 'react'

// Inyecta (una sola vez) el @media print para recibos térmicos de 80mm.
// Aísla el contenedor indicado y oculta el resto del body al imprimir.
// Centraliza el patrón antes duplicado en CashShiftReceipt, SaleReceipt y
// LayawayReceipt.
export function useReceiptPrintStyle(styleId: string, containerId: string) {
  useEffect(() => {
    if (document.getElementById(styleId)) return
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #${containerId},
        #${containerId} * { visibility: visible !important; }
        #${containerId} {
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
      document.getElementById(styleId)?.remove()
    }
  }, [styleId, containerId])
}
