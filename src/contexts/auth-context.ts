import { createContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/types/database.types'

export interface AuthContextValue {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  signOut: () => Promise<void>
  // Recarga el perfil del usuario actual (p. ej. tras cambiar de tienda activa).
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
