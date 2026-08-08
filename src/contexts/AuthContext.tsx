import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import type { Profile } from '@/types/database.types'
import { AuthContext } from './auth-context'

// La carga del perfil se reintenta porque su causa de fallo más común es
// TRANSITORIA: la petición sale sin JWT válido (token recién vencido, o la
// carrera entre getSession() y onAuthStateChange al abrir la app) y PostgREST
// la resuelve como `anon`, que por RLS no ve ninguna fila. Antes eso terminaba
// en logout y el usuario "entraba y lo sacaba". Un getSession() entre intentos
// renueva el token, así que el reintento suele acertar al segundo.
const PROFILE_FETCH_ATTEMPTS = 3
const PROFILE_RETRY_BASE_MS = 400

const PROFILE_SELECT = '*, rbac_role:roles(name, permissions)'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Una lectura. Devuelve null tanto si falló como si no hubo fila (maybeSingle:
// "0 filas" es el síntoma esperado de una petición sin sesión, no un error).
// Fuera del componente: no depende de estado, y así fetchProfile puede ser una
// dependencia estable del efecto de arranque.
async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()
  if (error) return null
  // El cliente tipado no infiere la relación embebida (Database hecho a
  // mano, sin metadata de Relationships) → cast explícito al runtime real.
  return (data as unknown as Profile | null) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // getSession() y onAuthStateChange pueden disparar dos cargas solapadas; solo
  // la última debe poder escribir el perfil.
  const fetchSeq = useRef(0)

  const fetchProfile = useCallback(async (userId: string) => {
    const seq = ++fetchSeq.current
    try {
      for (let attempt = 1; attempt <= PROFILE_FETCH_ATTEMPTS; attempt++) {
        const row = await loadProfile(userId)
        if (seq !== fetchSeq.current) return // otra carga más nueva manda
        if (row) {
          setProfile(row)
          return
        }

        // Sin fila: confirmar que la sesión sigue viva. getSession() además
        // refresca el token si venció, que es justo lo que desbloquea el
        // siguiente intento.
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (seq !== fetchSeq.current) return
        if (!session) {
          // Autenticación realmente inválida → cerrar sesión.
          await supabase.auth.signOut()
          return
        }

        if (attempt < PROFILE_FETCH_ATTEMPTS) {
          await delay(PROFILE_RETRY_BASE_MS * attempt)
        }
      }

      // Sesión válida pero el perfil no se pudo leer tras varios intentos:
      // mantener la sesión y avisar, nunca cerrarla.
      toast.error(
        'No se pudo cargar el perfil. Revisa tu conexión e intenta de nuevo.',
      )
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false)
    }
  }, [])

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
        // Invalida cualquier carga de perfil en vuelo: sin esto, un reintento
        // que resuelva después del logout repondría el perfil ya limpiado.
        fetchSeq.current++
        setProfile(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Recarga ligera del perfil: no cierra sesión ante un error transitorio
  // (a diferencia de fetchProfile en el arranque), solo avisa.
  async function refreshProfile() {
    const uid = user?.id
    if (!uid) return
    const row = await loadProfile(uid)
    if (!row) {
      toast.error('No se pudo actualizar el perfil')
      return
    }
    setProfile(row)
  }

  // Permisos RBAC del usuario, derivados del rol embebido. [] si no hay rol.
  const permissions = profile?.rbac_role?.permissions ?? []

  return (
    <AuthContext.Provider
      value={{ user, profile, permissions, isLoading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}
