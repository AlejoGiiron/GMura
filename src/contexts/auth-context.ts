import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types/database.types'

export interface AuthContextValue {
  user: User | null
  profile: Profile | null
  /** Permisos RBAC del usuario (array de strings; ['*'] = Dueño). Derivado del
   *  rol embebido en el profile. [] si no hay rol asignado. */
  permissions: string[]
  isLoading: boolean
  signOut: () => Promise<void>
  // Recarga el perfil del usuario actual (p. ej. tras cambiar de tienda activa).
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
