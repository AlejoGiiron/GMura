import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { buildLabelPrintCss } from '@/lib/labelPrint'
import type { LabelSize } from '@/types/config.types'

interface LabelPrintSurfaceProps {
  /** id único del contenedor (uno por modal). */
  containerId: string
  /** Tamaño de etiqueta configurado en la tienda. */
  size: LabelSize
  children: ReactNode
}

/**
 * Superficie de impresión de etiquetas, compartida por el modal de productos y
 * el de traslados. El porqué del portal y de la CSS está en src/lib/labelPrint.ts.
 */
export default function LabelPrintSurface({
  containerId,
  size,
  children,
}: LabelPrintSurfaceProps) {
  const styleId = `${containerId}-style`

  useEffect(() => {
    // Se REEMPLAZA siempre (sin guard de "ya existe"): si cambia el tamaño de
    // etiqueta, el @page viejo dejaría la página con la medida anterior.
    document.getElementById(styleId)?.remove()
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = buildLabelPrintCss(containerId, size)
    document.head.appendChild(style)
    return () => {
      document.getElementById(styleId)?.remove()
    }
  }, [styleId, containerId, size])

  // Portal a body: el contenedor tiene que ser HERMANO de #root para que el
  // `body > *:not(...)` lo excluya del display:none.
  return createPortal(
    <div id={containerId} style={{ display: 'none', fontFamily: 'system-ui, sans-serif' }}>
      {children}
    </div>,
    document.body,
  )
}
