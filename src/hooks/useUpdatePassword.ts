import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { validatePasswordChange, type PasswordChangeInput } from '@/lib/passwordPolicy'

/**
 * Cambio de la PROPIA contraseña. Exige la contraseña actual: se reautentica
 * con signInWithPassword antes de actualizar. Si la actual es incorrecta,
 * signInWithPassword devuelve error SIN tocar la sesión vigente, así que el
 * usuario del mostrador queda protegido y su sesión intacta.
 *
 * signInWithPassword contra el mismo cliente NO cierra la sesión: refresca los
 * tokens del mismo usuario y dispara un SIGNED_IN que solo re-lee el perfil.
 */
export function useUpdatePassword() {
  const { user, profile } = useAuth()

  return useMutation({
    mutationFn: async (input: PasswordChangeInput) => {
      // Guard is_active — OJO: por ahora es SOLO de UI. `is_active` no se aplica
      // en el servidor (login/RLS/Edge no lo consultan) → hallazgo S1 de la
      // auditoría (docs/auditoria-gmura-2026-07.md). Cuando se cierre S1, el
      // servidor negará la sesión y este guard pasa a ser defensa redundante.
      if (profile && !profile.is_active) {
        throw new Error('Tu cuenta está desactivada. Contacta a un administrador.')
      }

      const email = user?.email
      if (!email) throw new Error('No hay una sesión activa')

      const check = validatePasswordChange(input)
      if (!check.ok) throw new Error(check.error ?? 'Contraseña inválida')

      // 1) Reautenticar = verificar la contraseña actual.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: input.current,
      })
      if (reauthError) {
        throw new Error('La contraseña actual es incorrecta')
      }

      // 2) Solo si pasó → actualizar a la nueva.
      const { error: updateError } = await supabase.auth.updateUser({
        password: input.next,
      })
      if (updateError) throw updateError
    },
    onSuccess: () => toast.success('Contraseña actualizada'),
    onError: (err: Error) => toast.error(err.message),
  })
}
