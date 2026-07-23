// Política de contraseñas — lógica pura, sin React ni Supabase, para poder
// testearla aislada. La MISMA regla de longitud la valida la Edge Function
// reset-user-password del lado del servidor (defensa en profundidad).

export const MIN_PASSWORD_LENGTH = 8

export interface PasswordCheck {
  ok: boolean
  error?: string
}

/** Política base compartida: solo longitud mínima. La usan tanto el cambio
 *  propio como el reset por admin. */
export function validatePasswordStrength(password: string): PasswordCheck {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    }
  }
  return { ok: true }
}

export interface PasswordChangeInput {
  current: string
  next: string
  confirm: string
}

/** Validación completa del formulario "Cambiar mi contraseña": fuerza +
 *  coincidencia de la confirmación + que sea distinta de la actual. */
export function validatePasswordChange(input: PasswordChangeInput): PasswordCheck {
  const strength = validatePasswordStrength(input.next)
  if (!strength.ok) return strength
  if (input.next !== input.confirm) {
    return { ok: false, error: 'La confirmación no coincide con la nueva contraseña' }
  }
  if (input.next === input.current) {
    return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual' }
  }
  return { ok: true }
}

// Alfabeto legible: sin caracteres ambiguos (0/O/o, 1/l/i/I) para que el admin
// pueda dictar la clave temporal por teléfono sin errores.
const READABLE_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Genera una clave temporal legible y fuerte-ish para que un admin la dicte.
 *  Nunca por debajo del mínimo de política. Usa crypto cuando está disponible. */
export function generateReadablePassword(length = 10): string {
  const n = Math.max(MIN_PASSWORD_LENGTH, length)
  const chars = READABLE_CHARS
  let out = ''
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.getRandomValues) {
    const arr = new Uint32Array(n)
    cryptoObj.getRandomValues(arr)
    for (let i = 0; i < n; i++) out += chars[arr[i] % chars.length]
  } else {
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}
