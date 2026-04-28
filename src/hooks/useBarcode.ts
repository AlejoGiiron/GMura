import { useRef, useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'

// USB scanners emit chars in bursts: 6+ chars in < SCAN_MAX_MS is a scanner
const SCAN_MIN_CHARS = 6
const SCAN_MAX_MS = 80

export function useBarcode(onScan: (code: string) => void) {
  const callbackRef = useRef(onScan)
  useEffect(() => {
    callbackRef.current = onScan
  }, [onScan])

  // ── Canal 1: escáner USB ──────────────────────────────────────────────────
  const bufRef = useRef('')
  const firstTimeRef = useRef(0)
  const lastTimeRef = useRef(0)

  const resetBuffer = useCallback(() => {
    bufRef.current = ''
    firstTimeRef.current = 0
    lastTimeRef.current = 0
  }, [])

  /**
   * Llama en el onKeyDown del campo de búsqueda del POS.
   * Devuelve true si el evento fue consumido como escaneo (Enter de escáner).
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      const key = e.key

      if (key === 'Backspace' || key === 'Delete' || key === 'Escape') {
        resetBuffer()
        return false
      }

      if (key === 'Enter') {
        const buf = bufRef.current
        const elapsed = lastTimeRef.current - firstTimeRef.current
        const isScanner =
          buf.length >= SCAN_MIN_CHARS &&
          firstTimeRef.current > 0 &&
          elapsed <= SCAN_MAX_MS

        resetBuffer()

        if (isScanner) {
          e.preventDefault()
          callbackRef.current(buf)
          return true
        }
        return false
      }

      if (key.length === 1) {
        const now = Date.now()
        if (bufRef.current.length === 0) {
          firstTimeRef.current = now
        }
        bufRef.current += key
        lastTimeRef.current = now
      }

      return false
    },
    [resetBuffer],
  )

  // ── Canal 2: cámara con Quagga2 ───────────────────────────────────────────
  const [isCameraActive, setIsCameraActive] = useState(false)
  const quaggaStarted = useRef(false)

  const startCamera = useCallback(async (elementId: string) => {
    if (quaggaStarted.current) return

    const target = document.getElementById(elementId)
    if (!target) {
      toast.error('No se encontró el elemento de cámara')
      return
    }

    try {
      const { default: Quagga } = await import('@ericblade/quagga2')

      await new Promise<void>((resolve, reject) => {
        Quagga.init(
          {
            inputStream: {
              type: 'LiveStream',
              target,
              constraints: { facingMode: 'environment', width: 640, height: 480 },
            },
            decoder: {
              readers: [
                'code_128_reader',
                'code_39_reader',
                'ean_reader',
                'ean_8_reader',
                'upc_reader',
              ] as never,
            },
            locate: true,
          },
          (err: unknown) => {
            if (err) reject(err instanceof Error ? err : new Error(String(err)))
            else resolve()
          },
        )
      })

      Quagga.start()
      quaggaStarted.current = true
      setIsCameraActive(true)

      // Debounce same code within 1.5s to avoid duplicates
      let lastCode = ''
      let lastCodeTime = 0

      Quagga.onDetected((result) => {
        const code = result.codeResult?.code
        if (!code) return
        const now = Date.now()
        if (code === lastCode && now - lastCodeTime < 1500) return
        lastCode = code
        lastCodeTime = now
        callbackRef.current(code)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Cámara no disponible: ${msg}`)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (!quaggaStarted.current) return
    void import('@ericblade/quagga2').then(({ default: Quagga }) => {
      try {
        Quagga.stop()
      } catch {
        // Ignorar errores al detener
      }
      quaggaStarted.current = false
      setIsCameraActive(false)
    })
  }, [])

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (quaggaStarted.current) {
        void import('@ericblade/quagga2').then(({ default: Quagga }) => {
          try {
            Quagga.stop()
          } catch {
            // Ignorar
          }
        })
      }
    }
  }, [])

  return {
    isCameraActive,
    startCamera,
    stopCamera,
    handleKeyDown,
    resetBuffer,
  }
}
