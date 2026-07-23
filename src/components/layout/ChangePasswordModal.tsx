import { useState } from 'react'
import { X, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { useUpdatePassword } from '@/hooks/useUpdatePassword'
import { useAuth } from '@/hooks/useAuth'
import { validatePasswordChange, MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const updatePassword = useUpdatePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)

  const inactive = profile ? !profile.is_active : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const check = validatePasswordChange({ current, next, confirm })
    if (!check.ok) {
      toast.error(check.error ?? 'Contraseña inválida')
      return
    }
    try {
      await updatePassword.mutateAsync({ current, next, confirm })
      onClose()
    } catch {
      // toast mostrado por el hook
    }
  }

  const inputClass =
    'h-10 w-full rounded-lg border border-[#ebe9e6] px-3 pr-10 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100'

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-[420px] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-600">
              <KeyRound size={16} />
            </div>
            <div>
              <h2 className="text-[19px] font-semibold leading-tight tracking-[-0.02em] text-[#1a1a1a]">
                Cambiar contraseña
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">Confirma tu contraseña actual</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {inactive ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600">
              <ShieldAlert size={22} />
            </div>
            <p className="text-sm font-medium text-[#1a1a1a]">Tu cuenta está desactivada</p>
            <p className="text-[13px] text-[#737373]">
              No puedes cambiar tu contraseña. Contacta a un administrador para reactivar tu acceso.
            </p>
            <button
              onClick={onClose}
              className="mt-2 h-10 rounded-lg border border-[#ebe9e6] bg-white px-5 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Contraseña actual
              </label>
              <div className="relative">
                <input
                  autoFocus
                  type={show ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a8a29e] hover:text-[#525252]"
                  aria-label={show ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Nueva contraseña
              </label>
              <input
                type={show ? 'text' : 'password'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Confirmar nueva contraseña
              </label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={updatePassword.isPending}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#8b5cf6] text-sm font-semibold text-white shadow-[0_4px_12px_#8b5cf640] hover:brightness-95 disabled:opacity-60"
              >
                {updatePassword.isPending ? 'Guardando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
