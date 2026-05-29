import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import type { Profile } from '@/types/database.types'

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  isLoading: boolean
  signOut: () => Promise<void>
  // Recarga el perfil del usuario actual (p. ej. tras cambiar de tienda activa).
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (error) throw error
      setProfile(data)
    } catch (err) {
      toast.error('Error al cargar el perfil. Vuelve a iniciar sesión.')
      await supabase.auth.signOut()
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        void fetchProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        void fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Recarga ligera del perfil: no cierra sesión ante un error transitorio
  // (a diferencia de fetchProfile en el arranque), solo avisa.
  async function refreshProfile() {
    const uid = user?.id
    if (!uid) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single()
    if (error) {
      toast.error('No se pudo actualizar el perfil')
      return
    }
    setProfile(data)
  }

  return (
    <AuthContext.Provider value={{ user, profile, isLoading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
