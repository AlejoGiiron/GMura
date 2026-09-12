import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

/**
 * Reimprimir UNA etiqueta suelta, sin volver a sacar la tanda entera.
 *
 * El caso real: la impresora se trabó, una salió movida, se acabó el rollo a
 * mitad de la tanda. Antes la única salida era reimprimir las 50 para
 * recuperar la número 37.
 *
 * Cómo funciona: la superficie de impresión renderiza SOLO la etiqueta pedida
 * mientras `soloKey` tiene valor. No hay CSS propio — es el mismo
 * LabelPrintSurface y el mismo @media print de labelPrint.ts; lo único que
 * cambia es qué hijos recibe.
 *
 * El window.print() va en un efecto y no en el onClick porque tiene que correr
 * DESPUÉS de que React commiteó el DOM con la etiqueta sola; llamarlo en el
 * handler imprimiría la tanda completa todavía montada.
 */
export function useSingleLabelPrint() {
  const [soloKey, setSoloKey] = useState<string | null>(null)

  useEffect(() => {
    if (soloKey === null) return
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    } finally {
      // Vuelve a la tanda completa: el botón grande tiene que seguir sacando
      // todas, y una reimpresión suelta no debe dejar la superficie recortada.
      setSoloKey(null)
    }
  }, [soloKey])

  return {
    /** Clave de la única etiqueta a imprimir, o null = la tanda completa. */
    soloKey,
    /** Dispara la impresión de una sola etiqueta. NO marca el traslado como impreso. */
    printOne: (key: string) => setSoloKey(key),
  }
}
