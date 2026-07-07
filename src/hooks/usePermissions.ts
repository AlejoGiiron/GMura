import { useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hasPermission } from '@/lib/permissions'

/**
 * Hook de permisos para la UI. Lee los permisos del usuario del AuthContext y
 * expone `can(perm)` e `isOwner`. Solo afecta la EXPERIENCIA (mostrar/ocultar);
 * el RLS es la verdad de seguridad.
 */
export function usePermissions() {
  const { permissions } = useAuth()

  // can() estable por referencia mientras no cambien los permisos, para no
  // invalidar memos/efectos de los consumidores.
  const can = useCallback(
    (perm: string) => hasPermission(permissions, perm),
    [permissions],
  )

  return { can, isOwner: permissions.includes('*'), permissions }
}
