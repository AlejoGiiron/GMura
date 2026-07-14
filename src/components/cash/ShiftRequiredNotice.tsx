import { Wallet } from 'lucide-react'

/**
 * Aviso visible que bloquea una operación de dinero cuando NO hay turno abierto.
 * Se muestra ANTES de que el cajero intente confirmar (el botón queda
 * deshabilitado en paralelo). El mensaje se adapta a la operación.
 */
export function ShiftRequiredNotice({ message }: { message?: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3"
    >
      <Wallet size={16} className="mt-0.5 shrink-0 text-amber-600" />
      <p className="text-[12.5px] font-medium leading-snug text-amber-900">
        {message ?? 'Abre un turno de caja para registrar este pago.'}
      </p>
    </div>
  )
}
